/**
 * The machine-wide cap on concurrent gate runs: one file per slot in the monitor folder, created exclusively and naming its holder and the
 * process answering for it. A slot whose holder is no longer live is taken over, so a crashed Overseer, an ended gate Watcher or one that
 * died before it claimed frees its slot without a release.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { dirname, join } from 'node:path';

import { writeFileAtomically } from '../../lib/atomic-file/AtomicFile.ts';
import {
  identityOf,
  type ProcessIdentity,
  processIsGone,
  sameProcess
} from '../../lib/process-identity/ProcessIdentity.ts';
import { WatcherFleet } from './WatcherFleet.ts';

const GATE_WATCHER_INSTANCE = 1;

/** A slot's holder and the process answering for it while its gate Watcher has not claimed: the acquirer until the spawn is recorded. */
export interface GateRunHolding {
  holder:  string;
  process: ProcessIdentity | null;
}

export interface GateRunSlotsOptions {
  folder:            string;
  limit:             number;
  holderIsLive:      (holding: GateRunHolding) => boolean;
  retryMilliseconds: number;
}

export interface GateRunSlots {
  /** Whether `holder` holds a slot after the call: one it held already, or a free one it took. */
  tryAcquire:           (holder: string) => boolean;
  /** The spawned gate Watcher answers for the slot from here on; `null` for a spawn already gone. */
  recordSpawnedProcess: (holder: string, spawnedProcess: ProcessIdentity | null) => void;
  release:              (holder: string) => void;
  /** Waits until `holder` holds a slot, and answers its release. */
  acquire:              (holder: string) => Promise<() => void>;
}

const SLOT_FILE_PREFIX = 'slot-';
const HOLDING_SEPARATOR = '\n';

function slotTextIn(slotPath: string): string | null {
  try {
    return readFileSync(slotPath, 'utf8');
  } catch {
    return null;
  }
}

function slotTextOf(holding: GateRunHolding): string {
  return holding.process === null ? holding.holder : `${holding.holder}${HOLDING_SEPARATOR}${JSON.stringify(holding.process)}`;
}

function isProcessIdentity(value: unknown): value is ProcessIdentity {
  return typeof value === 'object' && value !== null
    && 'processId' in value && typeof value.processId === 'number'
    && 'startEpochSeconds' in value && typeof value.startEpochSeconds === 'number'
    && 'bootIdentity' in value && typeof value.bootIdentity === 'string';
}

/** An unreadable process line reads as no process, so the holder is judged by its Watcher alone. */
function holdingOf(slotText: string): GateRunHolding {
  const separatorIndex = slotText.indexOf(HOLDING_SEPARATOR);
  if (separatorIndex < 0) return { holder: slotText, process: null };
  let recordedProcess: unknown = null;
  try {
    recordedProcess = JSON.parse(slotText.slice(separatorIndex + HOLDING_SEPARATOR.length));
  } catch {
    recordedProcess = null;
  }
  return { holder: slotText.slice(0, separatorIndex), process: isProcessIdentity(recordedProcess) ? recordedProcess : null };
}

function holderIn(slotPath: string): string | null {
  const slotText = slotTextIn(slotPath);
  return slotText === null ? null : holdingOf(slotText).holder;
}

function errorCodeOf(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
}

function createdExclusively(slotPath: string, slotText: string): boolean {
  try {
    writeFileSync(slotPath, slotText, { flag: 'wx' });
    return true;
  } catch (error) {
    if (errorCodeOf(error) === 'EEXIST') return false;
    throw error;
  }
}

const IN_PROCESS_HOLDER_PREFIX = 'process:';
const HOLDER_SEPARATOR = ':';

/** A gate an Overseer runs itself, such as a merge gate: live while that Overseer's process is. */
export function inProcessHolderOf(label: string): string {
  return `${IN_PROCESS_HOLDER_PREFIX}${process.pid}${HOLDER_SEPARATOR}${label}`;
}

function processIsStillRunning(recorded: ProcessIdentity | null): boolean {
  if (recorded === null) return false;
  const current = identityOf(recorded.processId);
  return current !== null && sameProcess(current, recorded);
}

/**
 * A gate Watcher's holder is its Watcher folder: live while its Watcher is, and before it claimed, while the recorded process still runs. A holder
 * whose job folder is gone is never live.
 */
export function gateRunHolderIsLive(holding: GateRunHolding): boolean {
  const { holder } = holding;
  if (holder.startsWith(IN_PROCESS_HOLDER_PREFIX)) {
    return !processIsGone(Number(holder.slice(IN_PROCESS_HOLDER_PREFIX.length).split(HOLDER_SEPARATOR)[0]));
  }
  if (!existsSync(dirname(holder))) return false;
  const { verdict } = WatcherFleet.livenessOf(holder, GATE_WATCHER_INSTANCE);
  if (verdict === 'live') return true;
  return verdict === 'unclaimed' && processIsStillRunning(holding.process);
}

export function createGateRunSlots(options: GateRunSlotsOptions): GateRunSlots {
  const slotPaths = Array.from({ length: options.limit }, (_unused, index) => join(options.folder, `${SLOT_FILE_PREFIX}${index + 1}`));
  let acquirerIdentity: ProcessIdentity | null | undefined;

  function acquirer(): ProcessIdentity | null {
    acquirerIdentity ??= identityOf(process.pid);
    return acquirerIdentity;
  }

  /** Moved aside before it is removed, so of two Overseers taking over one stale slot only the first removes it. */
  function freedIfStale(slotPath: string, slotText: string): void {
    if (options.holderIsLive(holdingOf(slotText))) return;
    const asidePath = `${slotPath}.${process.pid}.stale`;
    try {
      renameSync(slotPath, asidePath);
    } catch {
      return;
    }
    const movedText = slotTextIn(asidePath);
    if (movedText !== slotText && movedText !== null && !createdExclusively(slotPath, movedText)) return;
    unlinkSync(asidePath);
  }

  function tryAcquire(holder: string): boolean {
    mkdirSync(options.folder, { recursive: true });
    if (slotPaths.some((slotPath) => holderIn(slotPath) === holder)) return true;
    const ownText = slotTextOf({ holder, process: acquirer() });
    for (const slotPath of slotPaths) {
      if (createdExclusively(slotPath, ownText)) return true;
      const current = slotTextIn(slotPath);
      if (current === null) continue;
      freedIfStale(slotPath, current);
      if (createdExclusively(slotPath, ownText)) return true;
    }
    return false;
  }

  function recordSpawnedProcess(holder: string, spawnedProcess: ProcessIdentity | null): void {
    for (const slotPath of slotPaths) {
      if (holderIn(slotPath) === holder) writeFileAtomically(slotPath, slotTextOf({ holder, process: spawnedProcess }));
    }
  }

  function release(holder: string): void {
    for (const slotPath of slotPaths) {
      if (holderIn(slotPath) === holder) unlinkSync(slotPath);
    }
  }

  async function acquire(holder: string): Promise<() => void> {
    while (!tryAcquire(holder)) await Bun.sleep(options.retryMilliseconds);
    return () => release(holder);
  }

  return {
    tryAcquire, recordSpawnedProcess, release, acquire
  };
}
