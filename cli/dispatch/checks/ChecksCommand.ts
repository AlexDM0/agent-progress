import { OperationRefusalWordingUtil }                 from '../../../src/adapters/utils/OperationRefusalWordingUtil.ts';
import { refusalIsBoardRefusal }                       from '../../../src/lib/tracker-model/BoardRefusal.ts';
import { readingBoardOf }                              from '../../../src/lib/tracker-model/ReadingBoard.ts';
import { BoardSettingsUtil }                           from '../../../src/lib/tracker-model/utils/BoardSettingsUtil.ts';
import { ControlService }                              from '../../../src/services/control/ControlService.ts';
import { type CacheFolderRefusal, GateCachePaths }     from '../../../src/services/runner/GateCachePaths.ts';
import { requireProgressFile, requireTracker }         from '../../../src/services/tracker/TrackerReader.ts';
import { requireWorkspace }                            from '../../../src/services/tracker/Workspace.ts';
import type { ControlCommandOf }                       from '../../../src/shared/@types/ControlCommand.ts';
import { OperationRefusal, refusalIsOperationRefusal } from '../../../src/shared/OperationRefusal.ts';
import { PRODUCT_NAMES }                               from '../../../src/shared/constants/ProductNames.ts';
import type { CommandContext }                         from '../../CommandContext.ts';
import type { CommandHandler }                         from '../../CommandHandler.ts';
import { openTrackerForWriting }                       from '../../OpenTrackerForWriting.ts';
import { relayWhenUnderJob }                           from '../../RelayUnderJob.ts';
import type { ArgumentParser }                         from '../../arguments/ArgumentParser.ts';
import { OutputUtil }                                  from '../../utils/OutputUtil.ts';
import {
  CHECK_OUTPUT_TAIL_LINES,
  checkRunOutcomeText,
  checkRunPassed,
  lastLinesOf,
  runCheckCommand
} from '../CheckCommandRun.ts';

const USAGE = `${PRODUCT_NAMES.PROGRAM} checks ["<command>" | --clear] [--restamp] [--json]  |  ${PRODUCT_NAMES.PROGRAM} checks --install "<line>" [--json]`
  + `  |  ${PRODUCT_NAMES.PROGRAM} checks --definition-files ("<pattern> <pattern>…" | --clear) [--json]`
  + `  |  ${PRODUCT_NAMES.PROGRAM} checks --key-command ("<line>" | --clear) [--json]`
  + `  |  ${PRODUCT_NAMES.PROGRAM} checks --cache-paths ("<path> <path>…" | --clear) [--json]`;

const KNOWN_OPTION_NAMES = ['clear', 'restamp', 'install', 'definition-files', 'key-command', 'cache-paths', 'json'];

const CACHE_FOLDER_REFUSAL_WORDING: Readonly<Record<CacheFolderRefusal, string>> = {
  'bin-folder':         'is, sits in or holds a bin folder',
  'search-path-folder': 'is, sits in or holds a folder on PATH',
};

const NO_CHECK_COMMAND_TEXT = 'No check command is set, so a landing runs none. '
  + `Set one with \`${PRODUCT_NAMES.PROGRAM} checks "<command>"\`.`;

/** The read takes no lock and writes nothing, so a tracker that never set one keeps its file as it was. */
function printCurrentCheckCommand(commandArguments: ArgumentParser, context: CommandContext): void {
  // Built over progress.json alone, so a broken log or ticket file does not stop this read.
  const checkCommand = readingBoardOf(requireProgressFile(requireWorkspace(context.currentDirectory)), [], []).checkCommand() ?? null;
  OutputUtil.printEntity(commandArguments, context, { checkCommand }, checkCommand ?? NO_CHECK_COMMAND_TEXT);
}

function storedCommandFrom(commandArguments: ArgumentParser): string | null {
  const written     = commandArguments.positional();
  const clearsIt    = commandArguments.flag('clear');
  if (written !== undefined && clearsIt) throw new OperationRefusal('refused', `Give a command or --clear, not both.\n  Usage: ${USAGE}`);
  if (clearsIt) return null;
  if (!BoardSettingsUtil.checkCommandIsWellFormed(written)) {
    throw new OperationRefusal('refused', `A check command is a shell line that is not blank, quoted as one argument.\n  Usage: ${USAGE}`);
  }
  return written;
}

