/**
 * `run` and its subcommands. Starting, restarting, pausing and resuming check the install version; `run status` and `run stop` do not,
 * so a runner whose install changed can still be inspected and stopped.
 */
import { LogUtil }                                       from '../../src/adapters/utils/LogUtil.ts';
import { readingBoardOf }                                from '../../src/lib/tracker-model/ReadingBoard.ts';
import { ControlService }                                from '../../src/services/control/ControlService.ts';
import { CodeVersion }                                   from '../../src/services/runner/CodeVersion.ts';
import { runnerFilesIn }                                 from '../../src/services/runner/RunnerFiles.ts';
import { RunnerLease }                                   from '../../src/services/runner/RunnerLease.ts';
import type { RunnerPortChoice }                         from '../../src/services/runner/RunnerPort.ts';
import { requireProgressFile }                           from '../../src/services/tracker/TrackerReader.ts';
import { requireWorkspace }                              from '../../src/services/tracker/Workspace.ts';
import type { ControlCommandOf }                         from '../../src/shared/@types/ControlCommand.ts';
import { OperationRefusal }                              from '../../src/shared/OperationRefusal.ts';
import { PRODUCT_NAMES }                                 from '../../src/shared/constants/ProductNames.ts';
import type { CommandContext }                           from '../CommandContext.ts';
import type { CommandHandler }                           from '../CommandHandler.ts';
import { requireCurrentInstall }                         from '../InstallVersionCheck.ts';
import { openTrackerForWriting }                         from '../OpenTrackerForWriting.ts';
import { relayWhenUnderJob }                             from '../RelayUnderJob.ts';
import type { ArgumentParser }                           from '../arguments/ArgumentParser.ts';
import { OutputUtil }                                    from '../utils/OutputUtil.ts';
import { requireNoLiveRunner, runRunnerInTheForeground } from './RunnerForeground.ts';
import { RunnerRemote, type RuntimeStopKind }            from './RunnerRemote.ts';

const { PROGRAM } = PRODUCT_NAMES;

const START_USAGE   = `${PROGRAM} run [--port <n>] [--detach] [--json]`;
const STOP_USAGE    = `${PROGRAM} run stop|restart [--now] [--json]`;
const PAUSE_USAGE   = `${PROGRAM} run pause|resume [--json]`;
const STATUS_USAGE  = `${PROGRAM} run status [--json]`;

const HIGHEST_PORT          = 65535;
const WHOLE_NUMBER_PATTERN  = /^\d+$/;

type RunSubcommand = (commandArguments: ArgumentParser, context: CommandContext) => Promise<void>;

function portChoiceOf(commandArguments: ArgumentParser, trackerId: string): RunnerPortChoice {
  const written = commandArguments.option('port');
  if (written === undefined) return { kind: 'preferred', trackerId };
  const port = WHOLE_NUMBER_PATTERN.test(written) ? Number(written) : Number.NaN;
  if (!Number.isSafeInteger(port) || port > HIGHEST_PORT) {
    throw new OperationRefusal('refused', `"${written}" is not a port. Write a whole number from 0 to ${HIGHEST_PORT}, 0 for any free one.\n  Usage: ${START_USAGE}`);
  }
  return { kind: 'given', port };
}

async function startRunner(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(['port', 'detach', 'json'], START_USAGE);
  commandArguments.rejectExtraPositionals(0, START_USAGE);
  requireCurrentInstall(context.currentDirectory);
  const workspace  = requireWorkspace(context.currentDirectory);
  const portChoice = portChoiceOf(commandArguments, requireProgressFile(workspace).trackerId);
  if (!commandArguments.flag('detach')) {
    await runRunnerInTheForeground({
      commandArguments, context, workspace, portChoice
    });
    return;
  }
  const files = runnerFilesIn(workspace.trackerDirectory);
  requireNoLiveRunner(files);
  const portArguments = portChoice.kind === 'given' ? ['--port', String(portChoice.port)] : [];
  const url = await RunnerRemote.startDetached(context, files, portArguments);
  OutputUtil.printEntity(commandArguments, context, { url }, url);
}

