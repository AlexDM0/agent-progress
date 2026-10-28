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
  | { verdict: 'leader-gone' }
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

/** The group the leader leads is signalled only while the leader still is the recorded process; a group whose leader is gone is not. */
export function signalProcessGroup(leader: ProcessIdentity, signal: NodeJS.Signals): ProcessGroupSignalOutcome {
  const currentIdentity = identityOf(leader.processId);
  if (currentIdentity === null) return { verdict: 'leader-gone' };
  if (!sameProcess(currentIdentity, leader)) return { verdict: 'identity-mismatch', currentIdentity };
  try {
    process.kill(-leader.processId, signal);
    return { verdict: 'signalled' };
  } catch (error) {
    return { verdict: 'refused', reason: `the process group ${leader.processId} could not be signalled: ${String(error)}` };
  }
}
