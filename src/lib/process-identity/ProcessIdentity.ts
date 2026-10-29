/**
 * Which process a pid names, beyond the pid: its start in epoch seconds and the boot it started in, so a reused pid or a reboot never
 * reads as the same process, and a timezone change never reads as a different one. Signals go only to a process whose identity is
 * checked first. It depends on no other package.
 */
import { existsSync, readFileSync } from 'node:fs';

export interface ProcessIdentity {
  processId:         number;
  startEpochSeconds: number;
  bootIdentity:      string;
}

export type ProcessGroupSignalOutcome =
  | { verdict: 'signalled' }
  | { verdict: 'group-gone' }
  | { verdict: 'group-recycled' }
  | { verdict: 'identity-mismatch'; currentIdentity: ProcessIdentity }
  | { verdict: 'refused'; reason: string };

const PROCESS_STATUS_PATH       = '/bin/ps';
const SYSTEM_CONTROL_PATH       = '/usr/sbin/sysctl';
const LINUX_BOOT_IDENTITY_PATH  = '/proc/sys/kernel/random/boot_id';
const DARWIN_BOOT_IDENTITY_NAME = 'kern.bootsessionuuid';

// The start is read in UTC under the C locale, so ps prints the same English stamp whatever the caller's TZ or language.
const STAMP_ENVIRONMENT = { TZ: 'UTC', LC_ALL: 'C' };

const SUCCESS_EXIT_CODE    = 0;
const NO_SUCH_PROCESS_CODE = 'ESRCH';
const MILLISECONDS_PER_SECOND = 1000;

const MONTH_ABBREVIATIONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// `ps -o lstart` under the C locale: weekday, month, day, time, year, as in `Wed Oct 28 01:51:25 2026`.
const START_STAMP_PATTERN = /^[A-Z][a-z]{2}\s+([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{4})$/;

// `ps -A -o pid= -o pgid= -o lstart=`: a pid, its group and its start stamp.
const PROCESS_LISTING_LINE_PATTERN = /^\s*(\d+)\s+(\d+)\s+(.+)$/;

function errorCodeOf(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : undefined;
}

/** `null` when the program cannot be started or exits non-zero. */
function outputOf(command: readonly string[]): string | null {
  try {
    const finished = Bun.spawnSync({
      cmd: [...command], env: STAMP_ENVIRONMENT, stdout: 'pipe', stderr: 'pipe'
    });
    return finished.exitCode === SUCCESS_EXIT_CODE ? finished.stdout.toString().trim() : null;
  } catch {
    return null;
  }
}

/** A `ps -o lstart` stamp printed in UTC, read as epoch seconds; `null` when it is not one. */
export function startEpochSecondsOf(utcStartStamp: string): number | null {
  const match = START_STAMP_PATTERN.exec(utcStartStamp.trim());
  if (match === null) return null;
  const [, monthName, day, hours, minutes, seconds, year] = match;
  const monthIndex = MONTH_ABBREVIATIONS.indexOf(monthName ?? '');
  if (monthIndex < 0) return null;
  const epochMilliseconds = Date.UTC(Number(year), monthIndex, Number(day), Number(hours), Number(minutes), Number(seconds));
  return epochMilliseconds / MILLISECONDS_PER_SECOND;
}

/** Linux's boot id, otherwise macOS's boot session UUID; `null` when neither can be read. */
function readBootIdentity(): string | null {
  if (existsSync(LINUX_BOOT_IDENTITY_PATH)) {
    try {
      return readFileSync(LINUX_BOOT_IDENTITY_PATH, 'utf8').trim() || null;
    } catch {
      return null;
    }
  }
  return outputOf([SYSTEM_CONTROL_PATH, '-n', DARWIN_BOOT_IDENTITY_NAME]) || null;
}

/** `null` for a process that does not exist, or whose start or boot cannot be read: an identity is never guessed. */
export function identityOf(processId: number): ProcessIdentity | null {
  if (!Number.isSafeInteger(processId) || processId <= 0) return null;
  const startStamp = outputOf([PROCESS_STATUS_PATH, '-o', 'lstart=', '-p', String(processId)]);
  if (startStamp === null) return null;
  const startEpochSeconds = startEpochSecondsOf(startStamp);
  const bootIdentity      = readBootIdentity();
  if (startEpochSeconds === null || bootIdentity === null) return null;
  return { processId, startEpochSeconds, bootIdentity };
}

export function sameProcess(first: ProcessIdentity, second: ProcessIdentity): boolean {
  return first.processId === second.processId
    && first.startEpochSeconds === second.startEpochSeconds
    && first.bootIdentity === second.bootIdentity;
}

/**
 * Anything other than `ESRCH` means alive: `EPERM` is a live process owned by another user, and
 * reading it as dead would hand one user's lock to another. A non-positive id is refused before the
 * call, because `process.kill(0, …)` addresses the caller's whole process group.
 */
export function processIsGone(processId: number): boolean {
  if (!Number.isSafeInteger(processId) || processId <= 0) return false;
  try {
    process.kill(processId, 0);
    return false;
  } catch (error) {
    return errorCodeOf(error) === NO_SUCH_PROCESS_CODE;
  }
}

function groupHasMembers(processGroupId: number): boolean {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    return errorCodeOf(error) !== NO_SUCH_PROCESS_CODE;
  }
}

