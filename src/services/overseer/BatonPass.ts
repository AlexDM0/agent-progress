/**
 * The checked Baton pass of design section 7.3, through one file, `<data>/overseer/baton-pass-<generation>.json`, which the two Overseers write
 * in turn: the old Overseer `requested`, the successor `ready` once it proved the new code, the old Overseer `released` once it let go, and the
 * successor `serving` or, at any step, `failed`. Nothing lets go before the new code has started, and no Watcher is ever sent anything.
 */
import { readFileSync } from 'node:fs';
import { join }         from 'node:path';

import { writeFileAtomically } from '../../lib/atomic-file/AtomicFile.ts';
import {
  identityOf,
  sameProcess,
  signalProcessGroup,
  type ProcessIdentity
} from '../../lib/process-identity/ProcessIdentity.ts';

/** The successor's steps, before and after `released`, and the two the old Overseer observes of a successor that never reports. */
export type BatonPassStep =
  | 'spawn'
  | 'report-ready'
  | 'build-bundles'
  | 'read-board'
  | 'read-jobs'
  | 'read-watcher-files'
  | 'install-version'
  | 'await-release'
  | 'take-baton'
  | 'bind-port'
  | 'regroup'
  | 'serve';

export type BatonPassReport =
  | { state: 'requested' }
  | { state: 'ready'; successorCodeVersion: string }
  | { state: 'released' }
  | { state: 'serving'; successorCodeVersion: string; generation: number; url: string }
  /** The successor's own report of a failing step; only the old Overseer, once it has logged it, leaves the final `failed`. */
  | { state: 'successor-failed'; successorCodeVersion: string; step: BatonPassStep; error: string; afterRelease: boolean }
  | { state: 'failed'; successorCodeVersion: string; step: BatonPassStep; error: string; afterRelease: boolean };

export interface BatonPassFailure {
  successorCodeVersion: string;
  step:                 BatonPassStep;
  error:                string;
}

/** `kept-driving`: it failed before `released`, so the old Overseer never stopped. `taken-back`: after it, so the old Overseer takes n+2. */
export type BatonPassOutcome =
  | { verdict: 'handed-over'; successorCodeVersion: string; generation: number; url: string }
  | { verdict: 'kept-driving'; failure: BatonPassFailure }
  | { verdict: 'taken-back'; failure: BatonPassFailure };

export interface BatonPassSchedule {
  readyTries:           number;
  releaseTries:         number;
  intervalMilliseconds: number;
}

export interface HandOverRequest {
  batonPassFilePath:    string;
  /** The successor as spawned; `null` when it could not be. */
  successor:            ProcessIdentity | null;
  /** The code on disk, named in a failure the successor never reported itself. */
  successorCodeVersion: string;
  /** Finishes a landing in progress, starts no effect batch, logs the hand-over and closes the listener and the Watcher connections. */
  release:              () => Promise<void>;
  /** Logs the failure and raises the warning, before the outcome is left in the file. */
  recordFailure:        (failure: BatonPassFailure) => Promise<void>;
  schedule:             BatonPassSchedule;
}

export interface BatonPassStepRun {
  step: BatonPassStep;
  run:  () => Promise<void> | void;
}

export interface SuccessorRequest {
  batonPassFilePath: string;
  codeVersion:       string;
  /** True while the generation being handed over still names a live process; a dead one is gone, as after a crash. */
  predecessorIsLive: () => boolean;
  schedule:          BatonPassSchedule;
}

export type SuccessorAdmission = 'released' | 'predecessor-gone' | 'failed';

const STATES: readonly string[] = ['requested', 'ready', 'released', 'serving', 'successor-failed', 'failed'];

function batonPassFilePathOf(overseerDirectory: string, generation: number): string {
  return join(overseerDirectory, `baton-pass-${generation}.json`);
}

/** Written whole each time, so a reader sees one report or the one before it; anything else reads as no report yet. */
function readBatonPass(batonPassFilePath: string): BatonPassReport | null {
  try {
    const parsed = JSON.parse(readFileSync(batonPassFilePath, 'utf8')) as { state?: unknown } | null;
    return parsed !== null && typeof parsed.state === 'string' && STATES.includes(parsed.state) ? parsed as BatonPassReport : null;
  } catch {
    return null;
  }
}

