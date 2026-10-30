/**
 * `oversee` in the foreground: wins the Baton, serves the board's API and lives until a stop signal, a `overseer-stop` command, a Baton pass to a
 * successor on the code on disk after `overseer-restart`, or a newer generation taking the board over, which ends it `baton-taken`
 * (exit 2) without touching what the new Overseer holds. `oversee --successor-of <generation>` is that successor's side of the Baton pass.
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

import { createProgressPageStubWriter }                   from '../../src/adapters/progress-page/ProgressPageStubWriter.ts';
import { writeFileAtomically }                            from '../../src/lib/atomic-file/AtomicFile.ts';
import { GitProcess }                                     from '../../src/lib/git/GitProcess.ts';
import { LocalTimeUtil }                                  from '../../src/lib/local-time/LocalTimeUtil.ts';
import { identityOf, type ProcessIdentity }               from '../../src/lib/process-identity/ProcessIdentity.ts';
import { readingBoardOf }                                 from '../../src/lib/tracker-model/ReadingBoard.ts';
import { WATCHER_PROTOCOL_VERSION }                       from '../../src/lib/watcher/constants/WatcherProtocol.ts';
import { Baton, type BatonAcquisition, type BatonRecord } from '../../src/services/overseer/Baton.ts';
import {
  type BatonPassFailure,
  type BatonPassOutcome,
  type BatonPassSchedule,
  type BatonPassStep,
  type BatonPassStepRun,
  type RebindOutcome,
  BatonPass
} from '../../src/services/overseer/BatonPass.ts';
import { CodeVersion }                                             from '../../src/services/overseer/CodeVersion.ts';
import { DataFolderWatch }                                         from '../../src/services/overseer/DataFolderWatch.ts';
import { createDrivePass, type DrivePass }                         from '../../src/services/overseer/DrivePass.ts';
import { createEventBroker, type EventBroker }                     from '../../src/services/overseer/EventBroker.ts';
import { createInstallChangeWatch, versionsFromTheBinary }         from '../../src/services/overseer/InstallChangeWatch.ts';
import { LegacyWatcherReader }                                     from '../../src/services/overseer/LegacyWatcherReader.ts';
import { overseerFilesIn, type OverseerFiles }                     from '../../src/services/overseer/OverseerFiles.ts';
import type { OverseerPortChoice }                                 from '../../src/services/overseer/OverseerPort.ts';
import { OverseerServer, type OverseerServer as StartedServer }    from '../../src/services/overseer/OverseerServer.ts';
import { WATCHER_ENTRY_PATH, WatcherBundle }                       from '../../src/services/overseer/WatcherBundle.ts';
import { WatcherFleet }                                            from '../../src/services/overseer/WatcherFleet.ts';
import { registerWithTheMonitor, type MonitorRegistrationRequest } from '../../src/services/tracker/MonitorRegistration.ts';
import { requireProgressFile }                                     from '../../src/services/tracker/TrackerReader.ts';
import type { Workspace }                                          from '../../src/services/tracker/Workspace.ts';
import { environmentCopy }                                         from '../../src/shared/Environment.ts';
import { OperationRefusal }                                        from '../../src/shared/OperationRefusal.ts';
import {
  BATON_PASS_READY_INTERVAL_MILLISECONDS,
  BATON_PASS_READY_TRIES,
  BATON_PASS_REBIND_TRIES,
  BATON_PASS_RELEASE_TRIES
} from '../../src/shared/constants/OverseerLimits.ts';
import { PRODUCT_NAMES }                            from '../../src/shared/constants/ProductNames.ts';
import type { CommandContext }                      from '../CommandContext.ts';
import { requireCurrentInstall }                    from '../InstallVersionCheck.ts';
import { openTrackerForWriting }                    from '../OpenTrackerForWriting.ts';
import { CLAUDE_MANAGED_BLOCK_MARKERS }             from '../adoption/constants/ClaudeManagedBlockMarkers.ts';
import type { ArgumentParser }                      from '../arguments/ArgumentParser.ts';
import { INSTALL_VERSION }                          from '../constants/InstallVersion.ts';
import { OutputUtil }                               from '../utils/OutputUtil.ts';
import { OverseerWording }                          from './OverseerWording.ts';
import { createMergeForecastCache, readBoardState } from './routes/BoardStateReader.ts';
import type { RuntimeOverseerCommand }              from './routes/CommandRoute.ts';
import { overseerRoutesOf }                         from './routes/OverseerRoutes.ts';

export interface ForegroundRunRequest {
  commandArguments: ArgumentParser;
  context:          CommandContext;
  workspace:        Workspace;
  portChoice:       OverseerPortChoice;
  /** Set for `oversee --successor-of <generation>`: the generation this process takes the board over from. */
  successorOf?:     number;
}

