/**
 * `oversee` and its subcommands. Starting, restarting, pausing and resuming check the install version; `oversee status` and `oversee stop` do not,
 * so an Overseer whose install changed can still be inspected and stopped.
 */
import { readingBoardOf }                                    from '../../src/lib/tracker-model/ReadingBoard.ts';
import { ControlService }                                    from '../../src/services/control/ControlService.ts';
import { Baton }                                             from '../../src/services/overseer/Baton.ts';
import { CodeVersion }                                       from '../../src/services/overseer/CodeVersion.ts';
import { overseerFilesIn }                                   from '../../src/services/overseer/OverseerFiles.ts';
import type { OverseerPortChoice }                           from '../../src/services/overseer/OverseerPort.ts';
import { requireProgressFile }                               from '../../src/services/tracker/TrackerReader.ts';
import { requireWorkspace }                                  from '../../src/services/tracker/Workspace.ts';
import type { ControlCommandOf }                             from '../../src/shared/@types/ControlCommand.ts';
import { OperationRefusal }                                  from '../../src/shared/OperationRefusal.ts';
import { PRODUCT_NAMES }                                     from '../../src/shared/constants/ProductNames.ts';
import type { CommandContext }                               from '../CommandContext.ts';
import type { CommandHandler }                               from '../CommandHandler.ts';
import { hatchWhenUnderJob }                                 from '../HatchUnderJob.ts';
import { requireCurrentInstall }                             from '../InstallVersionCheck.ts';
import { openTrackerForWriting }                             from '../OpenTrackerForWriting.ts';
import type { ArgumentParser }                               from '../arguments/ArgumentParser.ts';
import { OutputUtil }                                        from '../utils/OutputUtil.ts';
import { requireNoLiveOverseer, runOverseerInTheForeground } from './OverseerForeground.ts';
import { OverseerRemote, type RuntimeStopKind }              from './OverseerRemote.ts';
import { OverseerWording }                                   from './OverseerWording.ts';

const { PROGRAM } = PRODUCT_NAMES;

const START_USAGE     = `${PROGRAM} oversee [--port <n>] [--detach] [--json]`;
const SUCCESSOR_USAGE = `${PROGRAM} oversee --successor-of <generation> [--port <n>]`;
const STOP_USAGE    = `${PROGRAM} oversee stop|restart [--now] [--json]`;
const PAUSE_USAGE   = `${PROGRAM} oversee pause|resume [--json]`;
const STATUS_USAGE  = `${PROGRAM} oversee status [--json]`;

const HIGHEST_PORT          = 65535;
const WHOLE_NUMBER_PATTERN  = /^\d+$/;

type RunSubcommand = (commandArguments: ArgumentParser, context: CommandContext) => Promise<void>;

function portChoiceOf(commandArguments: ArgumentParser, trackerId: string): OverseerPortChoice {
  const written = commandArguments.option('port');
  if (written === undefined) return { kind: 'preferred', trackerId };
  const port = WHOLE_NUMBER_PATTERN.test(written) ? Number(written) : Number.NaN;
  if (!Number.isSafeInteger(port) || port > HIGHEST_PORT) {
    throw new OperationRefusal('refused', `"${written}" is not a port. Write a whole number from 0 to ${HIGHEST_PORT}, 0 for any free one.\n  Usage: ${START_USAGE}`);
  }
  return { kind: 'given', port };
}

/** The generation a successor takes the board over from; only the old Overseer passes it, when it spawns its successor. */
function successorOfIn(commandArguments: ArgumentParser): number | undefined {
  const written = commandArguments.option('successor-of');
  if (written === undefined) return undefined;
  if (!WHOLE_NUMBER_PATTERN.test(written) || !Number.isSafeInteger(Number(written))) {
    throw new OperationRefusal('refused', `"${written}" is not a Baton generation. Write a whole number.\n  Usage: ${SUCCESSOR_USAGE}`);
  }
  return Number(written);
}