/**
 * The Board's own in-flight rule, asked on a reading board whose change is never written, so a line the lock would refuse is refused before a
 * trial run that could take minutes. The lock asks again, since a ticket may start meanwhile.
 */
function refuseAChangeTheTicketsInFlightWouldBlock(checkCommand: string, context: CommandContext): void {
  const { progress, listing, epicListing } = requireTracker(requireWorkspace(context.currentDirectory));
  try {
    readingBoardOf(progress, listing.tickets, epicListing.epics).setCheckCommand(checkCommand, false, context.now().toISOString());
  } catch (error) {
    if (refusalIsBoardRefusal(error)) throw new OperationRefusal('refused', { kind: 'board-refusal', boardRefusal: error.detail });
    throw error;
  }
}

/** Run once in the main checkout before anything is stored, so a line that cannot pass there, a typo above all, never stalls a release. */
async function requireTheCommandPassesInTheMainCheckout(checkCommand: string, commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  const mainCheckout = requireWorkspace(context.currentDirectory).rootDirectory;
  if (!commandArguments.flag('json')) context.standardError(`Trying the check command in ${mainCheckout}: ${checkCommand}`);
  const checkRun = await runCheckCommand(checkCommand, mainCheckout);
  if (checkRunPassed(checkRun)) return;
  throw new OperationRefusal(
    'refused',
    `The check command \`${checkCommand}\` ${checkRunOutcomeText(checkRun)} in the main checkout ${mainCheckout}, so it was not stored and nothing `
    + `was logged: fix the line, or what it reports, and set it again. Its last ${CHECK_OUTPUT_TAIL_LINES} lines:\n${lastLinesOf(checkRun.output)}`,
  );
}

/** The install line is stored untried: it prepares a fresh worktree, which the main checkout already is. */
async function setInstallCommand(installCommand: string, commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  if (commandArguments.positional() !== undefined || commandArguments.flag('clear') || commandArguments.flag('restamp')) {
    throw new OperationRefusal('refused', `--install goes alone, without a check command, --clear or --restamp.\n  Usage: ${USAGE}`);
  }
  if (!BoardSettingsUtil.checkCommandIsWellFormed(installCommand)) {
    throw new OperationRefusal('refused', `An install line is a shell line that is not blank, quoted as one argument.\n  Usage: ${USAGE}`);
  }
  const command: ControlCommandOf<'install-command-set'> = { kind: 'install-command-set', command: installCommand };
  await relayWhenUnderJob(context, command);
  const { logged, previousInstallCommand } = await openTrackerForWriting(commandArguments, context, (change) => ControlService.apply(command, change).result);
  OutputUtil.printEntity(
    commandArguments,
    context,
    { installCommand, previousInstallCommand },
    `${OutputUtil.loggedSentencesOf(logged)} (was ${previousInstallCommand ?? 'none'}).`,
  );
}

/** The parser refuses `--definition-files`, `--key-command` or `--cache-paths` before `--clear` as a missing value, which here is the clearing form. */
function optionValueGiven(commandArguments: ArgumentParser, optionName: 'definition-files' | 'key-command' | 'cache-paths'): boolean {
  try {
    return commandArguments.option(optionName) !== undefined;
  } catch (error) {
    if (refusalIsOperationRefusal(error) && commandArguments.flag('clear')) return false;
    throw error;
  }
}