type OverseerEnd = { kind: 'stopped'; how: string; now: boolean } | { kind: 'restart' } | { kind: 'taken-over'; refusal: unknown };

/** One serving period under one Baton generation; a Baton pass that failed after the release starts another in the same process. */
interface Serving {
  generation: number;
  server:     StartedServer;
  drivePass:  DrivePass;
  watcher:    { stop: () => void };
  lifetime:   ReturnType<typeof overseerLifetime>;
}

const OWNER_ONLY_FOLDER_MODE = 0o700;
const OWNER_ONLY_FILE_MODE   = 0o600;
const TOKEN_BYTES            = 32;
const DEFAULT_MAIN_LINE      = 'main';

const BATON_PASS_SCHEDULE: BatonPassSchedule = {
  readyTries:           BATON_PASS_READY_TRIES,
  releaseTries:         BATON_PASS_RELEASE_TRIES,
  intervalMilliseconds: BATON_PASS_READY_INTERVAL_MILLISECONDS,
};

/** Every line goes to standard error and is appended to `<data>/overseer.log`, which a reader tails, so it is never rewritten whole. */
function overseerLoggerOf(context: CommandContext, files: OverseerFiles): (line: string) => void {
  return (line: string) => {
    const stampedLine = `${LocalTimeUtil.formatLocalIso(context.now())} ${line}`;
    context.standardError(stampedLine);
    try {
      appendFileSync(files.logFilePath, `${stampedLine}\n`);
    } catch {
      // The log is a convenience: a full disk never stops an Overseer that is otherwise serving.
    }
  };
}

function alreadyRunningRefusal(files: OverseerFiles, generation: number, record: BatonRecord): OperationRefusal {
  const batonFilePath = Baton.batonFilePathFor(files.overseerDirectory, generation);
  return new OperationRefusal('refused', { kind: 'overseer-already-running', url: record.url, batonFilePath });
}

export function requireNoLiveOverseer(files: OverseerFiles): void {
  const newest = Baton.newestBatonOf(files.overseerDirectory);
  if (newest.verdict === 'live') throw alreadyRunningRefusal(files, newest.generation, newest.record);
}

/** A registry that cannot be written never fails the Overseer; the monitor only loses its pointer. */
async function registerOverseer(request: ForegroundRunRequest, overseer: MonitorRegistrationRequest['overseer']): Promise<void> {
  const { context, workspace } = request;
  await registerWithTheMonitor({
    workspace,
    homeDirectory:        context.homeDirectory,
    temporaryDirectories: context.temporaryDirectories,
    command:              context.commandVerb,
    now:                  context.now,
    ...(overseer === undefined ? {} : { overseer }),
  });
}

function writeToken(files: OverseerFiles): string {
  const token = randomBytes(TOKEN_BYTES).toString('hex');
  writeFileAtomically(files.tokenFilePath, token);
  chmodSync(files.tokenFilePath, OWNER_ONLY_FILE_MODE);
  return token;
}

function batonRefusalOf(acquisition: Exclude<BatonAcquisition, { verdict: 'acquired' }>, files: OverseerFiles): OperationRefusal {
  if (acquisition.verdict === 'contended') return new OperationRefusal('refused', { kind: 'overseer-contended', overseerDirectory: files.overseerDirectory });
  return alreadyRunningRefusal(files, acquisition.generation, acquisition.record);
}

