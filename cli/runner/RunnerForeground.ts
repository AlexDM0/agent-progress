/**
 * `run` in the foreground: wins the lease, serves the board's API and lives until a stop signal, a `runner-stop` command, a handover to a
 * successor on the code on disk after `runner-restart`, or a newer generation taking the board over, which ends it `lease-taken-over`
 * (exit 2) without touching what the new runner holds. `run --successor-of <generation>` is that successor's side of the handover.
 */
import { randomBytes } from 'node:crypto';
import {
  appendFileSync,
  chmodSync,
  closeSync,
  mkdirSync,
  openSync,
  watch
} from 'node:fs';
import { join } from 'node:path';

import { createProgressPageStubWriter }                    from '../../src/adapters/progress-page/ProgressPageStubWriter.ts';
import { HOST_PROTOCOL_VERSION }                           from '../../src/lib/agent-host/constants/HostProtocol.ts';
import { writeFileAtomically }                             from '../../src/lib/atomic-file/AtomicFile.ts';
import { GitProcess }                                      from '../../src/lib/git/GitProcess.ts';
import { LocalTimeUtil }                                   from '../../src/lib/local-time/LocalTimeUtil.ts';
import { identityOf, type ProcessIdentity }                from '../../src/lib/process-identity/ProcessIdentity.ts';
import { readingBoardOf }                                  from '../../src/lib/tracker-model/ReadingBoard.ts';
import { BoardWatcher }                                    from '../../src/services/runner/BoardWatcher.ts';
import { CodeVersion }                                     from '../../src/services/runner/CodeVersion.ts';
import { createDrivePass, type DrivePass }                 from '../../src/services/runner/DrivePass.ts';
import { createEventBroker, type EventBroker }             from '../../src/services/runner/EventBroker.ts';
import { HOST_ENTRY_PATH, HostBundle }                     from '../../src/services/runner/HostBundle.ts';
import { HostFleet }                                       from '../../src/services/runner/HostFleet.ts';
import { createInstallChangeWatch, versionsFromTheBinary } from '../../src/services/runner/InstallChangeWatch.ts';
import { LegacyHostReader }                                from '../../src/services/runner/LegacyHostReader.ts';
import { runnerFilesIn, type RunnerFiles }                 from '../../src/services/runner/RunnerFiles.ts';
import {
  type HandoverFailure,
  type HandoverOutcome,
  type HandoverSchedule,
  type HandoverStep,
  type HandoverStepRun,
  type RebindOutcome,
  RunnerHandover
} from '../../src/services/runner/RunnerHandover.ts';
import { RunnerLease, type RunnerLeaseAcquisition, type RunnerLeaseRecord } from '../../src/services/runner/RunnerLease.ts';
import type { RunnerPortChoice }                                            from '../../src/services/runner/RunnerPort.ts';
import { RunnerServer, type RunnerServer as StartedServer }                 from '../../src/services/runner/RunnerServer.ts';
import { registerWithTheMonitor, type MonitorRegistrationRequest }          from '../../src/services/tracker/MonitorRegistration.ts';
import { requireProgressFile }                                              from '../../src/services/tracker/TrackerReader.ts';
import type { Workspace }                                                   from '../../src/services/tracker/Workspace.ts';
import { environmentCopy }                                                  from '../../src/shared/Environment.ts';
import { OperationRefusal }                                                 from '../../src/shared/OperationRefusal.ts';
import { PRODUCT_NAMES }                                                    from '../../src/shared/constants/ProductNames.ts';
import {
  HANDOVER_READY_INTERVAL_MILLISECONDS,
  HANDOVER_READY_TRIES,
  HANDOVER_REBIND_TRIES,
  HANDOVER_RELEASE_TRIES
} from '../../src/shared/constants/RunnerLimits.ts';
import type { CommandContext }                      from '../CommandContext.ts';
import { requireCurrentInstall }                    from '../InstallVersionCheck.ts';
import { openTrackerForWriting }                    from '../OpenTrackerForWriting.ts';
import { CLAUDE_MANAGED_BLOCK_MARKERS }             from '../adoption/constants/ClaudeManagedBlockMarkers.ts';
import type { ArgumentParser }                      from '../arguments/ArgumentParser.ts';
import { INSTALL_VERSION }                          from '../constants/InstallVersion.ts';
import { OutputUtil }                               from '../utils/OutputUtil.ts';
import { RunnerWording }                            from './RunnerWording.ts';
import { createMergeForecastCache, readBoardState } from './routes/BoardStateReader.ts';
import type { RuntimeRunnerCommand }                from './routes/CommandRoute.ts';
import { overseerRoutesOf }                         from './routes/OverseerRoutes.ts';