function writeBatonPass(batonPassFilePath: string, report: BatonPassReport): void {
  writeFileAtomically(batonPassFilePath, `${JSON.stringify(report, null, 2)}\n`);
}

function errorTextOf(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : String(thrown);
}

function processIsLive(identity: ProcessIdentity): boolean {
  const current = identityOf(identity.processId);
  return current !== null && sameProcess(current, identity);
}

/** The successor is its own group's leader, spawned detached; only that same process is ever killed. */
function killSuccessor(successor: ProcessIdentity): void {
  signalProcessGroup(successor, 'SIGKILL');
}

type Awaited =
  | { verdict: 'report'; report: BatonPassReport }
  | { verdict: 'exited' }
  | { verdict: 'silent' };

async function awaitReport(request: HandOverRequest, tries: number, accepts: (report: BatonPassReport) => boolean): Promise<Awaited> {
  const { successor } = request;
  for (let attempt = 0; attempt < tries; attempt++) {
    const report = readBatonPass(request.batonPassFilePath);
    if (report !== null && accepts(report)) return { verdict: 'report', report };
    if (successor !== null && !processIsLive(successor)) {
      const last = readBatonPass(request.batonPassFilePath);
      return last !== null && accepts(last) ? { verdict: 'report', report: last } : { verdict: 'exited' };
    }
    await Bun.sleep(request.schedule.intervalMilliseconds);
  }
  return { verdict: 'silent' };
}

function unreportedFailure(request: HandOverRequest, awaited: Exclude<Awaited, { verdict: 'report' }>, step: BatonPassStep, tries: number): BatonPassFailure {
  if (awaited.verdict === 'silent' && request.successor !== null) killSuccessor(request.successor);
  const error = awaited.verdict === 'silent' ? `the successor reported nothing within ${tries} tries` : 'the successor exited without a report';
  return { successorCodeVersion: request.successorCodeVersion, step, error };
}

function failureOf(report: Extract<BatonPassReport, { state: 'successor-failed' }>): BatonPassFailure {
  return { successorCodeVersion: report.successorCodeVersion, step: report.step, error: report.error };
}

/** The old Overseer's side, its outcome also left in the file whoever failed, so `oversee restart` and `update` read one place. */
async function handOver(request: HandOverRequest): Promise<BatonPassOutcome> {
  const outcome = await handOverSteps(request);
  if (outcome.verdict !== 'handed-over') {
    // Recorded first, so whoever reads the outcome from the file finds the failure already logged.
    await request.recordFailure(outcome.failure);
    writeBatonPass(request.batonPassFilePath, { state: 'failed', ...outcome.failure, afterRelease: outcome.verdict === 'taken-back' });
  }
  return outcome;
}

/** It keeps driving until `ready`, then lets go, and learns whether the successor serves. */
async function handOverSteps(request: HandOverRequest): Promise<BatonPassOutcome> {
  if (request.successor === null) {
    return { verdict: 'kept-driving', failure: { successorCodeVersion: request.successorCodeVersion, step: 'spawn', error: 'the successor could not be started' } };
  }
  const { readyTries, releaseTries } = request.schedule;
  const ready = await awaitReport(request, readyTries, (report) => report.state === 'ready' || report.state === 'successor-failed');
  if (ready.verdict !== 'report') return { verdict: 'kept-driving', failure: unreportedFailure(request, ready, 'report-ready', readyTries) };
  if (ready.report.state === 'successor-failed') return { verdict: 'kept-driving', failure: failureOf(ready.report) };

  await request.release();
  writeBatonPass(request.batonPassFilePath, { state: 'released' });
  const served = await awaitReport(request, releaseTries, (report) => report.state === 'serving' || report.state === 'successor-failed');
  if (served.verdict !== 'report') return { verdict: 'taken-back', failure: unreportedFailure(request, served, 'serve', releaseTries) };
  if (served.report.state === 'successor-failed') return { verdict: 'taken-back', failure: failureOf(served.report) };
  if (served.report.state !== 'serving') return { verdict: 'taken-back', failure: unreportedFailure(request, { verdict: 'exited' }, 'serve', releaseTries) };
  const { successorCodeVersion, generation, url } = served.report;
  return {
    verdict: 'handed-over', successorCodeVersion, generation, url
  };
}

