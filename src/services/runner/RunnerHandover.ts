/**
 * The checked handover of design section 7.3, through one file, `<data>/runner/handover-<generation>.json`, which the two runners write
 * in turn: the old runner `requested`, the successor `ready` once it proved the new code, the old runner `released` once it let go, and the
 * successor `serving` or, at any step, `failed`. Nothing lets go before the new code has started, and no host is ever sent anything.
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

/** The successor's steps, before and after `released`, and the two the old runner observes of a successor that never reports. */
export type HandoverStep =
  | 'spawn'
  | 'report-ready'
  | 'build-bundles'
  | 'read-board'
  | 'read-jobs'
  | 'read-host-files'
  | 'install-version'
  | 'await-release'
  | 'take-lease'
  | 'bind-port'
  | 'reattach'
  | 'serve';

export type HandoverReport =
  | { state: 'requested' }
  | { state: 'ready'; successorCodeVersion: string }
  | { state: 'released' }
  | { state: 'serving'; successorCodeVersion: string; generation: number; url: string }
  /** The successor's own report of a failing step; only the old runner, once it has logged it, leaves the final `failed`. */
  | { state: 'successor-failed'; successorCodeVersion: string; step: HandoverStep; error: string; afterRelease: boolean }
  | { state: 'failed'; successorCodeVersion: string; step: HandoverStep; error: string; afterRelease: boolean };

export interface HandoverFailure {
  successorCodeVersion: string;
  step:                 HandoverStep;
  error:                string;
}

/** `kept-driving`: it failed before `released`, so the old runner never stopped. `taken-back`: after it, so the old runner takes n+2. */
export type HandoverOutcome =
  | { verdict: 'handed-over'; successorCodeVersion: string; generation: number; url: string }
  | { verdict: 'kept-driving'; failure: HandoverFailure }
  | { verdict: 'taken-back'; failure: HandoverFailure };

export interface HandoverSchedule {
  readyTries:           number;
  releaseTries:         number;
  intervalMilliseconds: number;
}

export interface HandOverRequest {
  handoverFilePath:     string;
  /** The successor as spawned; `null` when it could not be. */
  successor:            ProcessIdentity | null;
  /** The code on disk, named in a failure the successor never reported itself. */
  successorCodeVersion: string;
  /** Finishes a landing in progress, starts no effect batch, logs the hand-over and closes the listener and the host connections. */
  release:              () => Promise<void>;
  /** Logs the failure and raises the warning, before the outcome is left in the file. */
  recordFailure:        (failure: HandoverFailure) => Promise<void>;
  schedule:             HandoverSchedule;
}

export interface HandoverStepRun {
  step: HandoverStep;
  run:  () => Promise<void> | void;
}

export interface SuccessorRequest {
  handoverFilePath:  string;
  codeVersion:       string;
  /** True while the generation being handed over still names a live process; a dead one is gone, as after a crash. */
  predecessorIsLive: () => boolean;
  schedule:          HandoverSchedule;
}

export type SuccessorAdmission = 'released' | 'predecessor-gone' | 'failed';

const STATES: readonly string[] = ['requested', 'ready', 'released', 'serving', 'successor-failed', 'failed'];

function handoverFilePathOf(runnerDirectory: string, generation: number): string {
  return join(runnerDirectory, `handover-${generation}.json`);
}

/** Written whole each time, so a reader sees one report or the one before it; anything else reads as no report yet. */
function readHandover(handoverFilePath: string): HandoverReport | null {
  try {
    const parsed = JSON.parse(readFileSync(handoverFilePath, 'utf8')) as { state?: unknown } | null;
    return parsed !== null && typeof parsed.state === 'string' && STATES.includes(parsed.state) ? parsed as HandoverReport : null;
  } catch {
    return null;
  }
}