async function startOverseer(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(['port', 'detach', 'json', 'successor-of'], START_USAGE);
  commandArguments.rejectExtraPositionals(0, START_USAGE);
  const successorOf = successorOfIn(commandArguments);
  // A successor checks the manifest against its own install version as a Baton pass step, so a mismatch is reported as the Baton pass's failure.
  if (successorOf === undefined) requireCurrentInstall(context.currentDirectory);
  const workspace  = requireWorkspace(context.currentDirectory);
  const portChoice = portChoiceOf(commandArguments, requireProgressFile(workspace).trackerId);
  if (!commandArguments.flag('detach')) {
    await runOverseerInTheForeground({
      commandArguments, context, workspace, portChoice, ...(successorOf === undefined ? {} : { successorOf })
    });
    return;
  }
  const files = overseerFilesIn(workspace.trackerDirectory);
  requireNoLiveOverseer(files);
  const portArguments = portChoice.kind === 'given' ? ['--port', String(portChoice.port)] : [];
  const url = await OverseerRemote.startDetached(context, files, portArguments);
  OutputUtil.printEntity(commandArguments, context, { url }, url);
}

function stopSubcommand(kind: RuntimeStopKind): RunSubcommand {
  return async (commandArguments, context) => {
    commandArguments.rejectUnknownOptions(['now', 'json'], STOP_USAGE);
    commandArguments.rejectExtraPositionals(1, STOP_USAGE);
    const now = commandArguments.flag('now');
    await hatchWhenUnderJob(context, { kind, now });
    if (kind === 'overseer-restart') requireCurrentInstall(context.currentDirectory);
    const files   = overseerFilesIn(requireWorkspace(context.currentDirectory).trackerDirectory);
    if (kind === 'overseer-restart') {
      await restartTheOverseer(commandArguments, context, files, now);
      return;
    }
    const stopped = await OverseerRemote.stopTheLiveOverseer(files, kind, now);
    const text = stopped.verdict === 'was-down' ? 'No Overseer is live; nothing to stop.' : `Stopped the Overseer at ${stopped.record.url}.`;
    OutputUtil.printEntity(commandArguments, context, { outcome: stopped.verdict === 'was-down' ? 'nothing-to-do' : 'done' }, text);
  };
}

/**
 * The checked Baton pass to the code on disk; a failed one exits 1 `baton-pass-failed` with the old Overseer still driving. An Overseer whose
 * API does not take the command is stopped and started again, and with none live one is started.
 */
async function restartTheOverseer(commandArguments: ArgumentParser, context: CommandContext, files: ReturnType<typeof overseerFilesIn>, now: boolean): Promise<void> {
  const batonPass = await OverseerRemote.handOverTheLiveOverseer(files, now);
  if (batonPass.verdict === 'handed-over') {
    OutputUtil.printEntity(commandArguments, context, { outcome: 'done', url: batonPass.url, codeVersion: batonPass.successorCodeVersion },
      `Overseer handed over to code ${batonPass.successorCodeVersion} at ${batonPass.url}`);
    return;
  }
  // The successor keeps the port the stopped Overseer had, so its URL stays the one people opened.
  const stopped       = batonPass.verdict === 'not-taken' ? await OverseerRemote.stopTheLiveOverseer(files, 'overseer-stop', now) : { verdict: 'was-down' as const };
  const portArguments = stopped.verdict === 'stopped' ? ['--port', String(stopped.record.port)] : [];
  const url           = await OverseerRemote.startDetached(context, files, portArguments);
  OutputUtil.printEntity(commandArguments, context, { outcome: 'done', url }, `Overseer restarted at ${url}`);
}

function pauseSubcommand(kind: 'overseer-pause' | 'overseer-resume'): RunSubcommand {
  return async (commandArguments, context) => {
    commandArguments.rejectUnknownOptions(['json'], PAUSE_USAGE);
    commandArguments.rejectExtraPositionals(1, PAUSE_USAGE);
    const command: ControlCommandOf<typeof kind> = { kind };
    await hatchWhenUnderJob(context, command);
    requireCurrentInstall(context.currentDirectory);
    const { logged, previousState } = await openTrackerForWriting(commandArguments, context, (change) => ControlService.apply(command, change).result);
    const overseerState = kind === 'overseer-pause' ? 'paused' : 'running';
    OutputUtil.printEntity(commandArguments, context, { overseerState, previousState }, `${OutputUtil.loggedSentencesOf(logged)} (was ${previousState}).`);
  };
}

