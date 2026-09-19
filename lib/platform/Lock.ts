/**
 * One writer at a time in a tracker, across processes: every worktree of a repository shares one
 * tracker, so the writers are separate processes and the lock is `openSync(path, 'wx')` — create-or-fail
 * in one atomic operation, which a check-then-create cannot be.
 *
 * This is one of the two places in `agent-progress` where a clock decides anything, and the time it
 * compares is one the tool itself wrote into the lock payload; the fallback to the lock file's own
 * mtime is reached only when that payload cannot be read, and fails closed in both directions.
 */
import { randomUUID } from 'crypto';
import {
  closeSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync
} from 'fs';

import { LOCK_RETRY_COUNT, LOCK_RETRY_INTERVAL_MILLISECONDS, LOCK_STALE_MILLISECONDS } from '../constants/Limits';
import { TimeUtil }                                                                    from '../utils/TimeUtil';
import { OperationRefusal }                                                            from './OperationRefusal';
import type { Workspace }                                                              from './Workspace';

interface LockPayload {
  processId:  number;
  acquiredAt: string;
}

const TAKEOVER_NAME_RANDOM_LENGTH = 8;
const FILE_ALREADY_EXISTS_CODE   = 'EEXIST';
const NO_SUCH_PROCESS_CODE       = 'ESRCH';

function errorCodeOf(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : undefined;
}

/**
 * Anything other than `ESRCH` means alive: `EPERM` is a live process owned by another user, and
 * reading it as dead would hand one user's lock to another. A non-positive id is refused before the
 * call, because `process.kill(0, …)` addresses the caller's whole process group.
 */
function processIsGone(processId: number): boolean {
  if (!Number.isSafeInteger(processId) || processId <= 0) return false;
  try {
    process.kill(processId, 0);
    return false;
  } catch (error) {
    return errorCodeOf(error) === NO_SUCH_PROCESS_CODE;
  }
}

function readLockPayload(lockFilePath: string): LockPayload | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(lockFilePath, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { processId, acquiredAt } = parsed as { processId?: unknown; acquiredAt?: unknown };
    if (typeof processId !== 'number' || typeof acquiredAt !== 'string') return null;
    return { acquiredAt, processId };
  } catch {
    return null;
  }
}

/**
 * An unreadable lock file is not stale on that ground alone: it is also what a lock being written at
 * this instant looks like, so it is judged on the age of its own mtime and waits when that cannot
 * decide either.
 */
function lockIsStale(lockFilePath: string, nowMilliseconds: number): boolean {
  const payload = readLockPayload(lockFilePath);
  if (payload !== null) {
    if (processIsGone(payload.processId)) return true;
    const acquiredAtMilliseconds = Date.parse(payload.acquiredAt);
    if (Number.isNaN(acquiredAtMilliseconds)) return fileIsOlderThanTheStaleThreshold(lockFilePath, nowMilliseconds);
    return nowMilliseconds - acquiredAtMilliseconds > LOCK_STALE_MILLISECONDS;
  }
  return fileIsOlderThanTheStaleThreshold(lockFilePath, nowMilliseconds);
}

function fileIsOlderThanTheStaleThreshold(lockFilePath: string, nowMilliseconds: number): boolean {
  try {
    return nowMilliseconds - statSync(lockFilePath).mtimeMs > LOCK_STALE_MILLISECONDS;
  } catch {
    // Fail closed: a `stat` that errors is not an argument for taking someone else's lock.
    return false;
  }
}

/**
 * A stale lock is taken over by renaming it, never by unlinking it: a rename consumes the path
 * atomically, so of two waiters that judge the same lock stale exactly one wins and the loser's
 * rename fails with `ENOENT`.
 */
function tookOverStaleLock(lockFilePath: string): boolean {
  const takeoverPath = `${lockFilePath}.stale.${randomUUID().slice(0, TAKEOVER_NAME_RANDOM_LENGTH)}`;
  try {
    renameSync(lockFilePath, takeoverPath);
  } catch {
    return false;
  }
  try {
    unlinkSync(takeoverPath);
  } catch {
    // The takeover already succeeded; a leftover file in a git-ignored directory is harmless.
  }
  return true;
}

function acquired(lockFilePath: string, payload: LockPayload): boolean {
  let lockFileDescriptor: number;
  try {
    lockFileDescriptor = openSync(lockFilePath, 'wx');
  } catch (error) {
    if (errorCodeOf(error) === FILE_ALREADY_EXISTS_CODE) return false;
    throw error;
  }
  try {
    writeSync(lockFileDescriptor, JSON.stringify(payload));
  } finally {
    closeSync(lockFileDescriptor);
  }
  return true;
}

/**
 * A lock held past the stale threshold may have been taken over meanwhile, and unlinking blindly
 * would delete the new holder's lock; both payload fields are compared, because a process id alone
 * is unique on one machine and a tracker can be on a share mounted by two.
 */
function releaseIfStillOurs(lockFilePath: string, payload: LockPayload): void {
  const current = readLockPayload(lockFilePath);
  if (current === null || current.processId !== payload.processId || current.acquiredAt !== payload.acquiredAt) return;
  try {
    unlinkSync(lockFilePath);
  } catch {
    // Already removed, which is the state this function was trying to reach.
  }
}

/**
 * Run `action` with this tracker's lock held, releasing it however `action` ends. Throws
 * `OperationRefusal('unrepaired')` — exit 2, not 1 — when the retry budget runs out, because
 * removing a lock a live process id still appears to own is a decision for a person.
 */
export async function withLock<ActionResult>(
  workspace: Workspace,
  action: () => Promise<ActionResult> | ActionResult,
  now: () => Date,
): Promise<ActionResult> {
  const { lockFilePath } = workspace;
  const payload: LockPayload = { acquiredAt: TimeUtil.formatLocalIso(now()), processId: process.pid };

  let held = false;
  for (let attempt = 0; attempt < LOCK_RETRY_COUNT; attempt++) {
    if (acquired(lockFilePath, payload)) {
      held = true;
      break;
    }
    // A takeover retries immediately rather than sleeping: the lock is free at this instant.
    if (lockIsStale(lockFilePath, now().getTime()) && tookOverStaleLock(lockFilePath)) continue;
    await Bun.sleep(LOCK_RETRY_INTERVAL_MILLISECONDS);
  }

  if (!held) {
    throw new OperationRefusal(
      'unrepaired',
      `Another agent-progress command is holding ${lockFilePath} and did not release it. If nothing else is running, remove that path and try again.`,
    );
  }

  try {
    return await action();
  } finally {
    releaseIfStillOurs(lockFilePath, payload);
  }
}
