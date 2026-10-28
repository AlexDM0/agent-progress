/**
 * The one runner of a board, by generations on the `src/services/tracker/TrackerLock.ts` scheme: each start creates
 * `<data>/runner/lease-<n>.json` exclusively, never rewritten, and the newest generation naming a live process identity is the runner.
 * Nobody unlinks a lease it does not hold; the holder removes the generations below its own.
 */
import { readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join }                                  from 'node:path';

import { createFileAtomically }                          from '../../lib/atomic-file/AtomicFile.ts';
import { identityOf, sameProcess, type ProcessIdentity } from '../../lib/process-identity/ProcessIdentity.ts';
import { OperationRefusal }                              from '../../shared/OperationRefusal.ts';

export interface RunnerLeaseRecord {
  processId:                number;
  processStartEpochSeconds: number;
  bootIdentity:             string;
  port:                     number;
  url:                      string;
  tokenFile:                string;
  codeVersion:              string;
  installVersion:           number;
  hostProtocolVersion:      number;
}

/** A lease that cannot be read names no process, so it reads as dead: it was created whole, and only a damaged file is unreadable. */
export type RunnerLeaseReading =
  | { verdict: 'none' }
  | { verdict: 'live'; generation: number; record: RunnerLeaseRecord }
  | { verdict: 'dead'; generation: number; record: RunnerLeaseRecord | null };

export type RunnerLeaseAcquisition =
  | { verdict: 'acquired'; generation: number }
  | { verdict: 'already-running'; generation: number; record: RunnerLeaseRecord }
  | { verdict: 'contended' };

const LEASE_FILE_PATTERN = /^lease-(\d+)\.json$/;

const NUMBER_FIELDS = ['processId', 'processStartEpochSeconds', 'port', 'installVersion', 'hostProtocolVersion'] as const;
const TEXT_FIELDS   = ['bootIdentity', 'url', 'tokenFile', 'codeVersion'] as const;

function leaseFilePathFor(runnerDirectory: string, generation: number): string {
  return join(runnerDirectory, `lease-${generation}.json`);
}

/** Ascending; an absent folder holds no generation. */
function leaseGenerationsIn(runnerDirectory: string): number[] {
  let fileNames: string[];
  try {
    fileNames = readdirSync(runnerDirectory);
  } catch {
    return [];
  }
  return fileNames
    .map((fileName) => LEASE_FILE_PATTERN.exec(fileName)?.[1])
    .filter((digits): digits is string => digits !== undefined)
    .map(Number)
    .filter((generation) => Number.isSafeInteger(generation))
    .sort((a, b) => a - b);
}

function recordIsWellFormed(parsed: unknown): parsed is RunnerLeaseRecord {
  if (typeof parsed !== 'object' || parsed === null) return false;
  const fields = parsed as Record<string, unknown>;
  return NUMBER_FIELDS.every((field) => typeof fields[field] === 'number') && TEXT_FIELDS.every((field) => typeof fields[field] === 'string');
}

function readLeaseRecord(leaseFilePath: string): RunnerLeaseRecord | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(leaseFilePath, 'utf8'));
    return recordIsWellFormed(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function identityNamedBy(record: RunnerLeaseRecord): ProcessIdentity {
  return { processId: record.processId, startEpochSeconds: record.processStartEpochSeconds, bootIdentity: record.bootIdentity };
}

/** Live only while the process the lease names is still that process: a reused pid or a reboot reads as dead. */
function leaseNamesALiveProcess(record: RunnerLeaseRecord): boolean {
  const currentIdentity = identityOf(record.processId);
  return currentIdentity !== null && sameProcess(currentIdentity, identityNamedBy(record));
}

function newestLeaseOf(runnerDirectory: string): RunnerLeaseReading {
  const newest = leaseGenerationsIn(runnerDirectory).at(-1);
  if (newest === undefined) return { verdict: 'none' };
  const record = readLeaseRecord(leaseFilePathFor(runnerDirectory, newest));
  if (record !== null && leaseNamesALiveProcess(record)) return { verdict: 'live', generation: newest, record };
  return { verdict: 'dead', generation: newest, record };
}

function newerGenerationExists(runnerDirectory: string, generation: number): boolean {
  return leaseGenerationsIn(runnerDirectory).some((existing) => existing > generation);
}

/** Only ever below a generation this process created and still holds as the newest. */
function removeGenerationsBelow(runnerDirectory: string, generation: number): void {
  for (const existing of leaseGenerationsIn(runnerDirectory)) {
    if (existing >= generation) continue;
    try {
      unlinkSync(leaseFilePathFor(runnerDirectory, existing));
    } catch {
      // Another holder's cleanup may have removed it first.
    }
  }
}

/**
 * The generation after the newest is created only once the newest names a dead process, and whoever creates it holds the lease unless a
 * newer one already exists: two starters after a reboot both judge the old lease dead, and exactly one of them drives.
 */
function acquire(runnerDirectory: string, record: RunnerLeaseRecord): RunnerLeaseAcquisition {
  const newest = newestLeaseOf(runnerDirectory);
  if (newest.verdict === 'live') return { verdict: 'already-running', generation: newest.generation, record: newest.record };
  const claimed = newest.verdict === 'none' ? 1 : newest.generation + 1;
  if (createFileAtomically(leaseFilePathFor(runnerDirectory, claimed), `${JSON.stringify(record, null, 2)}\n`) === 'already-exists') {
    return { verdict: 'contended' };
  }
  if (newerGenerationExists(runnerDirectory, claimed)) return { verdict: 'contended' };
  removeGenerationsBelow(runnerDirectory, claimed);
  return { verdict: 'acquired', generation: claimed };
}

/** Run before each effect batch: a runner whose generation was overtaken stops `lease-taken-over` without acting. */
function requireNewestGeneration(runnerDirectory: string, heldGeneration: number): void {
  if (newerGenerationExists(runnerDirectory, heldGeneration)) {
    throw new OperationRefusal('unrepaired', { kind: 'lease-taken-over', leaseFilePath: leaseFilePathFor(runnerDirectory, heldGeneration) });
  }
}

/** The holder's last act at a stop: its own generation goes, and nothing a newer runner created is touched. */
function release(runnerDirectory: string, heldGeneration: number): void {
  if (newerGenerationExists(runnerDirectory, heldGeneration)) return;
  try {
    unlinkSync(leaseFilePathFor(runnerDirectory, heldGeneration));
  } catch {
    // Already gone: nothing is held any more.
  }
}

export const RunnerLease = Object.freeze({
  acquire,
  release,
  requireNewestGeneration,
  newestLeaseOf,
  leaseFilePathFor,
  leaseGenerationsIn,
});
