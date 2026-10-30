/**
 * The one Overseer of a board, by generations on the `src/services/tracker/TrackerLock.ts` scheme: each start creates
 * `<data>/overseer/baton-<n>.json` exclusively, never rewritten, and the newest generation naming a live process identity is the Overseer.
 * Nobody unlinks a Baton it does not hold; the holder removes the generations below its own.
 */
import { readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join }                                  from 'node:path';

import { createFileAtomically }                          from '../../lib/atomic-file/AtomicFile.ts';
import { identityOf, sameProcess, type ProcessIdentity } from '../../lib/process-identity/ProcessIdentity.ts';
import { OperationRefusal }                              from '../../shared/OperationRefusal.ts';

export interface BatonRecord {
  processId:                number;
  processStartEpochSeconds: number;
  bootIdentity:             string;
  port:                     number;
  url:                      string;
  tokenFile:                string;
  codeVersion:              string;
  installVersion:           number;
  watcherProtocolVersion:   number;
}

/** A Baton that cannot be read names no process, so it reads as dead: it was created whole, and only a damaged file is unreadable. */
export type BatonReading =
  | { verdict: 'none' }
  | { verdict: 'live'; generation: number; record: BatonRecord }
  | { verdict: 'dead'; generation: number; record: BatonRecord | null };

export type BatonAcquisition =
  | { verdict: 'acquired'; generation: number }
  | { verdict: 'already-running'; generation: number; record: BatonRecord }
  | { verdict: 'contended' };

const BATON_FILE_PATTERN = /^baton-(\d+)\.json$/;

const NUMBER_FIELDS = ['processId', 'processStartEpochSeconds', 'port', 'installVersion', 'watcherProtocolVersion'] as const;
const TEXT_FIELDS   = ['bootIdentity', 'url', 'tokenFile', 'codeVersion'] as const;

function batonFilePathFor(overseerDirectory: string, generation: number): string {
  return join(overseerDirectory, `baton-${generation}.json`);
}

/** Ascending; an absent folder holds no generation. */
function batonGenerationsIn(overseerDirectory: string): number[] {
  let fileNames: string[];
  try {
    fileNames = readdirSync(overseerDirectory);
  } catch {
    return [];
  }
  return fileNames
    .map((fileName) => BATON_FILE_PATTERN.exec(fileName)?.[1])
    .filter((digits): digits is string => digits !== undefined)
    .map(Number)
    .filter((generation) => Number.isSafeInteger(generation))
    .sort((a, b) => a - b);
}

function recordIsWellFormed(parsed: unknown): parsed is BatonRecord {
  if (typeof parsed !== 'object' || parsed === null) return false;
  const fields = parsed as Record<string, unknown>;
  return NUMBER_FIELDS.every((field) => typeof fields[field] === 'number') && TEXT_FIELDS.every((field) => typeof fields[field] === 'string');
}

function readBatonRecord(batonFilePath: string): BatonRecord | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(batonFilePath, 'utf8'));
    return recordIsWellFormed(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function identityNamedBy(record: BatonRecord): ProcessIdentity {
  return { processId: record.processId, startEpochSeconds: record.processStartEpochSeconds, bootIdentity: record.bootIdentity };
}

/** Live only while the process the Baton names is still that process: a reused pid or a reboot reads as dead. */
function batonNamesALiveProcess(record: BatonRecord): boolean {
  const currentIdentity = identityOf(record.processId);
  return currentIdentity !== null && sameProcess(currentIdentity, identityNamedBy(record));
}

function newestBatonOf(overseerDirectory: string): BatonReading {
  const newest = batonGenerationsIn(overseerDirectory).at(-1);
  if (newest === undefined) return { verdict: 'none' };
  const record = readBatonRecord(batonFilePathFor(overseerDirectory, newest));
  if (record !== null && batonNamesALiveProcess(record)) return { verdict: 'live', generation: newest, record };
  return { verdict: 'dead', generation: newest, record };
}

function newerGenerationExists(overseerDirectory: string, generation: number): boolean {
  return batonGenerationsIn(overseerDirectory).some((existing) => existing > generation);
}

/** Only ever below a generation this process created and still holds as the newest. */
function removeGenerationsBelow(overseerDirectory: string, generation: number): void {
  for (const existing of batonGenerationsIn(overseerDirectory)) {
    if (existing >= generation) continue;
    try {
      unlinkSync(batonFilePathFor(overseerDirectory, existing));
    } catch {
      // Another holder's cleanup may have removed it first.
    }
  }
}

/**
 * The generation after the newest is created only once the newest names a dead process, and whoever creates it holds the Baton unless a
 * newer one already exists: two starters after a reboot both judge the old Baton dead, and exactly one of them drives.
 */
function acquire(overseerDirectory: string, record: BatonRecord): BatonAcquisition {
  const newest = newestBatonOf(overseerDirectory);
  if (newest.verdict === 'live') return { verdict: 'already-running', generation: newest.generation, record: newest.record };
  const claimed = newest.verdict === 'none' ? 1 : newest.generation + 1;
  if (createFileAtomically(batonFilePathFor(overseerDirectory, claimed), `${JSON.stringify(record, null, 2)}\n`) === 'already-exists') {
    return { verdict: 'contended' };
  }
  if (newerGenerationExists(overseerDirectory, claimed)) return { verdict: 'contended' };
  removeGenerationsBelow(overseerDirectory, claimed);
  return { verdict: 'acquired', generation: claimed };
}

/**
 * A Baton pass's claims beside a live identity, which the Baton pass file admits: the successor's generation above the one handed over once it
 * was released, and the old Overseer's one above its failed successor's. Anything newer than the floor means another Overseer moved first.
 */
function acquireAbove(overseerDirectory: string, record: BatonRecord, floorGeneration: number): BatonAcquisition {
  const newest = batonGenerationsIn(overseerDirectory).at(-1) ?? 0;
  if (newest > floorGeneration) return { verdict: 'contended' };
  const claimed = floorGeneration + 1;
  if (createFileAtomically(batonFilePathFor(overseerDirectory, claimed), `${JSON.stringify(record, null, 2)}\n`) === 'already-exists') {
    return { verdict: 'contended' };
  }
  if (newerGenerationExists(overseerDirectory, claimed)) return { verdict: 'contended' };
  removeGenerationsBelow(overseerDirectory, claimed);
  return { verdict: 'acquired', generation: claimed };
}

/** Run before each effect batch: an Overseer whose generation was overtaken stops `baton-taken` without acting. */
function requireNewestGeneration(overseerDirectory: string, heldGeneration: number): void {
  if (newerGenerationExists(overseerDirectory, heldGeneration)) {
    throw new OperationRefusal('unrepaired', { kind: 'baton-taken', batonFilePath: batonFilePathFor(overseerDirectory, heldGeneration) });
  }
}

/** The holder's last act at a stop: its own generation goes, and nothing a newer Overseer created is touched. */
function release(overseerDirectory: string, heldGeneration: number): void {
  if (newerGenerationExists(overseerDirectory, heldGeneration)) return;
  try {
    unlinkSync(batonFilePathFor(overseerDirectory, heldGeneration));
  } catch {
    // Already gone: nothing is held any more.
  }
}

export const Baton = Object.freeze({
  acquire,
  acquireAbove,
  release,
  requireNewestGeneration,
  newestBatonOf,
  batonFilePathFor,
  batonGenerationsIn,
});