function definitionFilePatternsFrom(commandArguments: ArgumentParser): string[] | null {
  if (commandArguments.positional() !== undefined || commandArguments.option('install') !== undefined || commandArguments.flag('restamp')) {
    throw new OperationRefusal('refused', `--definition-files goes alone, without a check command, --install or --restamp.\n  Usage: ${USAGE}`);
  }
  if (commandArguments.flag('clear')) {
    if (!optionValueGiven(commandArguments, 'definition-files')) return null;
    throw new OperationRefusal('refused', `Give patterns or --clear, not both.\n  Usage: ${USAGE}`);
  }
  const patterns = (commandArguments.option('definition-files') ?? '').split(/\s+/).filter((pattern) => pattern !== '');
  if (!BoardSettingsUtil.checksDefinitionFilesAreWellFormed(patterns)) {
    throw new OperationRefusal('refused', `Definition files are git pathspec-style patterns, separated by spaces and quoted as one argument.\n  Usage: ${USAGE}`);
  }
  return patterns;
}

/** Stored untried, like the install line: a pattern is only matched against the paths a job's range changes. */
async function setChecksDefinitionFiles(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  const patterns = definitionFilePatternsFrom(commandArguments);
  const command: ControlCommandOf<'checks-definition-files-set'> = { kind: 'checks-definition-files-set', patterns };
  await relayWhenUnderJob(context, command);
  const { logged, previousChecksDefinitionFiles } = await openTrackerForWriting(commandArguments, context, (change) => ControlService.apply(command, change).result);
  OutputUtil.printEntity(
    commandArguments,
    context,
    { checksDefinitionFiles: patterns, previousChecksDefinitionFiles },
    `${OutputUtil.loggedSentencesOf(logged)} (was ${previousChecksDefinitionFiles?.join(' ') ?? 'none'}).`,
  );
}

function gateKeyCommandFrom(commandArguments: ArgumentParser): string | null {
  if (commandArguments.positional() !== undefined || commandArguments.option('install') !== undefined || commandArguments.flag('restamp')
    || commandArguments.flag('definition-files') || optionValueGiven(commandArguments, 'definition-files')) {
    throw new OperationRefusal('refused', `--key-command goes alone, without a check command, --install, --definition-files or --restamp.\n  Usage: ${USAGE}`);
  }
  if (commandArguments.flag('clear')) {
    if (!optionValueGiven(commandArguments, 'key-command')) return null;
    throw new OperationRefusal('refused', `Give a key command or --clear, not both.\n  Usage: ${USAGE}`);
  }
  const keyCommand = commandArguments.option('key-command');
  if (!BoardSettingsUtil.checkCommandIsWellFormed(keyCommand)) {
    throw new OperationRefusal('refused', `A key command is a shell line that is not blank, quoted as one argument.\n  Usage: ${USAGE}`);
  }
  return keyCommand;
}

/** Stored untried, like the install line: it runs only in a gate's own host, on the gated tree. */
async function setGateKeyCommand(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  const keyCommand = gateKeyCommandFrom(commandArguments);
  const command: ControlCommandOf<'gate-key-command-set'> = { kind: 'gate-key-command-set', command: keyCommand };
  await relayWhenUnderJob(context, command);
  const { logged, previousGateKeyCommand } = await openTrackerForWriting(commandArguments, context, (change) => ControlService.apply(command, change).result);
  OutputUtil.printEntity(
    commandArguments,
    context,
    { gateKeyCommand: keyCommand, previousGateKeyCommand },
    `${OutputUtil.loggedSentencesOf(logged)} (was ${previousGateKeyCommand ?? 'none'}).`,
  );
}

function gateCachePathsFrom(commandArguments: ArgumentParser, context: CommandContext): string[] | null {
  if (commandArguments.positional() !== undefined || commandArguments.option('install') !== undefined || commandArguments.flag('restamp')
    || commandArguments.flag('definition-files') || optionValueGiven(commandArguments, 'definition-files')
    || commandArguments.flag('key-command') || optionValueGiven(commandArguments, 'key-command')) {
    throw new OperationRefusal(
      'refused',
      `--cache-paths goes alone, without a check command, --install, --definition-files, --key-command or --restamp.\n  Usage: ${USAGE}`,
    );
  }
  if (commandArguments.flag('clear')) {
    if (!optionValueGiven(commandArguments, 'cache-paths')) return null;
    throw new OperationRefusal('refused', `Give cache paths or --clear, not both.\n  Usage: ${USAGE}`);
  }
  const paths = (commandArguments.option('cache-paths') ?? '').split(/\s+/).filter((path) => path !== '');
  if (!BoardSettingsUtil.gateCachePathsAreWellFormed(paths)) {
    throw new OperationRefusal('refused', `Cache paths are absolute or ~/ folders, separated by spaces and quoted as one argument.\n  Usage: ${USAGE}`);
  }
  for (const path of paths) {
    const refusal = GateCachePaths.refusalOf(path, context.homeDirectory, context.executableSearchPath);
    if (refusal !== null) {
      throw new OperationRefusal('refused', `The cache path ${path} ${CACHE_FOLDER_REFUSAL_WORDING[refusal]}, so a gate may never write it; nothing was stored.`);
    }
  }
  return paths;
}