export interface RebindRequest<Bound> {
  /** The successor that let the board go back, perhaps still dying from its kill and holding the port. */
  successor:            ProcessIdentity | null;
  /** Bounds the wait for the successor to be gone and the binds after it together. */
  tries:                number;
  intervalMilliseconds: number;
  bind:                 () => Promise<Bound>;
}

export type RebindOutcome<Bound> =
  | { verdict: 'bound'; bound: Bound }
  | { verdict: 'successor-live' }
  | { verdict: 'bind-failed'; error: string };

/** The old Overseer's rebind of its port once a Baton pass came back: it binds only once the successor is gone, and a refused bind is tried again. */
async function rebindAfterTakeBack<Bound>(request: RebindRequest<Bound>): Promise<RebindOutcome<Bound>> {
  let last: RebindOutcome<Bound> = { verdict: 'successor-live' };
  for (let attempt = 0; attempt < request.tries; attempt++) {
    if (attempt > 0) await Bun.sleep(request.intervalMilliseconds);
    if (request.successor !== null && processIsLive(request.successor)) {
      last = { verdict: 'successor-live' };
      continue;
    }
    try {
      return { verdict: 'bound', bound: await request.bind() };
    } catch (thrown) {
      last = { verdict: 'bind-failed', error: errorTextOf(thrown) };
    }
  }
  return last;
}

function reportFailure(request: Pick<SuccessorRequest, 'batonPassFilePath' | 'codeVersion'>, step: BatonPassStep, thrown: unknown, afterRelease: boolean): void {
  writeBatonPass(request.batonPassFilePath, {
    state: 'successor-failed', successorCodeVersion: request.codeVersion, step, error: errorTextOf(thrown), afterRelease
  });
}

/** Runs each step in order; the first that throws is reported with its error, and nothing after it runs. */
async function stepsSucceeded(steps: readonly BatonPassStepRun[], onFailure: (step: BatonPassStep, thrown: unknown) => Promise<void> | void): Promise<boolean> {
  for (const { step, run } of steps) {
    try {
      await run();
    } catch (thrown) {
      await onFailure(step, thrown);
      return false;
    }
  }
  return true;
}

/**
 * The successor's side before it holds anything: it proves the new code, reports `ready`, and waits for `released`. A predecessor that
 * died meanwhile reads as gone, and the successor then starts as after a crash.
 */
async function prepareAndAwaitRelease(request: SuccessorRequest, preparation: readonly BatonPassStepRun[]): Promise<SuccessorAdmission> {
  if (!await stepsSucceeded(preparation, (step, thrown) => reportFailure(request, step, thrown, false))) return 'failed';
  writeBatonPass(request.batonPassFilePath, { state: 'ready', successorCodeVersion: request.codeVersion });
  for (let attempt = 0; attempt < request.schedule.releaseTries; attempt++) {
    if (readBatonPass(request.batonPassFilePath)?.state === 'released') return 'released';
    if (!request.predecessorIsLive()) return 'predecessor-gone';
    await Bun.sleep(request.schedule.intervalMilliseconds);
  }
  reportFailure(request, 'await-release', new Error(`no release within ${request.schedule.releaseTries} tries`), false);
  return 'failed';
}

function reportServing(request: Pick<SuccessorRequest, 'batonPassFilePath' | 'codeVersion'>, generation: number, url: string): void {
  writeBatonPass(request.batonPassFilePath, {
    state: 'serving', successorCodeVersion: request.codeVersion, generation, url
  });
}

export const BatonPass = Object.freeze({
  batonPassFilePathOf,
  readBatonPass,
  writeBatonPass,
  handOver,
  rebindAfterTakeBack,
  prepareAndAwaitRelease,
  reportFailure,
  reportServing,
});
