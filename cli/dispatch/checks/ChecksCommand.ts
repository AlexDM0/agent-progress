import { refusalIsBoardRefusal }               from '../../../src/lib/tracker-model/BoardRefusal.ts';
import { readingBoardOf }                      from '../../../src/lib/tracker-model/ReadingBoard.ts';
import { BoardSettingsUtil }                   from '../../../src/lib/tracker-model/utils/BoardSettingsUtil.ts';
import { requireProgressFile, requireTracker } from '../../../src/services/tracker/TrackerReader.ts';
import { requireWorkspace }                    from '../../../src/services/tracker/Workspace.ts';
import { OperationRefusal }                    from '../../../src/shared/OperationRefusal.ts';
import type { CommandContext }                 from '../../CommandContext.ts';
import type { CommandHandler }                 from '../../CommandHandler.ts';
import { openTrackerForWriting }               from '../../OpenTrackerForWriting.ts';
import type { ArgumentParser }                 from '../../arguments/ArgumentParser.ts';
import { OutputUtil }                          from '../../utils/OutputUtil.ts';
import {
  CHECK_OUTPUT_TAIL_LINES,
  checkRunOutcomeText,
  checkRunPassed,
  lastLinesOf,
  runCheckCommand
} from '../CheckCommandRun.ts';

const USAGE = 'agent-progress checks ["<command>" | --clear] [--restamp] [--json]';

const KNOWN_OPTION_NAMES = ['clear', 'restamp', 'json'];

const NO_CHECK_COMMAND_TEXT = 'No check command is set, so `agent-progress release` runs none. Set one with `agent-progress checks "<command>"`.';

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

export const checksCommand: CommandHandler = async (commandArguments, context) => {
  commandArguments.rejectUnknownOptions(KNOWN_OPTION_NAMES, USAGE);
  commandArguments.rejectExtraPositionals(1, USAGE);

  if (commandArguments.positional() === undefined && !commandArguments.flag('clear')) {
    if (commandArguments.flag('restamp')) throw new OperationRefusal('refused', `--restamp goes with a command or --clear.\n  Usage: ${USAGE}`);
    printCurrentCheckCommand(commandArguments, context);
    return;
  }
  const checkCommand = storedCommandFrom(commandArguments);
  const restamps     = commandArguments.flag('restamp');
  if (checkCommand !== null) {
    if (!restamps) refuseAChangeTheTicketsInFlightWouldBlock(checkCommand, context);
    await requireTheCommandPassesInTheMainCheckout(checkCommand, commandArguments, context);
  }

  const { logged, previousCheckCommand, restampedTicketIds } = await openTrackerForWriting(commandArguments, context, (change) => {
    if (checkCommand === null && change.board.checkCommand() === undefined && !restamps) {
      throw new OperationRefusal('refused', `No check command is set, so there is none to clear.\n  Usage: ${USAGE}`);
    }
    return change.board.setCheckCommand(checkCommand, restamps, change.at);
  });

  const loggedSentence = OutputUtil.loggedSentencesOf(logged);
  OutputUtil.printEntity(
    commandArguments,
    context,
    { checkCommand, previousCheckCommand, restampedTicketIds },
    `${loggedSentence} (was ${previousCheckCommand ?? 'none'}).`,
  );
};
