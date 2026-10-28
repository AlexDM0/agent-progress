/**
 * `run` in the foreground: wins the lease, serves the board's API and lives until a stop signal, a `runner-stop` or `runner-restart`
 * command, or a newer generation taking the board over, which ends it `lease-taken-over` (exit 2) without touching what the new runner holds.
 */
import { randomBytes } from 'node:crypto';
import {
  appendFileSync,
  chmodSync,
  mkdirSync,
  watch
} from 'node:fs';

import { HOST_PROTOCOL_VERSION }                                   from '../../src/lib/agent-host/constants/HostProtocol.ts';
import { writeFileAtomically }                                     from '../../src/lib/atomic-file/AtomicFile.ts';
import { LocalTimeUtil }                                           from '../../src/lib/local-time/LocalTimeUtil.ts';
import { identityOf }                                              from '../../src/lib/process-identity/ProcessIdentity.ts';
import { CodeVersion }                                             from '../../src/services/runner/CodeVersion.ts';
import { runnerFilesIn, type RunnerFiles }                         from '../../src/services/runner/RunnerFiles.ts';
import { RunnerLease, type RunnerLeaseRecord }                     from '../../src/services/runner/RunnerLease.ts';
import type { RunnerPortChoice }                                   from '../../src/services/runner/RunnerPort.ts';
import { RunnerServer }                                            from '../../src/services/runner/RunnerServer.ts';
import { registerWithTheMonitor, type MonitorRegistrationRequest } from '../../src/services/tracker/MonitorRegistration.ts';
import { requireProgressFile }                                     from '../../src/services/tracker/TrackerReader.ts';
import type { Workspace }                                          from '../../src/services/tracker/Workspace.ts';
import { OperationRefusal }                                        from '../../src/shared/OperationRefusal.ts';
import type { CommandContext }                                     from '../CommandContext.ts';
import { openTrackerForWriting }                                   from '../OpenTrackerForWriting.ts';
import type { ArgumentParser }                                     from '../arguments/ArgumentParser.ts';
import { INSTALL_VERSION }                                         from '../constants/InstallVersion.ts';
import { OutputUtil }                                              from '../utils/OutputUtil.ts';

export interface ForegroundRunRequest {
  commandArguments: ArgumentParser;
  context:          CommandContext;
  workspace:        Workspace;
  portChoice:       RunnerPortChoice;
}

type RunnerEnd = { kind: 'stopped'; how: string } | { kind: 'taken-over'; refusal: unknown };

const OWNER_ONLY_FOLDER_MODE = 0o700;
const OWNER_ONLY_FILE_MODE   = 0o600;
const TOKEN_BYTES            = 32;

/** Every line goes to standard error and is appended to `<data>/runner.log`, which a reader tails, so it is never rewritten whole. */
function runnerLoggerOf(context: CommandContext, files: RunnerFiles): (line: string) => void {
  return (line: string) => {
    const stampedLine = `${LocalTimeUtil.formatLocalIso(context.now())} ${line}`;
    context.standardError(stampedLine);
    try {
      appendFileSync(files.logFilePath, `${stampedLine}\n`);
    } catch {
      // The log is a convenience: a full disk never stops a runner that is otherwise serving.
    }
  };
}

function alreadyRunningRefusal(files: RunnerFiles, generation: number, record: RunnerLeaseRecord): OperationRefusal {
  const leaseFilePath = RunnerLease.leaseFilePathFor(files.runnerDirectory, generation);
  return new OperationRefusal('refused', { kind: 'runner-already-running', url: record.url, leaseFilePath });
}

export function requireNoLiveRunner(files: RunnerFiles): void {
  const newest = RunnerLease.newestLeaseOf(files.runnerDirectory);
  if (newest.verdict === 'live') throw alreadyRunningRefusal(files, newest.generation, newest.record);
}

/** A registry that cannot be written never fails the runner; the monitor only loses its pointer. */
async function registerRunner(request: ForegroundRunRequest, runner: MonitorRegistrationRequest['runner']): Promise<void> {
  const { context, workspace } = request;
  await registerWithTheMonitor({
    workspace,
    homeDirectory:        context.homeDirectory,
    temporaryDirectories: context.temporaryDirectories,
    command:              context.commandVerb,
    now:                  context.now,
    ...(runner === undefined ? {} : { runner }),
  });
}

function writeToken(files: RunnerFiles): string {
  const token = randomBytes(TOKEN_BYTES).toString('hex');
  writeFileAtomically(files.tokenFilePath, token);
  chmodSync(files.tokenFilePath, OWNER_ONLY_FILE_MODE);
  return token;
}