export interface ForegroundRunRequest {
  commandArguments: ArgumentParser;
  context:          CommandContext;
  workspace:        Workspace;
  portChoice:       RunnerPortChoice;
  /** Set for `run --successor-of <generation>`: the generation this process takes the board over from. */
  successorOf?:     number;
}

type RunnerEnd = { kind: 'stopped'; how: string } | { kind: 'restart' } | { kind: 'taken-over'; refusal: unknown };

/** One serving period under one lease generation; a handover that failed after the release starts another in the same process. */
interface Serving {
  generation: number;
  server:     StartedServer;
  drivePass:  DrivePass;
  watcher:    { stop: () => void };
  lifetime:   ReturnType<typeof runnerLifetime>;
}

const OWNER_ONLY_FOLDER_MODE = 0o700;
const OWNER_ONLY_FILE_MODE   = 0o600;
const TOKEN_BYTES            = 32;
const DEFAULT_MAIN_LINE      = 'main';

const HANDOVER_SCHEDULE: HandoverSchedule = { readyTries: HANDOVER_READY_TRIES, releaseTries: HANDOVER_RELEASE_TRIES, intervalMilliseconds: HANDOVER_READY_INTERVAL_MILLISECONDS };

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

function leaseRefusalOf(acquisition: Exclude<RunnerLeaseAcquisition, { verdict: 'acquired' }>, files: RunnerFiles): OperationRefusal {
  if (acquisition.verdict === 'contended') return new OperationRefusal('refused', { kind: 'runner-contended', runnerDirectory: files.runnerDirectory });
  return alreadyRunningRefusal(files, acquisition.generation, acquisition.record);
}

/** Resolves once the runner should end or hand over, and is settled at most once. */
function runnerLifetime(request: ForegroundRunRequest, files: RunnerFiles, generation: number, log: (line: string) => void) {
  let finish: (end: RunnerEnd) => void = () => undefined;
  const ended = new Promise<RunnerEnd>((resolve) => { finish = resolve; });
  // Each drive pass checks before its effects; this watch ends an idle runner as soon as a newer generation appears.
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
    restart:       () => finish({ kind: 'restart' }),
    takenOver:     (refusal: unknown) => finish({ kind: 'taken-over', refusal }),
    stopWatching:  () => watcher.close(),
    // Kept until the stop has finished, so a second SIGTERM during it is taken as the same stop rather than killing it halfway.
    stopListening: unsubscribe,
  };
}

