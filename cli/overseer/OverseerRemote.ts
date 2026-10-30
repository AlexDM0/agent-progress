/**
 * What the CLI does to an Overseer it is not: start one detached, ask the live one to stop, and wait for its Baton to go. A stop goes to the
 * API with the token; when the API does not answer, the Baton's process is sent SIGTERM, its identity checked first. Watchers are
 * never touched.
 */
import { readFileSync } from 'node:fs';

import { identityOf, sameProcess } from '../../src/lib/process-identity/ProcessIdentity.ts';
import { Baton, type BatonRecord } from '../../src/services/overseer/Baton.ts';
import { BatonPass }               from '../../src/services/overseer/BatonPass.ts';
import type { OverseerFiles }      from '../../src/services/overseer/OverseerFiles.ts';
import { OperationRefusal }        from '../../src/shared/OperationRefusal.ts';
import {
  BATON_PASS_OUTCOME_TRIES,
  BATON_PASS_READY_INTERVAL_MILLISECONDS,
  OVERSEER_READY_INTERVAL_MILLISECONDS,
  OVERSEER_READY_TRIES,
  OVERSEER_REQUEST_TIMEOUT_MILLISECONDS,
  OVERSEER_STOP_INTERVAL_MILLISECONDS,
  OVERSEER_STOP_TRIES
} from '../../src/shared/constants/OverseerLimits.ts';
import type { CommandContext } from '../CommandContext.ts';

export type RuntimeStopKind = 'overseer-stop' | 'overseer-restart';

export type StopOutcome = { verdict: 'was-down' } | { verdict: 'stopped'; record: BatonRecord };

function tokenIn(record: BatonRecord): string | null {
  try {
    return readFileSync(record.tokenFile, 'utf8').trim();
  } catch {
    return null;
  }
}

async function identityAnswers(record: BatonRecord): Promise<boolean> {
  try {
    const response = await fetch(new URL('api/identity', record.url), { signal: AbortSignal.timeout(OVERSEER_REQUEST_TIMEOUT_MILLISECONDS) });
    return response.ok;
  } catch {
    return false;
  }
}