/** The start of every process in the group, in epoch seconds; `null` when ps cannot be read or a start stamp is not one. */
function memberStartsOf(processGroupId: number): number[] | null {
  const listing = outputOf([PROCESS_STATUS_PATH, '-A', '-o', 'pid=', '-o', 'pgid=', '-o', 'lstart=']);
  if (listing === null) return null;
  const memberStarts: number[] = [];
  for (const line of listing.split('\n')) {
    const match = PROCESS_LISTING_LINE_PATTERN.exec(line);
    if (match === null || Number(match[2]) !== processGroupId) continue;
    const startEpochSeconds = startEpochSecondsOf(match[3] ?? '');
    if (startEpochSeconds === null) return null;
    memberStarts.push(startEpochSeconds);
  }
  return memberStarts;
}

function signalGroup(processGroupId: number, signal: NodeJS.Signals): ProcessGroupSignalOutcome {
  try {
    process.kill(-processGroupId, signal);
    return { verdict: 'signalled' };
  } catch (error) {
    if (errorCodeOf(error) === NO_SUCH_PROCESS_CODE) return { verdict: 'group-gone' };
    return { verdict: 'refused', reason: `the process group ${processGroupId} could not be signalled: ${String(error)}` };
  }
}

/**
 * A group outlives its leader while members remain. Its id is the recorded group only when this is the recorded boot and no member
 * started before the recorded leader: a member older than the leader belongs to a group that reused the id.
 */
function signalLeaderlessGroup(leader: ProcessIdentity, signal: NodeJS.Signals): ProcessGroupSignalOutcome {
  if (!groupHasMembers(leader.processId)) return { verdict: 'group-gone' };
  if (readBootIdentity() !== leader.bootIdentity) return { verdict: 'group-recycled' };
  const memberStarts = memberStartsOf(leader.processId);
  if (memberStarts === null) return { verdict: 'refused', reason: `the members of process group ${leader.processId} could not be read` };
  if (memberStarts.length === 0) return { verdict: 'group-gone' };
  if (memberStarts.some((startEpochSeconds) => startEpochSeconds < leader.startEpochSeconds)) return { verdict: 'group-recycled' };
  return signalGroup(leader.processId, signal);
}

/**
 * The group the recorded leader led: while the leader lives, only when it still is the recorded process; once it is gone, only while the
 * group has members and none of them predates the leader. An empty or recycled group is never signalled.
 */
export function signalProcessGroup(leader: ProcessIdentity, signal: NodeJS.Signals): ProcessGroupSignalOutcome {
  const currentIdentity = identityOf(leader.processId);
  if (currentIdentity === null) return signalLeaderlessGroup(leader, signal);
  if (!sameProcess(currentIdentity, leader)) return { verdict: 'identity-mismatch', currentIdentity };
  return signalGroup(leader.processId, signal);
}
