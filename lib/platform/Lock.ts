/**
 * One writer at a time in a tracker, across processes. The lock is a directory of numbered generation
 * records, each created exclusively and never rewritten: taking the lock is creating the generation after
 * the newest once that one is released or stale, and releasing is creating the next as a released record,
 * so no step ever removes or replaces a record another process may have just written.
 *
 * This is one of the stated exceptions where a clock decides anything, and the time it compares is
 * one the tool itself wrote into the record; the fallback to the record file's own mtime is reached
 * only when that record cannot be read, and fails closed in both directions.
 */
import { randomUUID } from 'crypto';
import {
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'fs';
import { join } from 'path';

import { LOCK_RETRY_COUNT, LOCK_RETRY_INTERVAL_MILLISECONDS, LOCK_STALE_MILLISECONDS } from '../constants/Limits';
import { TimeUtil }                                                                    from '../utils/TimeUtil';
import { OperationRefusal }                                                            from './OperationRefusal';
import type { Workspace }                                                              from './Workspace';

interface LockPayload {
  processId:  number;
  acquiredAt: string;
}

const GENERATION_STATES = ['held', 'released'] as const;
type GenerationState = typeof GENERATION_STATES[number];

interface GenerationRecord extends LockPayload {
  state: GenerationState;
}

type AcquireAttempt = { verdict: 'acquired'; generation: number } | { verdict: 'held' } | { verdict: 'contended' };

const ACQUIRE_STEPS = ['newest-judged-free', 'generation-created'] as const;
type AcquireStep = typeof ACQUIRE_STEPS[number];

const GENERATION_FILE_PREFIX     = 'generation-';
const GENERATION_DIGITS_PATTERN  = /^[1-9]\d*$/;
const PENDING_FILE_PREFIX        = '.pending-';
const PENDING_NAME_RANDOM_LENGTH = 8;
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

function generationNumberOf(fileName: string): number | null {
  if (!fileName.startsWith(GENERATION_FILE_PREFIX)) return null;
  const digits = fileName.slice(GENERATION_FILE_PREFIX.length);
  if (!GENERATION_DIGITS_PATTERN.test(digits)) return null;
  const generation = Number(digits);
  return Number.isSafeInteger(generation) ? generation : null;
}

function generationPathFor(lockDirectoryPath: string, generation: number): string {
  return join(lockDirectoryPath, `${GENERATION_FILE_PREFIX}${generation}`);
}

/** Ascending; `null` when the directory cannot be listed, which every caller reads as held. */
function generationsIn(lockDirectoryPath: string): number[] | null {
  try {
    return readdirSync(lockDirectoryPath)
      .map(generationNumberOf)
      .filter((generation): generation is number => generation !== null)
      .sort((a, b) => a - b);
  } catch {
    return null;
  }
}

function readGenerationRecord(generationPath: string): GenerationRecord | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(generationPath, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { processId, acquiredAt, state } = parsed as { processId?: unknown; acquiredAt?: unknown; state?: unknown };
    if (typeof processId !== 'number' || typeof acquiredAt !== 'string') return null;
    const knownState = GENERATION_STATES.find((candidate) => candidate === state);
    if (knownState === undefined) return null;
    return { acquiredAt, processId, state: knownState };
  } catch {
    return null;
  }
}

/**
 * An unreadable record is not free on that ground alone: the tool never writes one, so it is judged on
 * the age of its own mtime and waits when that cannot decide either.
 */
function generationIsFree(generationPath: string, nowMilliseconds: number): boolean {
  const record = readGenerationRecord(generationPath);
  if (record === null) return fileIsOlderThanTheStaleThreshold(generationPath, nowMilliseconds);
  if (record.state === 'released' || processIsGone(record.processId)) return true;
  const acquiredAtMilliseconds = Date.parse(record.acquiredAt);
  if (Number.isNaN(acquiredAtMilliseconds)) return fileIsOlderThanTheStaleThreshold(generationPath, nowMilliseconds);
  return nowMilliseconds - acquiredAtMilliseconds > LOCK_STALE_MILLISECONDS;
}

function fileIsOlderThanTheStaleThreshold(filePath: string, nowMilliseconds: number): boolean {
  try {
    return nowMilliseconds - statSync(filePath).mtimeMs > LOCK_STALE_MILLISECONDS;
  } catch {
    // Fail closed: a `stat` that errors is not an argument for taking someone else's lock.
    return false;
  }
}

/** Written beside the target and linked into place, so a record is complete the instant it exists and `link` refuses an existing one. */
function createdGeneration(lockDirectoryPath: string, generation: number, record: GenerationRecord): boolean {
  const pendingPath = join(lockDirectoryPath, `${PENDING_FILE_PREFIX}${randomUUID().slice(0, PENDING_NAME_RANDOM_LENGTH)}`);
  writeFileSync(pendingPath, JSON.stringify(record), { flag: 'wx' });
  try {
    linkSync(pendingPath, generationPathFor(lockDirectoryPath, generation));
    return true;
  } catch (error) {
    if (errorCodeOf(error) === FILE_ALREADY_EXISTS_CODE) return false;
    throw error;
  } finally {
    removePendingFile(pendingPath);
  }
}