/** Resolves once the Overseer should end or hand over, and is settled at most once. */
function overseerLifetime(request: ForegroundRunRequest, files: OverseerFiles, generation: number, log: (line: string) => void) {
  let finish: (end: OverseerEnd) => void = () => undefined;
  const ended = new Promise<OverseerEnd>((resolve) => { finish = resolve; });
  // Each drive pass checks before its effects; this watch ends an idle Overseer as soon as a newer generation appears.
  const beforeEffectBatch = () => {
    try {
      Baton.requireNewestGeneration(files.overseerDirectory, generation);
    } catch (refusal) {
      finish({ kind: 'taken-over', refusal });
    }
  };
  const watcher     = watch(files.overseerDirectory, beforeEffectBatch);
  const unsubscribe = request.context.onStopSignal(() => {
    log('Stop signal received.');
    finish({ kind: 'stopped', how: 'signal', now: false });
  });
  return {
    ended,
    stopFor:       (how: string, now: boolean) => finish({ kind: 'stopped', how, now }),
    restart:       () => finish({ kind: 'restart' }),
    takenOver:     (refusal: unknown) => finish({ kind: 'taken-over', refusal }),
    stopWatching:  () => watcher.close(),
    // Kept until the stop has finished, so a second SIGTERM during it is taken as the same stop rather than killing it halfway.
    stopListening: unsubscribe,
  };
}

