/**
 * The machine-wide cap on concurrent gate runs: one file per slot in the monitor folder, created exclusively and naming its holder. A slot
 * whose holder is no longer live is taken over, so a crashed Overseer or an ended gate host frees its slot without a release.
 */
import {
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';

import { processIsGone } from '../../lib/process-identity/ProcessIdentity.ts';
import { HostFleet }     from './HostFleet.ts';

const GATE_HOST_INSTANCE = 1;

export interface GateRunSlotsOptions {
  folder:            string;
  limit:             number;
  holderIsLive:      (holder: string) => boolean;
  retryMilliseconds: number;
}

export interface GateRunSlots {
  /** Whether `holder` holds a slot after the call: one it held already, or a free one it took. */
  tryAcquire: (holder: string) => boolean;
  release:    (holder: string) => void;
  /** Waits until `holder` holds a slot, and answers its release. */
  acquire:    (holder: string) => Promise<() => void>;
}

const SLOT_FILE_PREFIX = 'slot-';

function holderIn(slotPath: string): string | null {
  try {
    return readFileSync(slotPath, 'utf8');
  } catch {
    return null;
  }
}

function errorCodeOf(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
}

function createdExclusively(slotPath: string, holder: string): boolean {
  try {
    writeFileSync(slotPath, holder, { flag: 'wx' });
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

/** A gate host's holder is its host folder: live until its host ended or was lost. */
export function gateRunHolderIsLive(holder: string): boolean {
  if (holder.startsWith(IN_PROCESS_HOLDER_PREFIX)) {
    return !processIsGone(Number(holder.slice(IN_PROCESS_HOLDER_PREFIX.length).split(HOLDER_SEPARATOR)[0]));
  }
  const { verdict } = HostFleet.livenessOf(holder, GATE_HOST_INSTANCE);
  return verdict === 'live' || verdict === 'unclaimed';
}

export function createGateRunSlots(options: GateRunSlotsOptions): GateRunSlots {
  const slotPaths = Array.from({ length: options.limit }, (_unused, index) => join(options.folder, `${SLOT_FILE_PREFIX}${index + 1}`));

  /** Moved aside before it is removed, so of two Overseers taking over one stale slot only the first removes it. */
  function freedIfStale(slotPath: string, holder: string): void {
    if (options.holderIsLive(holder)) return;
    const asidePath = `${slotPath}.${process.pid}.stale`;
    try {
      renameSync(slotPath, asidePath);
    } catch {
      return;
    }
    const movedHolder = holderIn(asidePath);
    if (movedHolder !== holder && movedHolder !== null && !createdExclusively(slotPath, movedHolder)) return;
    unlinkSync(asidePath);
  }

  function tryAcquire(holder: string): boolean {
    mkdirSync(options.folder, { recursive: true });
    if (slotPaths.some((slotPath) => holderIn(slotPath) === holder)) return true;
    for (const slotPath of slotPaths) {
      if (createdExclusively(slotPath, holder)) return true;
      const current = holderIn(slotPath);
      if (current === null) continue;
      freedIfStale(slotPath, current);
      if (createdExclusively(slotPath, holder)) return true;
    }
    return false;
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

  return { tryAcquire, release, acquire };
}