/** Stored untried, like the install line; each folder is vetted again whenever a gate's profile is written. */
async function setGateCachePaths(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  const paths = gateCachePathsFrom(commandArguments, context);
  const command: ControlCommandOf<'gate-cache-paths-set'> = { kind: 'gate-cache-paths-set', paths };
  await relayWhenUnderJob(context, command);
  const { logged, previousGateCachePaths } = await openTrackerForWriting(commandArguments, context, (change) => ControlService.apply(command, change).result);
  OutputUtil.printEntity(
    commandArguments,
    context,
    { gateCachePaths: paths, previousGateCachePaths },
    `${OutputUtil.loggedSentencesOf(logged)} (was ${previousGateCachePaths?.join(' ') ?? 'none'}).`,
  );
}

export const checksCommand: CommandHandler = async (commandArguments, context) => {
  commandArguments.rejectUnknownOptions(KNOWN_OPTION_NAMES, USAGE);
  commandArguments.rejectExtraPositionals(1, USAGE);

  if (commandArguments.flag('cache-paths') || optionValueGiven(commandArguments, 'cache-paths')) {
    await setGateCachePaths(commandArguments, context);
    return;
  }

  if (commandArguments.flag('key-command') || optionValueGiven(commandArguments, 'key-command')) {
    await setGateKeyCommand(commandArguments, context);
    return;
  }

  if (commandArguments.flag('definition-files') || optionValueGiven(commandArguments, 'definition-files')) {
    await setChecksDefinitionFiles(commandArguments, context);
    return;
  }

  const installCommand = commandArguments.option('install');
  if (installCommand !== undefined) {
    await setInstallCommand(installCommand, commandArguments, context);
    return;
  }

  if (commandArguments.positional() === undefined && !commandArguments.flag('clear')) {
    if (commandArguments.flag('restamp')) throw new OperationRefusal('refused', `--restamp goes with a command or --clear.\n  Usage: ${USAGE}`);
    printCurrentCheckCommand(commandArguments, context);
    return;
  }
  const checkCommand = storedCommandFrom(commandArguments);
  const restamps     = commandArguments.flag('restamp');
  const command: ControlCommandOf<'checks-set'> = { kind: 'checks-set', command: checkCommand, restamps };
  // Relayed before the trial run: the runner, not a session's worktree, decides whether the line may be stored.
  await relayWhenUnderJob(context, command);
  if (checkCommand !== null) {
    if (!restamps) refuseAChangeTheTicketsInFlightWouldBlock(checkCommand, context);
    await requireTheCommandPassesInTheMainCheckout(checkCommand, commandArguments, context);
  }

  const { logged, previousCheckCommand, restampedTicketIds } = await openTrackerForWriting(
    commandArguments,
    context,
    (change) => ControlService.apply(command, change).result,
  ).catch((error: unknown) => {
    if (refusalIsOperationRefusal(error) && error.detail?.kind === 'no-check-command-to-clear') {
      throw new OperationRefusal('refused', `${OperationRefusalWordingUtil.messageOf(error)}\n  Usage: ${USAGE}`);
    }
    throw error;
  });

  const loggedSentence = OutputUtil.loggedSentencesOf(logged);
  OutputUtil.printEntity(
    commandArguments,
    context,
    { checkCommand, previousCheckCommand, restampedTicketIds },
    `${loggedSentence} (was ${previousCheckCommand ?? 'none'}).`,
  );
};