function removePendingFile(pendingPath: string): void {
  try {
    unlinkSync(pendingPath);
  } catch {
    // A leftover pending file is never read as a generation, so it only costs a name in a git-ignored directory.
  }
}

function newerGenerationExists(lockDirectoryPath: string, generation: number): boolean {
  const generations = generationsIn(lockDirectoryPath);
  return generations === null || generations.some((existing) => existing > generation);
}

/** Only ever below a generation this process created, which is never the newest another process could be judging. */
function removeGenerationsBelow(lockDirectoryPath: string, generation: number): void {
  for (const existing of generationsIn(lockDirectoryPath) ?? []) {
    if (existing >= generation) continue;
    try {
      unlinkSync(generationPathFor(lockDirectoryPath, existing));
    } catch {
      // Another holder removed it first, which is the state this loop was reaching for.
    }
  }
}

/**
 * The generation after the newest is created only once the newest is judged free, and whoever creates it
 * holds the lock unless a newer one already exists: that newer one means the generation it took had been
 * removed after a holder moved past it. `afterStep` lets a spec interleave.
 */
function attemptedAcquire(
  lockDirectoryPath: string,
  payload: LockPayload,
  nowMilliseconds: number,
  afterStep: (step: AcquireStep) => void = () => {},
): AcquireAttempt {
  try {
    mkdirSync(lockDirectoryPath, { recursive: true });
  } catch {
    // A path that cannot become the directory is judged by the listing below, which reads it as held.
  }
  const generations = generationsIn(lockDirectoryPath);
  if (generations === null) return { verdict: 'held' };
  const newest = generations.at(-1);
  if (newest !== undefined && !generationIsFree(generationPathFor(lockDirectoryPath, newest), nowMilliseconds)) return { verdict: 'held' };
  afterStep('newest-judged-free');
  const claimed = (newest ?? 0) + 1;
  if (!createdGeneration(lockDirectoryPath, claimed, { ...payload, state: 'held' })) return { verdict: 'contended' };
  afterStep('generation-created');
  if (newerGenerationExists(lockDirectoryPath, claimed)) return { verdict: 'contended' };
  removeGenerationsBelow(lockDirectoryPath, claimed);
  return { generation: claimed, verdict: 'acquired' };
}

/** A holder that was taken over as stale finds its successor generation taken, and so changes nothing. */
function released(lockDirectoryPath: string, heldGeneration: number, payload: LockPayload): void {
  const releaseGeneration = heldGeneration + 1;
  try {
    if (createdGeneration(lockDirectoryPath, releaseGeneration, { ...payload, state: 'released' })) removeGenerationsBelow(lockDirectoryPath, releaseGeneration);
  } catch {
    // The lock directory went away under us; there is nothing left to release.
  }
}

/** The steps `withLock` interleaves between processes, exposed so a spec can replay a race step by step. */
export const LockGenerationSteps = {
  acquireSteps: ACQUIRE_STEPS,
  attemptedAcquire,
  generationPathFor,
  generationsIn,
  released,
} as const;

/**
 * Run `action` with this tracker's lock held, releasing it however `action` ends. Throws
 * `OperationRefusal('unrepaired')` — exit 2, not 1 — when the retry budget runs out, because
 * taking a lock a live process id still appears to hold is a decision for a person.
 */
export async function withLock<ActionResult>(
  workspace: Workspace,
  action: () => Promise<ActionResult> | ActionResult,
  now: () => Date,
): Promise<ActionResult> {
  const { lockDirectoryPath } = workspace;
  const payload: LockPayload = { acquiredAt: TimeUtil.formatLocalIso(now()), processId: process.pid };

  let heldGeneration: number | null = null;
  for (let attempt = 0; attempt < LOCK_RETRY_COUNT; attempt++) {
    const attemptResult = attemptedAcquire(lockDirectoryPath, payload, now().getTime());
    if (attemptResult.verdict === 'acquired') {
      heldGeneration = attemptResult.generation;
      break;
    }
    // Contention retries immediately rather than sleeping: another process just moved the lock, and its newest record decides.
    if (attemptResult.verdict === 'contended') continue;
    await Bun.sleep(LOCK_RETRY_INTERVAL_MILLISECONDS);
  }

  if (heldGeneration === null) {
    throw new OperationRefusal(
      'unrepaired',
      `Another agent-progress command is holding ${lockDirectoryPath} and did not release it. If nothing else is running, remove that path and try again.`,
    );
  }

  try {
    return await action();
  } finally {
    released(lockDirectoryPath, heldGeneration, { acquiredAt: TimeUtil.formatLocalIso(now()), processId: process.pid });
  }
}