function leaseRefusalOf(acquisition: Exclude<ReturnType<typeof RunnerLease.acquire>, { verdict: 'acquired' }>, files: RunnerFiles): OperationRefusal {
  if (acquisition.verdict === 'contended') return new OperationRefusal('refused', { kind: 'runner-contended', runnerDirectory: files.runnerDirectory });
  return alreadyRunningRefusal(files, acquisition.generation, acquisition.record);
}

/** Resolves once the runner should end, and is settled at most once. */
function runnerLifetime(request: ForegroundRunRequest, files: RunnerFiles, generation: number, log: (line: string) => void) {
  let finish: (end: RunnerEnd) => void = () => undefined;
  const ended = new Promise<RunnerEnd>((resolve) => { finish = resolve; });
  // The runner has no effect batch of its own yet; a change in the lease folder is when one would start, so the check runs there.
  const beforeEffectBatch = () => {
    try {
      RunnerLease.requireNewestGeneration(files.runnerDirectory, generation);
    } catch (refusal) {
      finish({ kind: 'taken-over', refusal });
    }
  };
  const watcher     = watch(files.runnerDirectory, beforeEffectBatch);
  const unsubscribe = request.context.onStopSignal(() => {
    log('Stop signal received.');
    finish({ kind: 'stopped', how: 'signal' });
  });
  return {
    ended,
    stopFor:       (how: string) => finish({ kind: 'stopped', how }),
    stopWatching:  () => watcher.close(),
    // Kept until the stop has finished, so a second SIGTERM during it is taken as the same stop rather than killing it halfway.
    stopListening: unsubscribe,
  };
}

async function stopInOrder(request: ForegroundRunRequest, files: RunnerFiles, generation: number, log: (line: string) => void): Promise<void> {
  await openTrackerForWriting(request.commandArguments, request.context, (change) => change.board.recordRunnerStopped('stopped', change.at));
  await registerRunner(request, 'removed');
  RunnerLease.release(files.runnerDirectory, generation);
  log('Runner stopped; its lease is released.');
}

export async function runRunnerInTheForeground(request: ForegroundRunRequest): Promise<void> {
  const { context, workspace, portChoice } = request;
  const progress = requireProgressFile(workspace);
  const files    = runnerFilesIn(workspace.trackerDirectory);
  mkdirSync(files.runnerDirectory, { recursive: true, mode: OWNER_ONLY_FOLDER_MODE });
  requireNoLiveRunner(files);

  const ownIdentity = identityOf(process.pid);
  if (ownIdentity === null) throw new OperationRefusal('unrepaired', { kind: 'runner-identity-unreadable', processId: process.pid });
  const codeVersion = CodeVersion.onDisk();
  const log         = runnerLoggerOf(context, files);

  let token: string | null = null;
  let lifetime: ReturnType<typeof runnerLifetime> | null = null;
  const server = RunnerServer.start({
    portChoice,
    identity: {
      trackerId: progress.trackerId, project: progress.project, codeVersion, installVersion: INSTALL_VERSION, processId: process.pid,
    },
    token:            () => token,
    onRuntimeCommand: (command) => {
      log(`${command.kind} received${command.now ? ' (now)' : ''}.`);
      lifetime?.stopFor(command.kind);
    },
  });

  const record: RunnerLeaseRecord = {
    processId:                ownIdentity.processId,
    processStartEpochSeconds: ownIdentity.startEpochSeconds,
    bootIdentity:             ownIdentity.bootIdentity,
    port:                     server.port,
    url:                      server.url,
    tokenFile:                files.tokenFilePath,
    codeVersion,
    installVersion:           INSTALL_VERSION,
    hostProtocolVersion:      HOST_PROTOCOL_VERSION,
  };
  const acquisition = RunnerLease.acquire(files.runnerDirectory, record);
  if (acquisition.verdict !== 'acquired') {
    await server.stop();
    throw leaseRefusalOf(acquisition, files);
  }
  const { generation } = acquisition;
  token    = writeToken(files);
  lifetime = runnerLifetime(request, files, generation, log);

  await openTrackerForWriting(request.commandArguments, context, (change) => change.board.recordRunnerStarted({ codeVersion, installVersion: INSTALL_VERSION }, change.at));
  await registerRunner(request, { url: server.url, processId: process.pid, startedAt: LocalTimeUtil.formatLocalIso(context.now()) });
  log(`Runner serving ${server.url} under lease ${generation} (code ${codeVersion}, install version ${INSTALL_VERSION}).`);
  OutputUtil.printEntity(request.commandArguments, context, { url: server.url, generation }, server.url);

  const end = await lifetime.ended;
  lifetime.stopWatching();
  try {
    await server.stop();
    if (end.kind === 'taken-over') {
      log('A newer runner took the board over; stopping without acting.');
      throw end.refusal;
    }
    await stopInOrder(request, files, generation, log);
  } finally {
    lifetime.stopListening();
  }
}
