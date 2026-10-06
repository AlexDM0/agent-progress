import { readingBoardOf }        from '../../../src/lib/tracker-model/ReadingBoard.ts';
import { BoardSettingsUtil }     from '../../../src/lib/tracker-model/utils/BoardSettingsUtil.ts';
import { requireProgressFile }   from '../../../src/services/tracker/TrackerReader.ts';
import { requireWorkspace }      from '../../../src/services/tracker/Workspace.ts';
import { OperationRefusal }      from '../../../src/shared/OperationRefusal.ts';
import type { CommandContext }   from '../../CommandContext.ts';
import type { CommandHandler }   from '../../CommandHandler.ts';
import { openTrackerForWriting } from '../../OpenTrackerForWriting.ts';
import type { ArgumentParser }   from '../../arguments/ArgumentParser.ts';
import { OutputUtil }            from '../../utils/OutputUtil.ts';

const USAGE = 'agent-progress checks ["<command>" | --clear] [--json]';

const KNOWN_OPTION_NAMES = ['clear', 'json'];

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

export const checksCommand: CommandHandler = async (commandArguments, context) => {
  commandArguments.rejectUnknownOptions(KNOWN_OPTION_NAMES, USAGE);
  commandArguments.rejectExtraPositionals(1, USAGE);

  if (commandArguments.positional() === undefined && !commandArguments.flag('clear')) {
    printCurrentCheckCommand(commandArguments, context);
    return;
  }
  const checkCommand = storedCommandFrom(commandArguments);

  const { logged, previousCheckCommand } = await openTrackerForWriting(commandArguments, context, (change) => {
    if (checkCommand === null && change.board.checkCommand() === undefined) {
      throw new OperationRefusal('refused', `No check command is set, so there is none to clear.\n  Usage: ${USAGE}`);
    }
    return change.board.setCheckCommand(checkCommand, change.at);
  });

  const loggedSentence = OutputUtil.loggedSentencesOf(logged);
  OutputUtil.printEntity(commandArguments, context, { checkCommand, previousCheckCommand }, `${loggedSentence} (was ${previousCheckCommand ?? 'none'}).`);
};