async function commandWasTaken(record: BatonRecord, kind: RuntimeStopKind, now: boolean): Promise<boolean> {
  const token = tokenIn(record);
  if (token === null) return false;
  try {
    const response = await fetch(new URL('api/commands', record.url), {
      method:  'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body:    JSON.stringify({ kind, now }),
      signal:  AbortSignal.timeout(OVERSEER_REQUEST_TIMEOUT_MILLISECONDS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** SIGTERM only to the process the Baton names, still being that process: a reused pid is never signalled. */
function signalTheBatonProcess(record: BatonRecord): void {
  const currentIdentity = identityOf(record.processId);
  const batonIdentity   = { processId: record.processId, startEpochSeconds: record.processStartEpochSeconds, bootIdentity: record.bootIdentity };
  if (currentIdentity === null || !sameProcess(currentIdentity, batonIdentity)) return;
  try {
    process.kill(record.processId, 'SIGTERM');
  } catch {
    // Gone between the check and the signal: what the wait below sees.
  }
}

/** Gone or naming a dead identity: either lets a successor start, as after a crash. */
async function waitForTheBatonToGo(files: OverseerFiles, generation: number): Promise<boolean> {
  for (let attempt = 0; attempt < OVERSEER_STOP_TRIES; attempt++) {
    const newest = Baton.newestBatonOf(files.overseerDirectory);
    if (newest.verdict !== 'live' || newest.generation !== generation) return true;
    await Bun.sleep(OVERSEER_STOP_INTERVAL_MILLISECONDS);
  }
  return false;
}

async function stopTheLiveOverseer(files: OverseerFiles, kind: RuntimeStopKind, now: boolean): Promise<StopOutcome> {
  const newest = Baton.newestBatonOf(files.overseerDirectory);
  if (newest.verdict !== 'live') return { verdict: 'was-down' };
  if (!await commandWasTaken(newest.record, kind, now)) signalTheBatonProcess(newest.record);
  if (!await waitForTheBatonToGo(files, newest.generation)) {
    throw new OperationRefusal('refused', { kind: 'overseer-still-live', url: newest.record.url, processId: newest.record.processId });
  }
  return { verdict: 'stopped', record: newest.record };
}

export type RestartOutcome =
  | { verdict: 'was-down' }
  | { verdict: 'not-taken'; record: BatonRecord }
  | { verdict: 'handed-over'; successorCodeVersion: string; url: string };

/**
 * Asks the live Overseer for its checked Baton pass and reads the outcome it leaves in its Baton pass file; a failed one is refused
 * `baton-pass-failed`, the old Overseer still driving. An Overseer whose API does not take the command is the caller's to stop and restart.
 */
async function handOverTheLiveOverseer(files: OverseerFiles, now: boolean): Promise<RestartOutcome> {
  const newest = Baton.newestBatonOf(files.overseerDirectory);
  if (newest.verdict !== 'live') return { verdict: 'was-down' };
  if (!await commandWasTaken(newest.record, 'overseer-restart', now)) return { verdict: 'not-taken', record: newest.record };
  const batonPassFilePath = BatonPass.batonPassFilePathOf(files.overseerDirectory, newest.generation);
  for (let attempt = 0; attempt < BATON_PASS_OUTCOME_TRIES; attempt++) {
    const report = BatonPass.readBatonPass(batonPassFilePath);
    if (report?.state === 'serving') return { verdict: 'handed-over', successorCodeVersion: report.successorCodeVersion, url: report.url };
    if (report?.state === 'failed') {
      throw new OperationRefusal('refused', {
        kind: 'baton-pass-failed', successorCodeVersion: report.successorCodeVersion, step: report.step, error: report.error, url: newest.record.url
      });
    }
    await Bun.sleep(BATON_PASS_READY_INTERVAL_MILLISECONDS);
  }
  throw new OperationRefusal('refused', {
    kind: 'baton-pass-failed', successorCodeVersion: 'unknown', step: 'serve', error: `no outcome within ${BATON_PASS_OUTCOME_TRIES} tries`, url: newest.record.url
  });
}

/** The same program, detached in its own process group with its streams dropped; the Overseer logs to `overseer.log` itself. */
async function startDetached(context: CommandContext, files: OverseerFiles, runArguments: readonly string[]): Promise<string> {
  if (context.programCommand.length === 0) throw new Error('This process has no program command to start a detached Overseer from.');
  const child = Bun.spawn([...context.programCommand, 'oversee', ...runArguments], {
    cwd: context.currentDirectory, stdin: 'ignore', stdout: 'ignore', stderr: 'ignore', detached: true,
  });
  child.unref();
  for (let attempt = 0; attempt < OVERSEER_READY_TRIES; attempt++) {
    await Bun.sleep(OVERSEER_READY_INTERVAL_MILLISECONDS);
    if (child.exitCode !== null) break;
    const newest = Baton.newestBatonOf(files.overseerDirectory);
    if (newest.verdict === 'live' && newest.record.processId === child.pid && await identityAnswers(newest.record)) return newest.record.url;
  }
  throw new OperationRefusal('refused', { kind: 'overseer-did-not-start', exitCode: child.exitCode, logFilePath: files.logFilePath });
}

/** The live Overseer's state document, read without a token; `null` when it does not answer. */
async function stateOf(record: BatonRecord): Promise<unknown> {
  try {
    const response = await fetch(new URL('api/state', record.url), { signal: AbortSignal.timeout(OVERSEER_REQUEST_TIMEOUT_MILLISECONDS) });
    return response.ok ? await response.json() as unknown : null;
  } catch {
    return null;
  }
}

export const OverseerRemote = Object.freeze({
  stopTheLiveOverseer, handOverTheLiveOverseer, startDetached, identityAnswers, stateOf
});