/** Read-only and lockless: the Baton, the stored drain flag and the code on disk, which the live Overseer's Baton says it runs. */
async function printOverseerStatus(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(['json'], STATUS_USAGE);
  commandArguments.rejectExtraPositionals(1, STATUS_USAGE);
  const workspace       = requireWorkspace(context.currentDirectory);
  const storedOverseerState = readingBoardOf(requireProgressFile(workspace), [], []).overseerState();
  const newest          = Baton.newestBatonOf(overseerFilesIn(workspace.trackerDirectory).overseerDirectory);
  const codeVersionOnDisk = CodeVersion.onDisk();
  const live            = newest.verdict === 'live' ? newest : null;
  const overseerState     = live === null ? null : OverseerWording.overseerStateOf(await OverseerRemote.stateOf(live.record));
  const state           = live === null ? 'down' : overseerState?.runtimeState ?? (await OverseerRemote.identityAnswers(live.record) ? 'serving' : 'starting');
  const entity = {
    state,
    paused:              storedOverseerState === 'paused',
    url:                 live?.record.url ?? null,
    baton:               live === null ? null : { generation: live.generation, ...live.record },
    codeVersionOnDisk,
    codeVersionInMemory: live?.record.codeVersion ?? null,
    notices:             overseerState?.notices ?? [],
    batonPassWarning:    overseerState?.batonPassWarning ?? null,
  };
  const pausedText = entity.paused ? 'paused' : 'not paused';
  const lines = live === null
    ? [`overseer: down; ${pausedText}`, `code on disk: ${codeVersionOnDisk}`]
    : [
      `overseer: ${state} at ${live.record.url}, process ${live.record.processId}, Baton ${live.generation}; ${pausedText}`,
      `code on disk: ${codeVersionOnDisk}; in memory: ${live.record.codeVersion}${live.record.codeVersion === codeVersionOnDisk ? '' : ` (new code: run \`${PROGRAM} update\`)`}`,
      ...entity.notices.map((notice) => `notice: ${OverseerWording.noticeTextOf(notice)}`),
      ...(entity.batonPassWarning === null ? [] : [`warning: ${OverseerWording.batonPassWarningTextOf(entity.batonPassWarning)}`]),
    ];
  OutputUtil.printEntity(commandArguments, context, entity, lines.join('\n'));
}

const OVERSEE_SUBCOMMANDS: Readonly<Record<string, RunSubcommand>> = Object.freeze({
  stop:    stopSubcommand('overseer-stop'),
  restart: stopSubcommand('overseer-restart'),
  pause:   pauseSubcommand('overseer-pause'),
  resume:  pauseSubcommand('overseer-resume'),
  status:  printOverseerStatus,
});

export const OVERSEE_SUBCOMMAND_NAMES: readonly string[] = Object.freeze(Object.keys(OVERSEE_SUBCOMMANDS));

export const overseeCommand: CommandHandler = async (commandArguments, context) => {
  const subcommand = commandArguments.positionals()[0];
  if (subcommand === undefined) {
    await startOverseer(commandArguments, context);
    return;
  }
  const handler = Object.hasOwn(OVERSEE_SUBCOMMANDS, subcommand) ? OVERSEE_SUBCOMMANDS[subcommand] : undefined;
  if (handler === undefined) {
    throw new OperationRefusal(
      'refused',
      `Unknown oversee subcommand "${subcommand}". Write one of ${OVERSEE_SUBCOMMAND_NAMES.join(', ')}, or none to start.\n  Usage: ${START_USAGE}`,
    );
  }
  await handler(commandArguments, context);
};