/** The branch the main checkout has out is the main line the Overseer lands onto; a detached or unreadable HEAD reads as `main`. */
function mainLineOf(repositoryRoot: string): string {
  const head = GitProcess.run(repositoryRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  return GitProcess.succeeded(head) && head.standardOutput.trim() !== '' ? head.standardOutput.trim() : DEFAULT_MAIN_LINE;
}

function tipOf(repositoryRoot: string, branch: string): string | null {
  const tip = GitProcess.run(repositoryRoot, ['rev-parse', '--verify', '--quiet', branch]);
  return GitProcess.succeeded(tip) ? tip.standardOutput.trim() : null;
}

/** Read on every look: an `update` while the Overseer serves leaves the manifest ahead of the code in memory. */
function manifestMatchesIn(repositoryRoot: string): boolean {
  try {
    requireCurrentInstall(repositoryRoot);
    return true;
  } catch {
    return false;
  }
}

/** What the successor proves before it reports `ready`, holding no Baton and writing nothing but its bundles. */
function preparationSteps(request: ForegroundRunRequest, pinWatcherBundle: () => Promise<string>): readonly BatonPassStepRun[] {
  const { workspace } = request;
  const jobsOf = () => requireProgressFile(workspace).jobs ?? [];
  const steps: readonly BatonPassStepRun[] = [
    {
      step: 'build-bundles',
      run:  async () => { await pinWatcherBundle(); },
    },
    { step: 'read-board', run: () => { readingBoardOf(requireProgressFile(workspace), [], []); } },
    {
      step: 'read-jobs',
      run:  () => {
        for (const job of jobsOf()) {
          if (!Number.isSafeInteger(job.watcherInstance) || !Number.isSafeInteger(job.eventCursor.sequence)) {
            throw new Error(`job ${job.id} has no readable Watcher instance or cursor`);
          }
        }
      },
    },
    {
      step: 'read-watcher-files',
      run:  () => {
        for (const job of jobsOf()) {
          const jobFolder = WatcherFleet.jobFolderOf(workspace.trackerDirectory, job.id);
          if (WatcherFleet.livenessOf(jobFolder, job.watcherInstance).verdict === 'unclaimed') continue;
          const record = WatcherFleet.watcherRecordOf(jobFolder, job.watcherInstance);
          if (record === null) throw new Error(`watcher ${job.watcherInstance} of job ${job.id} has no readable Watcher file`);
          if (!LegacyWatcherReader.readableEventLogFormats().includes(record.eventLogFormatVersion)) {
            throw new Error(`watcher ${job.watcherInstance} of job ${job.id} writes event-log format ${record.eventLogFormatVersion}, which this code does not read`);
          }
          if (WatcherFleet.eventsAfter(jobFolder, job.watcherInstance, 0) === 'malformed') {
            throw new Error(`the event log of Watcher ${job.watcherInstance} of job ${job.id} is malformed`);
          }
        }
      },
    },
    { step: 'install-version', run: () => { requireCurrentInstall(workspace.rootDirectory); } },
  ];
  return steps;
}

/** The successor on the code on disk, detached in its own process group so it outlives this Overseer; `null` when it did not start. */
function spawnSuccessor(context: CommandContext, workspace: Workspace, files: OverseerFiles, generation: number, port: number): ProcessIdentity | null {
  if (context.programCommand.length === 0) return null;
  // Its own lines reach the log through its logger; what it prints before it has one, such as a refusal, is appended here.
  const logFileDescriptor = openSync(files.logFilePath, 'a');
  try {
    const child = Bun.spawn([...context.programCommand, 'oversee', '--successor-of', String(generation), '--port', String(port)], {
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

export async function runOverseerInTheForeground(request: ForegroundRunRequest): Promise<void> {
  const { context, workspace } = request;
  const progress = requireProgressFile(workspace);
  const files    = overseerFilesIn(workspace.trackerDirectory);
  mkdirSync(files.overseerDirectory, { recursive: true, mode: OWNER_ONLY_FOLDER_MODE });
  if (request.successorOf === undefined) requireNoLiveOverseer(files);

  const readIdentity = identityOf(process.pid);
  if (readIdentity === null) throw new OperationRefusal('unrepaired', { kind: 'overseer-identity-unreadable', processId: process.pid });
  const ownIdentity: ProcessIdentity = readIdentity;
  const codeVersion = CodeVersion.onDisk();
  const log         = overseerLoggerOf(context, files);
  const mainLine    = mainLineOf(workspace.rootDirectory);
  const mergeForecastCache = createMergeForecastCache();
  const installWatch = createInstallChangeWatch({
    inMemory:        { codeVersion, installVersion: INSTALL_VERSION },
    versionsOnDisk:  () => versionsFromTheBinary(context.programCommand, workspace.rootDirectory),
    manifestMatches: () => manifestMatchesIn(workspace.rootDirectory),
    landingMark:     () => tipOf(workspace.rootDirectory, mainLine),
  });

  let watcherBundlePath: string | null = null;
  const pinWatcherBundle = async (): Promise<string> => {
    watcherBundlePath ??= await WatcherBundle.pinWatcherBundle({ overseerDirectory: files.overseerDirectory, codeVersion, entryPath: WATCHER_ENTRY_PATH });
    return watcherBundlePath;
  };

  let token: string | null = null;
  let current: Serving | null = null;
  let handingOver = false;
  let batonPassWarning: BatonPassFailure | null = null;
  let printedTheUrl = false;

  const overseerState = () => {
    const passState = current?.drivePass.state();
    if (passState === undefined) return null;
    return { ...passState, runtimeState: handingOver ? 'passing-baton' as const : passState.runtimeState, batonPassWarning };
  };

  /** Binds, takes a generation through `acquireBaton`, records the start and regroups every Watcher; whatever it took is let go on a failure. */
  async function startServing(
    portChoice: OverseerPortChoice,
    acquireBaton: (record: BatonRecord) => BatonAcquisition,
    enterStep: (step: BatonPassStep) => void,
  ): Promise<Serving> {
    const bundlePath = await pinWatcherBundle();
    let lifetime: ReturnType<typeof overseerLifetime> | null = null;
    let drivePass: DrivePass | null = null;
    enterStep('bind-port');
    let broker: EventBroker | null = null;
    let servedUrl: string | null = null;
    const overseerFactsNow = () => {
      const state = overseerState();
      return {
        state:            state?.runtimeState ?? 'serving',
        url:              servedUrl,
        generation:       state?.generation ?? null,
        codeVersion,
        installVersion:   INSTALL_VERSION,
        batonPassWarning: state?.batonPassWarning ?? null,
      } as const;
    };
    const server = OverseerServer.start({
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
        launchesHeld:     () => overseerState()?.runtimeState === 'held-by-install-change',
        notices:          () => overseerState()?.notices ?? [],
        overseer:         overseerFactsNow,
        mainLine,
        mergeForecastCache,
        silentSweepsOf:   (jobId: string) => current?.drivePass.silentSweepsOf(jobId) ?? 0,
        onRuntimeCommand: (command: RuntimeOverseerCommand) => {
          log(`${command.kind} received${command.now ? ' (now)' : ''}.`);
          if (current === null || handingOver) return;
          if (command.kind === 'overseer-restart') {
          // Set at once, so a second command during this Baton pass never overwrites what the successor reported.
            handingOver = true;
            // Written before the command is answered, so whoever sent it never reads an earlier Baton pass's outcome.
            BatonPass.writeBatonPass(BatonPass.batonPassFilePathOf(files.overseerDirectory, current.generation), { state: 'requested' });
            current.lifetime.restart();
            return;
          }
          current.lifetime.stopFor(command.kind, command.now);
        },
      }),
    });

    enterStep('take-baton');
    const record: BatonRecord = {
      processId:                ownIdentity.processId,
      processStartEpochSeconds: ownIdentity.startEpochSeconds,
      bootIdentity:             ownIdentity.bootIdentity,
      port:                     server.port,
      url:                      server.url,
      tokenFile:                files.tokenFilePath,
      codeVersion,
      installVersion:           INSTALL_VERSION,
      watcherProtocolVersion:   WATCHER_PROTOCOL_VERSION,
    };
    const acquisition = acquireBaton(record);
    if (acquisition.verdict !== 'acquired') {
      await server.stop();
      throw batonRefusalOf(acquisition, files);
    }
    const { generation } = acquisition;
    const ownBroker = createEventBroker(generation);
    const publishState = () => {
      try {
        ownBroker.publishState(readBoardState({
          context,
          workspace,
          notices:        () => overseerState()?.notices ?? [],
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
      lifetime = overseerLifetime(request, files, generation, log);
      enterStep('regroup');
      await openTrackerForWriting(request.commandArguments, context, (change) => {
        // Before the record it looks for: only the first start on a board holds the v16 leftovers.
        change.board.holdFirstRunLeftovers(change.at);
        return change.board.recordOverseerStarted({ codeVersion, installVersion: INSTALL_VERSION }, change.at);
      });
      await registerOverseer(request, { url: server.url, processId: process.pid, startedAt: LocalTimeUtil.formatLocalIso(context.now()) });
      createProgressPageStubWriter(workspace.htmlFilePath).write(server.url);
      log(`Overseer serving ${server.url} under Baton ${generation} (code ${codeVersion}, install version ${INSTALL_VERSION}, agents ${context.agentAdapter.vendor}).`);
      if (!printedTheUrl) OutputUtil.printEntity(request.commandArguments, context, { url: server.url, generation }, server.url);
      printedTheUrl = true;

      const startedLifetime = lifetime;
      drivePass = createDrivePass({
        workspace,
        now:                   context.now,
        formatStamp:           (moment) => LocalTimeUtil.formatLocalIso(moment),
        overseerDirectory:     files.overseerDirectory,
        generation,
        watcherBundlePath:     bundlePath,
        codeVersion,
        agentAdapter:          context.agentAdapter,
        monitorFolder:         join(context.homeDirectory, PRODUCT_NAMES.MONITOR_FOLDER),
        inheritedEnvironment:  environmentCopy(),
        mainLine,
        managedBlockMarker:    CLAUDE_MANAGED_BLOCK_MARKERS.start,
        installVersionChanged: installWatch.installVersionChanged,
        newCodeOnDisk:         installWatch.newCodeOnDisk,
        decisionWordingOf:     OverseerWording.decisionWordingOf,
        launchTextOf:          OverseerWording.launchTextOf,
        assistantChatTextOf:   OverseerWording.assistantChatTextOf,
        windDownMessage:       OverseerWording.windDownMessage(),
        resumeMessage:         OverseerWording.resumeMessage(),
        redHandoffMessageOf:   OverseerWording.redHandoffMessageOf,
        answerMessageOf:       OverseerWording.answerMessageOf,
        homeDirectory:         context.homeDirectory,
        log,
        onBatonTakenOver:      (refusal) => (current?.lifetime ?? startedLifetime).takenOver(refusal),
        afterPass:             publishState,
      });
      const startedPass = drivePass;
      watcher = DataFolderWatch.startWatching({
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
      await drivePass.regroup();
      return serving;
    } catch (thrown) {
      watcher?.stop();
      lifetime?.stopWatching();
      lifetime?.stopListening();
      await drivePass?.stop();
      await server.stop();
      Baton.release(files.overseerDirectory, generation);
      throw thrown;
    }
  }

  /** The release half of a Baton pass: a landing in progress finishes, no effect batch starts, and the listener closes; no Watcher is sent anything. */
  async function release(serving: Serving): Promise<void> {
    handingOver = true;
    serving.lifetime.stopWatching();
    serving.watcher.stop();
    await serving.drivePass.stop();
    await openTrackerForWriting(request.commandArguments, context, (change) => change.board.recordOverseerStopped('handed-over', change.at));
    await serving.server.stop();
    log('Released the board to the successor.');
  }

  async function handOver(serving: Serving, successor: ProcessIdentity | null): Promise<BatonPassOutcome> {
    log(`Handing the board over to the code on disk (Baton ${serving.generation}).`);
    return await BatonPass.handOver({
      batonPassFilePath:    BatonPass.batonPassFilePathOf(files.overseerDirectory, serving.generation),
      successor,
      successorCodeVersion: CodeVersion.onDisk(),
      release:              () => release(serving),
      recordFailure:        recordBatonPassFailure,
      schedule:             BATON_PASS_SCHEDULE,
    });
  }

  async function recordBatonPassFailure(failure: BatonPassFailure): Promise<void> {
    batonPassWarning = failure;
    log(`The Baton pass failed at ${failure.step}: ${failure.error}. This Overseer keeps driving.`);
    await openTrackerForWriting(request.commandArguments, context, (change) => change.board.recordBatonPassFailed(failure, change.at));
  }

  /** A taken-back board whose port never came free: the failure, naming the port, is logged and recorded before the Overseer exits 1. */
  async function lostPortRefusal(port: number, rebound: Exclude<RebindOutcome<Serving>, { verdict: 'bound' }>): Promise<OperationRefusal> {
    const cause = rebound.verdict === 'successor-live' ? 'the killed successor was still live' : rebound.error;
    const failure: BatonPassFailure = {
      successorCodeVersion: CodeVersion.onDisk(),
      step:                 'bind-port',
      error:                `port ${port} could not be bound again within ${BATON_PASS_REBIND_TRIES} tries: ${cause}`,
    };
    batonPassWarning = failure;
    log(`Taking the board back failed: ${failure.error}. This Overseer exits with no Overseer on the board.`);
    await openTrackerForWriting(request.commandArguments, context, (change) => change.board.recordBatonPassFailed(failure, change.at));
    return new OperationRefusal('refused', { kind: 'baton-pass-failed', ...failure, url: null });
  }

  /** Proves the new code, waits for the release, then serves; a failure is left in the Baton pass file and the process exits 1. */
  async function takeOverAsSuccessor(predecessorGeneration: number): Promise<Serving> {
    const batonPassFilePath = BatonPass.batonPassFilePathOf(files.overseerDirectory, predecessorGeneration);
    const admission = await BatonPass.prepareAndAwaitRelease({
      batonPassFilePath,
      codeVersion,
      predecessorIsLive: () => {
        const newest = Baton.newestBatonOf(files.overseerDirectory);
        return newest.verdict === 'live' && newest.generation === predecessorGeneration;
      },
      schedule: BATON_PASS_SCHEDULE,
    }, preparationSteps(request, pinWatcherBundle));
    if (admission === 'failed') {
      const report = BatonPass.readBatonPass(batonPassFilePath);
      const reported = report?.state === 'successor-failed' || report?.state === 'failed';
      const failure  = reported ? report : { successorCodeVersion: codeVersion, step: 'report-ready', error: 'no report was left' };
      throw new OperationRefusal('refused', {
        kind: 'baton-pass-failed', successorCodeVersion: failure.successorCodeVersion, step: failure.step, error: failure.error, url: null
      });
    }
    log(admission === 'released' ? `Baton ${predecessorGeneration} released the board; taking it over.` : `Baton ${predecessorGeneration} is gone; starting as after a crash.`);
    return await startAsSuccessor(predecessorGeneration, admission);
  }

  let serving = request.successorOf === undefined
    ? await startServing(request.portChoice, (record) => Baton.acquire(files.overseerDirectory, record), () => undefined)
    : await takeOverAsSuccessor(request.successorOf);

  async function startAsSuccessor(predecessorGeneration: number, admission: 'released' | 'predecessor-gone'): Promise<Serving> {
    let step: BatonPassStep = 'bind-port';
    const batonPassFilePath = BatonPass.batonPassFilePathOf(files.overseerDirectory, predecessorGeneration);
    try {
      const acquireBaton = admission === 'released'
        ? (record: BatonRecord) => Baton.acquireAbove(files.overseerDirectory, record, predecessorGeneration)
        : (record: BatonRecord) => Baton.acquire(files.overseerDirectory, record);
      const started = await startServing(request.portChoice, acquireBaton, (entered) => { step = entered; });
      BatonPass.reportServing({ batonPassFilePath, codeVersion }, started.generation, started.server.url);
      return started;
    } catch (thrown) {
      BatonPass.reportFailure({ batonPassFilePath, codeVersion }, step, thrown, admission === 'released');
      throw thrown;
    }
  }

  for (;;) {
    const end = await serving.lifetime.ended;
    if (end.kind === 'restart') {
      const successor = spawnSuccessor(context, workspace, files, serving.generation, serving.server.port);
      const outcome = await handOver(serving, successor);
      if (outcome.verdict === 'handed-over') {
        log(`Handed the board over to code ${outcome.successorCodeVersion} at ${outcome.url} under Baton ${outcome.generation}; exiting.`);
        serving.lifetime.stopListening();
        return;
      }
      if (outcome.verdict === 'kept-driving') {
        serving.lifetime.stopWatching();
        serving.lifetime.stopListening();
        serving.lifetime = overseerLifetime(request, files, serving.generation, log);
        handingOver = false;
        const drivenOn = serving;
        serving.drivePass.wake(true);
        current = drivenOn;
        continue;
      }
      serving.lifetime.stopListening();
      const failedGeneration = serving.generation + 1;
      const takeBack = (record: BatonRecord) => Baton.acquireAbove(files.overseerDirectory, record, failedGeneration);
      const { port } = serving.server;
      const rebound = await BatonPass.rebindAfterTakeBack({
        successor,
        tries:                BATON_PASS_REBIND_TRIES,
        intervalMilliseconds: BATON_PASS_READY_INTERVAL_MILLISECONDS,
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
    if (end.kind === 'stopped' && end.now) {
      const stoppedHosts = await WatcherFleet.stopLiveProcessHosts(workspace.trackerDirectory);
      log(`Stopped ${stoppedHosts} live process host${stoppedHosts === 1 ? '' : 's'}.`);
    }
    // A Watcher ending after the last pass would otherwise wait for an acknowledgement until the next Overseer.
    await WatcherFleet.reapEndedHosts(workspace.trackerDirectory);
    try {
      await serving.server.stop();
      if (end.kind === 'taken-over') {
        log('A newer Overseer took the board over; stopping without acting.');
        throw end.refusal;
      }
      await openTrackerForWriting(request.commandArguments, context, (change) => change.board.recordOverseerStopped('stopped', change.at));
      await registerOverseer(request, 'removed');
      createProgressPageStubWriter(workspace.htmlFilePath).write(null);
      Baton.release(files.overseerDirectory, serving.generation);
      log('Overseer stopped; its Baton is released.');
    } finally {
      serving.lifetime.stopListening();
    }
    return;
  }
}