function stopSubcommand(kind: RuntimeStopKind): RunSubcommand {
  return async (commandArguments, context) => {
    commandArguments.rejectUnknownOptions(['now', 'json'], STOP_USAGE);
    commandArguments.rejectExtraPositionals(1, STOP_USAGE);
    const now = commandArguments.flag('now');
    await relayWhenUnderJob(context, { kind, now });
    if (kind === 'runner-restart') requireCurrentInstall(context.currentDirectory);
    const files   = runnerFilesIn(requireWorkspace(context.currentDirectory).trackerDirectory);
    const stopped = await RunnerRemote.stopTheLiveRunner(files, kind, now);
    if (kind === 'runner-stop') {
      const text = stopped.verdict === 'was-down' ? 'No runner is live; nothing to stop.' : `Stopped the runner at ${stopped.record.url}.`;
      OutputUtil.printEntity(commandArguments, context, { outcome: stopped.verdict === 'was-down' ? 'nothing-to-do' : 'done' }, text);
      return;
    }
    // The successor keeps the port the stopped runner had, so its URL stays the one people opened.
    const portArguments = stopped.verdict === 'stopped' ? ['--port', String(stopped.record.port)] : [];
    const url           = await RunnerRemote.startDetached(context, files, portArguments);
    OutputUtil.printEntity(commandArguments, context, { outcome: 'done', url }, `Runner restarted at ${url}`);
  };
}

function pauseSubcommand(kind: 'runner-pause' | 'runner-resume'): RunSubcommand {
  return async (commandArguments, context) => {
    commandArguments.rejectUnknownOptions(['json'], PAUSE_USAGE);
    commandArguments.rejectExtraPositionals(1, PAUSE_USAGE);
    const command: ControlCommandOf<typeof kind> = { kind };
    await relayWhenUnderJob(context, command);
    requireCurrentInstall(context.currentDirectory);
    const { logged, previousState } = await openTrackerForWriting(commandArguments, context, (change) => ControlService.apply(command, change).result);
    const dispatcherState = kind === 'runner-pause' ? 'stopped' : 'running';
    OutputUtil.printEntity(commandArguments, context, { dispatcherState, previousState }, `${OutputUtil.loggedSentencesOf(logged)} (was ${previousState}).`);
  };
}

/** Read-only and lockless: the lease, the stored drain flag and the code on disk, which the live runner's lease says it runs. */
async function printRunnerStatus(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(['json'], STATUS_USAGE);
  commandArguments.rejectExtraPositionals(1, STATUS_USAGE);
  const workspace       = requireWorkspace(context.currentDirectory);
  const dispatcherState = readingBoardOf(requireProgressFile(workspace), [], []).dispatcherState();
  const newest          = RunnerLease.newestLeaseOf(runnerFilesIn(workspace.trackerDirectory).runnerDirectory);
  const codeVersionOnDisk = CodeVersion.onDisk();
  const live            = newest.verdict === 'live' ? newest : null;
  const state           = live === null ? 'down' : await RunnerRemote.identityAnswers(live.record) ? 'serving' : 'starting';
  const entity = {
    state,
    paused:              dispatcherState !== 'running',
    url:                 live?.record.url ?? null,
    lease:               live === null ? null : { generation: live.generation, ...live.record },
    codeVersionOnDisk,
    codeVersionInMemory: live?.record.codeVersion ?? null,
  };
  const pausedText = entity.paused ? `paused (${LogUtil.dispatcherStateTextOf(dispatcherState, null)})` : 'not paused';
  const lines = live === null
    ? [`runner: down; ${pausedText}`, `code on disk: ${codeVersionOnDisk}`]
    : [
      `runner: ${state} at ${live.record.url}, process ${live.record.processId}, lease ${live.generation}; ${pausedText}`,
      `code on disk: ${codeVersionOnDisk}; in memory: ${live.record.codeVersion}${live.record.codeVersion === codeVersionOnDisk ? '' : ` (new code: run \`${PROGRAM} update\`)`}`,
    ];
  OutputUtil.printEntity(commandArguments, context, entity, lines.join('\n'));
}

const RUN_SUBCOMMANDS: Readonly<Record<string, RunSubcommand>> = Object.freeze({
  stop:    stopSubcommand('runner-stop'),
  restart: stopSubcommand('runner-restart'),
  pause:   pauseSubcommand('runner-pause'),
  resume:  pauseSubcommand('runner-resume'),
  status:  printRunnerStatus,
});

export const RUN_SUBCOMMAND_NAMES: readonly string[] = Object.freeze(Object.keys(RUN_SUBCOMMANDS));

export const runCommand: CommandHandler = async (commandArguments, context) => {
  const subcommand = commandArguments.positionals()[0];
  if (subcommand === undefined) {
    await startRunner(commandArguments, context);
    return;
  }
  const handler = Object.hasOwn(RUN_SUBCOMMANDS, subcommand) ? RUN_SUBCOMMANDS[subcommand] : undefined;
  if (handler === undefined) {
    throw new OperationRefusal('refused', `Unknown run subcommand "${subcommand}". Write one of ${RUN_SUBCOMMAND_NAMES.join(', ')}, or none to start.\n  Usage: ${START_USAGE}`);
  }
  await handler(commandArguments, context);
};