/** The branch the main checkout has out is the main line the runner lands onto; a detached or unreadable HEAD reads as `main`. */
function mainLineOf(repositoryRoot: string): string {
  const head = GitProcess.run(repositoryRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  return GitProcess.succeeded(head) && head.standardOutput.trim() !== '' ? head.standardOutput.trim() : DEFAULT_MAIN_LINE;
}

function tipOf(repositoryRoot: string, branch: string): string | null {
  const tip = GitProcess.run(repositoryRoot, ['rev-parse', '--verify', '--quiet', branch]);
  return GitProcess.succeeded(tip) ? tip.standardOutput.trim() : null;
}

/** Read on every look: an `update` while the runner serves leaves the manifest ahead of the code in memory. */
function manifestMatchesIn(repositoryRoot: string): boolean {
  try {
    requireCurrentInstall(repositoryRoot);
    return true;
  } catch {
    return false;
  }
}

/** What the successor proves before it reports `ready`, holding no lease and writing nothing but its bundles. */
function preparationSteps(request: ForegroundRunRequest, pinHostBundle: () => Promise<string>): readonly HandoverStepRun[] {
  const { workspace } = request;
  const jobsOf = () => requireProgressFile(workspace).jobs ?? [];
  const steps: readonly HandoverStepRun[] = [
    {
      step: 'build-bundles',
      run:  async () => { await pinHostBundle(); },
    },
    { step: 'read-board', run: () => { readingBoardOf(requireProgressFile(workspace), [], []); } },
    {
      step: 'read-jobs',
      run:  () => {
        for (const job of jobsOf()) {
          if (!Number.isSafeInteger(job.hostInstance) || !Number.isSafeInteger(job.eventCursor.sequence)) throw new Error(`job ${job.id} has no readable host instance or cursor`);
        }
      },
    },
    {
      step: 'read-host-files',
      run:  () => {
        for (const job of jobsOf()) {
          const jobFolder = HostFleet.jobFolderOf(workspace.trackerDirectory, job.id);
          if (HostFleet.livenessOf(jobFolder, job.hostInstance).verdict === 'unclaimed') continue;
          const record = HostFleet.hostRecordOf(jobFolder, job.hostInstance);
          if (record === null) throw new Error(`host ${job.hostInstance} of job ${job.id} has no readable host file`);
          if (!LegacyHostReader.readableEventLogFormats().includes(record.eventLogFormatVersion)) {
            throw new Error(`host ${job.hostInstance} of job ${job.id} writes event-log format ${record.eventLogFormatVersion}, which this code does not read`);
          }
          if (HostFleet.eventsAfter(jobFolder, job.hostInstance, 0) === 'malformed') throw new Error(`the event log of host ${job.hostInstance} of job ${job.id} is malformed`);
        }
      },
    },
    { step: 'install-version', run: () => { requireCurrentInstall(workspace.rootDirectory); } },
  ];
  return steps;
}

/** The successor on the code on disk, detached in its own process group so it outlives this runner; `null` when it did not start. */
function spawnSuccessor(context: CommandContext, workspace: Workspace, files: RunnerFiles, generation: number, port: number): ProcessIdentity | null {
  if (context.programCommand.length === 0) return null;
  // Its own lines reach the log through its logger; what it prints before it has one, such as a refusal, is appended here.
  const logFileDescriptor = openSync(files.logFilePath, 'a');
  try {
    const child = Bun.spawn([...context.programCommand, 'run', '--successor-of', String(generation), '--port', String(port)], {
      cwd: workspace.rootDirectory, stdin: 'ignore', stdout: 'ignore', stderr: logFileDescriptor, detached: true,
    });
    child.unref();
    return identityOf(child.pid);
  } catch {
    return null;
  } finally {
    closeSync(logFileDescriptor);
  }
}

export async function runRunnerInTheForeground(request: ForegroundRunRequest): Promise<void> {
  const { context, workspace } = request;
  const progress = requireProgressFile(workspace);
  const files    = runnerFilesIn(workspace.trackerDirectory);
  mkdirSync(files.runnerDirectory, { recursive: true, mode: OWNER_ONLY_FOLDER_MODE });
  if (request.successorOf === undefined) requireNoLiveRunner(files);

  const readIdentity = identityOf(process.pid);
  if (readIdentity === null) throw new OperationRefusal('unrepaired', { kind: 'runner-identity-unreadable', processId: process.pid });
  const ownIdentity: ProcessIdentity = readIdentity;
  const codeVersion = CodeVersion.onDisk();
  const log         = runnerLoggerOf(context, files);
  const mainLine    = mainLineOf(workspace.rootDirectory);
  const mergeForecastCache = createMergeForecastCache();
  const installWatch = createInstallChangeWatch({
    inMemory:        { codeVersion, installVersion: INSTALL_VERSION },
    versionsOnDisk:  () => versionsFromTheBinary(context.programCommand, workspace.rootDirectory),
    manifestMatches: () => manifestMatchesIn(workspace.rootDirectory),
    landingMark:     () => tipOf(workspace.rootDirectory, mainLine),
  });

  let hostBundlePath: string | null = null;
  const pinHostBundle = async (): Promise<string> => {
    hostBundlePath ??= await HostBundle.pinHostBundle({ runnerDirectory: files.runnerDirectory, codeVersion, entryPath: HOST_ENTRY_PATH });
    return hostBundlePath;
  };

  let token: string | null = null;
  let current: Serving | null = null;
  let handingOver = false;
  let handoverWarning: HandoverFailure | null = null;
  let printedTheUrl = false;

  const runnerState = () => {
    const passState = current?.drivePass.state();
    if (passState === undefined) return null;
    return { ...passState, runtimeState: handingOver ? 'handing-over' as const : passState.runtimeState, handoverWarning };
  };

  /** Binds, takes a generation through `acquireLease`, records the start and reattaches every host; whatever it took is let go on a failure. */
  async function startServing(
    portChoice: RunnerPortChoice,
    acquireLease: (record: RunnerLeaseRecord) => RunnerLeaseAcquisition,
    enterStep: (step: HandoverStep) => void,
  ): Promise<Serving> {
    const bundlePath = await pinHostBundle();
    let lifetime: ReturnType<typeof runnerLifetime> | null = null;
    let drivePass: DrivePass | null = null;
    enterStep('bind-port');
    let broker: EventBroker | null = null;
    let servedUrl: string | null = null;
    const overseerFactsNow = () => {
      const state = runnerState();
      return {
        state:           state?.runtimeState ?? 'serving',
        url:             servedUrl,
        generation:      state?.generation ?? null,
        codeVersion,
        installVersion:  INSTALL_VERSION,
        handoverWarning: state?.handoverWarning ?? null,
      } as const;
    };
    const server = RunnerServer.start({
      portChoice,
      identity: {
        trackerId: progress.trackerId, project: progress.project, codeVersion, installVersion: INSTALL_VERSION, processId: process.pid,
      },
      routes: overseerRoutesOf({
        commandArguments: request.commandArguments,
        context,
        workspace,
        token:            () => token,
        broker:           () => broker,
        wake:             () => drivePass?.wake(),
        launchesHeld:     () => runnerState()?.runtimeState === 'held-by-install-change',
        notices:          () => runnerState()?.notices ?? [],
        overseer:         overseerFactsNow,
        mainLine,
        mergeForecastCache,
        silentSweepsOf:   (jobId: string) => current?.drivePass.silentSweepsOf(jobId) ?? 0,
        onRuntimeCommand: (command: RuntimeRunnerCommand) => {
          log(`${command.kind} received${command.now ? ' (now)' : ''}.`);
          if (current === null || handingOver) return;
          if (command.kind === 'runner-restart') {
          // Set at once, so a second command during this handover never overwrites what the successor reported.
            handingOver = true;
            // Written before the command is answered, so whoever sent it never reads an earlier handover's outcome.
            RunnerHandover.writeHandover(RunnerHandover.handoverFilePathOf(files.runnerDirectory, current.generation), { state: 'requested' });
            current.lifetime.restart();
            return;
          }
          current.lifetime.stopFor(command.kind);
        },
      }),
    });

    enterStep('take-lease');
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
    const acquisition = acquireLease(record);
    if (acquisition.verdict !== 'acquired') {
      await server.stop();
      throw leaseRefusalOf(acquisition, files);
    }
    const { generation } = acquisition;
    const ownBroker = createEventBroker(generation);
    const publishState = () => {
      try {
        ownBroker.publishState(readBoardState({
          context,
          workspace,
          notices:        () => runnerState()?.notices ?? [],
          overseer:       overseerFactsNow,
          silentSweepsOf: (jobId) => current?.drivePass.silentSweepsOf(jobId) ?? 0,
          mainLine,
          mergeForecastCache,
        }).state);
      } catch (thrown) {
        log(`The board state could not be read for the event stream: ${thrown instanceof Error ? thrown.message : String(thrown)}`);
      }
    };
    broker    = ownBroker;
    servedUrl = server.url;
    let watcher: { stop: () => void } | null = null;
    try {
      token    = writeToken(files);
      lifetime = runnerLifetime(request, files, generation, log);
      enterStep('reattach');
      await openTrackerForWriting(request.commandArguments, context, (change) => {
        // Before the record it looks for: only the first start on a board holds the v16 leftovers.
        change.board.holdFirstRunLeftovers(change.at);
        return change.board.recordRunnerStarted({ codeVersion, installVersion: INSTALL_VERSION }, change.at);
      });
      await registerRunner(request, { url: server.url, processId: process.pid, startedAt: LocalTimeUtil.formatLocalIso(context.now()) });
      createProgressPageStubWriter(workspace.htmlFilePath).write(server.url);
      log(`Runner serving ${server.url} under lease ${generation} (code ${codeVersion}, install version ${INSTALL_VERSION}, agents ${context.agentAdapter.vendor}).`);
      if (!printedTheUrl) OutputUtil.printEntity(request.commandArguments, context, { url: server.url, generation }, server.url);
      printedTheUrl = true;

      const startedLifetime = lifetime;
      drivePass = createDrivePass({
        workspace,
        now:                   context.now,
        formatStamp:           (moment) => LocalTimeUtil.formatLocalIso(moment),
        runnerDirectory:       files.runnerDirectory,
        generation,
        hostBundlePath:        bundlePath,
        codeVersion,
        agentAdapter:          context.agentAdapter,
        monitorFolder:         join(context.homeDirectory, PRODUCT_NAMES.MONITOR_FOLDER),
        inheritedEnvironment:  environmentCopy(),
        mainLine,
        managedBlockMarker:    CLAUDE_MANAGED_BLOCK_MARKERS.start,
        installVersionChanged: installWatch.installVersionChanged,
        newCodeOnDisk:         installWatch.newCodeOnDisk,
        decisionWordingOf:     RunnerWording.decisionWordingOf,
        launchTextOf:          RunnerWording.launchTextOf,
        assistantChatTextOf:   RunnerWording.assistantChatTextOf,
        windDownMessage:       RunnerWording.windDownMessage(),
        resumeMessage:         RunnerWording.resumeMessage(),
        answerMessageOf:       RunnerWording.answerMessageOf,
        homeDirectory:         context.homeDirectory,
        log,
        onLeaseTakenOver:      (refusal) => (current?.lifetime ?? startedLifetime).takenOver(refusal),
        afterPass:             publishState,
      });
      const startedPass = drivePass;
      watcher = BoardWatcher.startWatching({
        trackerDirectory: workspace.trackerDirectory,
        repositoryRoot:   workspace.rootDirectory,
        wake:             () => startedPass.wake(),
        onSweep:          () => {
          installWatch.noteSweep();
          startedPass.sweep();
          // A sweep changes the silent-sweep counts without a pass; the broker sends only the jobs whose count moved.
          publishState();
        },
      });
      const serving: Serving = {
        generation, server, drivePass, watcher, lifetime
      };
      current = serving;
      publishState();
      await drivePass.reattach();
      return serving;
    } catch (thrown) {
      watcher?.stop();
      lifetime?.stopWatching();
      lifetime?.stopListening();
      await drivePass?.stop();
      await server.stop();
      RunnerLease.release(files.runnerDirectory, generation);
      throw thrown;
    }
  }

  /** The release half of a handover: a landing in progress finishes, no effect batch starts, and the listener closes; no host is sent anything. */
  async function release(serving: Serving): Promise<void> {
    handingOver = true;
    serving.lifetime.stopWatching();
    serving.watcher.stop();
    await serving.drivePass.stop();
    await openTrackerForWriting(request.commandArguments, context, (change) => change.board.recordRunnerStopped('handed-over', change.at));
    await serving.server.stop();
    log('Released the board to the successor.');
  }

  async function handOver(serving: Serving, successor: ProcessIdentity | null): Promise<HandoverOutcome> {
    log(`Handing the board over to the code on disk (lease ${serving.generation}).`);
    return await RunnerHandover.handOver({
      handoverFilePath:     RunnerHandover.handoverFilePathOf(files.runnerDirectory, serving.generation),
      successor,
      successorCodeVersion: CodeVersion.onDisk(),
      release:              () => release(serving),
      recordFailure:        recordHandoverFailure,
      schedule:             HANDOVER_SCHEDULE,
    });
  }

  async function recordHandoverFailure(failure: HandoverFailure): Promise<void> {
    handoverWarning = failure;
    log(`The handover failed at ${failure.step}: ${failure.error}. This runner keeps driving.`);
    await openTrackerForWriting(request.commandArguments, context, (change) => change.board.recordRunnerHandoverFailed(failure, change.at));
  }

  /** A taken-back board whose port never came free: the failure, naming the port, is logged and recorded before the runner exits 1. */
  async function lostPortRefusal(port: number, rebound: Exclude<RebindOutcome<Serving>, { verdict: 'bound' }>): Promise<OperationRefusal> {
    const cause = rebound.verdict === 'successor-live' ? 'the killed successor was still live' : rebound.error;
    const failure: HandoverFailure = {
      successorCodeVersion: CodeVersion.onDisk(),
      step:                 'bind-port',
      error:                `port ${port} could not be bound again within ${HANDOVER_REBIND_TRIES} tries: ${cause}`,
    };
    handoverWarning = failure;
    log(`Taking the board back failed: ${failure.error}. This runner exits with no runner on the board.`);
    await openTrackerForWriting(request.commandArguments, context, (change) => change.board.recordRunnerHandoverFailed(failure, change.at));
    return new OperationRefusal('refused', { kind: 'runner-handover-failed', ...failure, url: null });
  }

  /** Proves the new code, waits for the release, then serves; a failure is left in the handover file and the process exits 1. */
  async function takeOverAsSuccessor(predecessorGeneration: number): Promise<Serving> {
    const handoverFilePath = RunnerHandover.handoverFilePathOf(files.runnerDirectory, predecessorGeneration);
    const admission = await RunnerHandover.prepareAndAwaitRelease({
      handoverFilePath,
      codeVersion,
      predecessorIsLive: () => {
        const newest = RunnerLease.newestLeaseOf(files.runnerDirectory);
        return newest.verdict === 'live' && newest.generation === predecessorGeneration;
      },
      schedule: HANDOVER_SCHEDULE,
    }, preparationSteps(request, pinHostBundle));
    if (admission === 'failed') {
      const report = RunnerHandover.readHandover(handoverFilePath);
      const reported = report?.state === 'successor-failed' || report?.state === 'failed';
      const failure  = reported ? report : { successorCodeVersion: codeVersion, step: 'report-ready', error: 'no report was left' };
      throw new OperationRefusal('refused', {
        kind: 'runner-handover-failed', successorCodeVersion: failure.successorCodeVersion, step: failure.step, error: failure.error, url: null
      });
    }
    log(admission === 'released' ? `Lease ${predecessorGeneration} released the board; taking it over.` : `Lease ${predecessorGeneration} is gone; starting as after a crash.`);
    return await startAsSuccessor(predecessorGeneration, admission);
  }

  let serving = request.successorOf === undefined
    ? await startServing(request.portChoice, (record) => RunnerLease.acquire(files.runnerDirectory, record), () => undefined)
    : await takeOverAsSuccessor(request.successorOf);

  async function startAsSuccessor(predecessorGeneration: number, admission: 'released' | 'predecessor-gone'): Promise<Serving> {
    let step: HandoverStep = 'bind-port';
    const handoverFilePath = RunnerHandover.handoverFilePathOf(files.runnerDirectory, predecessorGeneration);
    try {
      const acquireLease = admission === 'released'
        ? (record: RunnerLeaseRecord) => RunnerLease.acquireAbove(files.runnerDirectory, record, predecessorGeneration)
        : (record: RunnerLeaseRecord) => RunnerLease.acquire(files.runnerDirectory, record);
      const started = await startServing(request.portChoice, acquireLease, (entered) => { step = entered; });
      RunnerHandover.reportServing({ handoverFilePath, codeVersion }, started.generation, started.server.url);
      return started;
    } catch (thrown) {
      RunnerHandover.reportFailure({ handoverFilePath, codeVersion }, step, thrown, admission === 'released');
      throw thrown;
    }
  }

  for (;;) {
    const end = await serving.lifetime.ended;
    if (end.kind === 'restart') {
      const successor = spawnSuccessor(context, workspace, files, serving.generation, serving.server.port);
      const outcome = await handOver(serving, successor);
      if (outcome.verdict === 'handed-over') {
        log(`Handed the board over to code ${outcome.successorCodeVersion} at ${outcome.url} under lease ${outcome.generation}; exiting.`);
        serving.lifetime.stopListening();
        return;
      }
      if (outcome.verdict === 'kept-driving') {
        serving.lifetime.stopWatching();
        serving.lifetime.stopListening();
        serving.lifetime = runnerLifetime(request, files, serving.generation, log);
        handingOver = false;
        const drivenOn = serving;
        serving.drivePass.wake(true);
        current = drivenOn;
        continue;
      }
      serving.lifetime.stopListening();
      const failedGeneration = serving.generation + 1;
      const takeBack = (record: RunnerLeaseRecord) => RunnerLease.acquireAbove(files.runnerDirectory, record, failedGeneration);
      const { port } = serving.server;
      const rebound = await RunnerHandover.rebindAfterTakeBack({
        successor,
        tries:                HANDOVER_REBIND_TRIES,
        intervalMilliseconds: HANDOVER_READY_INTERVAL_MILLISECONDS,
        bind:                 () => startServing({ kind: 'given', port }, takeBack, () => undefined),
      });
      if (rebound.verdict !== 'bound') throw await lostPortRefusal(port, rebound);
      serving = rebound.bound;
      handingOver = false;
      continue;
    }
    serving.lifetime.stopWatching();
    serving.watcher.stop();
    await serving.drivePass.idle();
    try {
      await serving.server.stop();
      if (end.kind === 'taken-over') {
        log('A newer runner took the board over; stopping without acting.');
        throw end.refusal;
      }
      await openTrackerForWriting(request.commandArguments, context, (change) => change.board.recordRunnerStopped('stopped', change.at));
      await registerRunner(request, 'removed');
      createProgressPageStubWriter(workspace.htmlFilePath).write(null);
      RunnerLease.release(files.runnerDirectory, serving.generation);
      log('Runner stopped; its lease is released.');
    } finally {
      serving.lifetime.stopListening();
    }
    return;
  }
}