function writeHandover(handoverFilePath: string, report: HandoverReport): void {
  writeFileAtomically(handoverFilePath, `${JSON.stringify(report, null, 2)}\n`);
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
  | { verdict: 'report'; report: HandoverReport }
  | { verdict: 'exited' }
  | { verdict: 'silent' };

async function awaitReport(request: HandOverRequest, tries: number, accepts: (report: HandoverReport) => boolean): Promise<Awaited> {
  const { successor } = request;
  for (let attempt = 0; attempt < tries; attempt++) {
    const report = readHandover(request.handoverFilePath);
    if (report !== null && accepts(report)) return { verdict: 'report', report };
    if (successor !== null && !processIsLive(successor)) {
      const last = readHandover(request.handoverFilePath);
      return last !== null && accepts(last) ? { verdict: 'report', report: last } : { verdict: 'exited' };
    }
    await Bun.sleep(request.schedule.intervalMilliseconds);
  }
  return { verdict: 'silent' };
}

function unreportedFailure(request: HandOverRequest, awaited: Exclude<Awaited, { verdict: 'report' }>, step: HandoverStep, tries: number): HandoverFailure {
  if (awaited.verdict === 'silent' && request.successor !== null) killSuccessor(request.successor);
  const error = awaited.verdict === 'silent' ? `the successor reported nothing within ${tries} tries` : 'the successor exited without a report';
  return { successorCodeVersion: request.successorCodeVersion, step, error };
}

function failureOf(report: Extract<HandoverReport, { state: 'successor-failed' }>): HandoverFailure {
  return { successorCodeVersion: report.successorCodeVersion, step: report.step, error: report.error };
}

/** The old runner's side, its outcome also left in the file whoever failed, so `run restart` and `update` read one place. */
async function handOver(request: HandOverRequest): Promise<HandoverOutcome> {
  const outcome = await handOverSteps(request);
  if (outcome.verdict !== 'handed-over') {
    // Recorded first, so whoever reads the outcome from the file finds the failure already logged.
    await request.recordFailure(outcome.failure);
    writeHandover(request.handoverFilePath, { state: 'failed', ...outcome.failure, afterRelease: outcome.verdict === 'taken-back' });
  }
  return outcome;
}

/** It keeps driving until `ready`, then lets go, and learns whether the successor serves. */
async function handOverSteps(request: HandOverRequest): Promise<HandoverOutcome> {
  if (request.successor === null) {
    return { verdict: 'kept-driving', failure: { successorCodeVersion: request.successorCodeVersion, step: 'spawn', error: 'the successor could not be started' } };
  }
  const { readyTries, releaseTries } = request.schedule;
  const ready = await awaitReport(request, readyTries, (report) => report.state === 'ready' || report.state === 'successor-failed');
  if (ready.verdict !== 'report') return { verdict: 'kept-driving', failure: unreportedFailure(request, ready, 'report-ready', readyTries) };
  if (ready.report.state === 'successor-failed') return { verdict: 'kept-driving', failure: failureOf(ready.report) };

  await request.release();
  writeHandover(request.handoverFilePath, { state: 'released' });
  const served = await awaitReport(request, releaseTries, (report) => report.state === 'serving' || report.state === 'successor-failed');
  if (served.verdict !== 'report') return { verdict: 'taken-back', failure: unreportedFailure(request, served, 'serve', releaseTries) };
  if (served.report.state === 'successor-failed') return { verdict: 'taken-back', failure: failureOf(served.report) };
  if (served.report.state !== 'serving') return { verdict: 'taken-back', failure: unreportedFailure(request, { verdict: 'exited' }, 'serve', releaseTries) };
  const { successorCodeVersion, generation, url } = served.report;
  return {
    verdict: 'handed-over', successorCodeVersion, generation, url
  };
}

function reportFailure(request: Pick<SuccessorRequest, 'handoverFilePath' | 'codeVersion'>, step: HandoverStep, thrown: unknown, afterRelease: boolean): void {
  writeHandover(request.handoverFilePath, {
    state: 'successor-failed', successorCodeVersion: request.codeVersion, step, error: errorTextOf(thrown), afterRelease
  });
}

/** Runs each step in order; the first that throws is reported with its error, and nothing after it runs. */
async function stepsSucceeded(steps: readonly HandoverStepRun[], onFailure: (step: HandoverStep, thrown: unknown) => Promise<void> | void): Promise<boolean> {
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
async function prepareAndAwaitRelease(request: SuccessorRequest, preparation: readonly HandoverStepRun[]): Promise<SuccessorAdmission> {
  if (!await stepsSucceeded(preparation, (step, thrown) => reportFailure(request, step, thrown, false))) return 'failed';
  writeHandover(request.handoverFilePath, { state: 'ready', successorCodeVersion: request.codeVersion });
  for (let attempt = 0; attempt < request.schedule.releaseTries; attempt++) {
    if (readHandover(request.handoverFilePath)?.state === 'released') return 'released';
    if (!request.predecessorIsLive()) return 'predecessor-gone';
    await Bun.sleep(request.schedule.intervalMilliseconds);
  }
  reportFailure(request, 'await-release', new Error(`no release within ${request.schedule.releaseTries} tries`), false);
  return 'failed';
}

function reportServing(request: Pick<SuccessorRequest, 'handoverFilePath' | 'codeVersion'>, generation: number, url: string): void {
  writeHandover(request.handoverFilePath, {
    state: 'serving', successorCodeVersion: request.codeVersion, generation, url
  });
}

export const RunnerHandover = Object.freeze({
  handoverFilePathOf,
  readHandover,
  writeHandover,
  handOver,
  prepareAndAwaitRelease,
  reportFailure,
  reportServing,
});
