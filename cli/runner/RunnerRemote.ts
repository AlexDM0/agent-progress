/**
 * What the CLI does to a runner it is not: start one detached, ask the live one to stop, and wait for its lease to go. A stop goes to the
 * API with the token; when the API does not answer, the lease's process is sent SIGTERM, its identity checked first. Agent hosts are
 * never touched.
 */
import { readFileSync } from 'node:fs';

import { identityOf, sameProcess }             from '../../src/lib/process-identity/ProcessIdentity.ts';
import type { RunnerFiles }                    from '../../src/services/runner/RunnerFiles.ts';
import { RunnerLease, type RunnerLeaseRecord } from '../../src/services/runner/RunnerLease.ts';
import { OperationRefusal }                    from '../../src/shared/OperationRefusal.ts';
import {
  RUNNER_READY_INTERVAL_MILLISECONDS,
  RUNNER_READY_TRIES,
  RUNNER_REQUEST_TIMEOUT_MILLISECONDS,
  RUNNER_STOP_INTERVAL_MILLISECONDS,
  RUNNER_STOP_TRIES
} from '../../src/shared/constants/RunnerLimits.ts';
import type { CommandContext } from '../CommandContext.ts';

export type RuntimeStopKind = 'runner-stop' | 'runner-restart';

export type StopOutcome = { verdict: 'was-down' } | { verdict: 'stopped'; record: RunnerLeaseRecord };

function tokenIn(record: RunnerLeaseRecord): string | null {
  try {
    return readFileSync(record.tokenFile, 'utf8').trim();
  } catch {
    return null;
  }
}

async function identityAnswers(record: RunnerLeaseRecord): Promise<boolean> {
  try {
    const response = await fetch(new URL('api/identity', record.url), { signal: AbortSignal.timeout(RUNNER_REQUEST_TIMEOUT_MILLISECONDS) });
    return response.ok;
  } catch {
    return false;
  }
}

async function commandWasTaken(record: RunnerLeaseRecord, kind: RuntimeStopKind, now: boolean): Promise<boolean> {
  const token = tokenIn(record);
  if (token === null) return false;
  try {
    const response = await fetch(new URL('api/commands', record.url), {
      method:  'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body:    JSON.stringify({ kind, now }),
      signal:  AbortSignal.timeout(RUNNER_REQUEST_TIMEOUT_MILLISECONDS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** SIGTERM only to the process the lease names, still being that process: a reused pid is never signalled. */
function signalTheLeaseProcess(record: RunnerLeaseRecord): void {
  const currentIdentity = identityOf(record.processId);
  const leaseIdentity   = { processId: record.processId, startEpochSeconds: record.processStartEpochSeconds, bootIdentity: record.bootIdentity };
  if (currentIdentity === null || !sameProcess(currentIdentity, leaseIdentity)) return;
  try {
    process.kill(record.processId, 'SIGTERM');
  } catch {
    // Gone between the check and the signal: what the wait below sees.
  }
}

/** Gone or naming a dead identity: either lets a successor start, as after a crash. */
async function waitForTheLeaseToGo(files: RunnerFiles, generation: number): Promise<boolean> {
  for (let attempt = 0; attempt < RUNNER_STOP_TRIES; attempt++) {
    const newest = RunnerLease.newestLeaseOf(files.runnerDirectory);
    if (newest.verdict !== 'live' || newest.generation !== generation) return true;
    await Bun.sleep(RUNNER_STOP_INTERVAL_MILLISECONDS);
  }
  return false;
}

async function stopTheLiveRunner(files: RunnerFiles, kind: RuntimeStopKind, now: boolean): Promise<StopOutcome> {
  const newest = RunnerLease.newestLeaseOf(files.runnerDirectory);
  if (newest.verdict !== 'live') return { verdict: 'was-down' };
  if (!await commandWasTaken(newest.record, kind, now)) signalTheLeaseProcess(newest.record);
  if (!await waitForTheLeaseToGo(files, newest.generation)) {
    throw new OperationRefusal('refused', { kind: 'runner-still-live', url: newest.record.url, processId: newest.record.processId });
  }
  return { verdict: 'stopped', record: newest.record };
}

/** The same program, detached in its own process group with its streams dropped; the runner logs to `runner.log` itself. */
async function startDetached(context: CommandContext, files: RunnerFiles, runArguments: readonly string[]): Promise<string> {
  if (context.programCommand.length === 0) throw new Error('This process has no program command to start a detached runner from.');
  const child = Bun.spawn([...context.programCommand, 'run', ...runArguments], {
    cwd: context.currentDirectory, stdin: 'ignore', stdout: 'ignore', stderr: 'ignore', detached: true,
  });
  child.unref();
  for (let attempt = 0; attempt < RUNNER_READY_TRIES; attempt++) {
    await Bun.sleep(RUNNER_READY_INTERVAL_MILLISECONDS);
    if (child.exitCode !== null) break;
    const newest = RunnerLease.newestLeaseOf(files.runnerDirectory);
    if (newest.verdict === 'live' && newest.record.processId === child.pid && await identityAnswers(newest.record)) return newest.record.url;
  }
  throw new OperationRefusal('refused', { kind: 'runner-did-not-start', exitCode: child.exitCode, logFilePath: files.logFilePath });
}

export const RunnerRemote = Object.freeze({ stopTheLiveRunner, startDetached, identityAnswers });
