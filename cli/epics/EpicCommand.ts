/** `epic`: the epics a tracker groups its tickets under. `list` and `show` change nothing, so they read without the lock. */
import type { Board }              from '../../src/lib/tracker-model/Board.ts';
import { readingBoardOf }          from '../../src/lib/tracker-model/ReadingBoard.ts';
import { requireTracker }          from '../../src/services/tracker/TrackerReader.ts';
import { requireWorkspace }        from '../../src/services/tracker/Workspace.ts';
import { OperationRefusal }        from '../../src/shared/OperationRefusal.ts';
import type { CommandContext }     from '../CommandContext.ts';
import type { CommandHandler }     from '../CommandHandler.ts';
import type { ArgumentParser }     from '../arguments/ArgumentParser.ts';
import { OutputUtil }              from '../utils/OutputUtil.ts';
import { EPIC_CHANGE_SUBCOMMANDS } from './EpicChangeSubcommands.ts';
import {
  epicDocumentOf,
  epicDocumentWithBodyOf,
  epicListingLineOf,
  epicSummaryOf
}                                 from './EpicOutput.ts';
import { EPIC_USAGE } from './constants/EpicUsage.ts';

const READING_OPTION_NAMES = ['json'];

function readingBoardFor(context: CommandContext): Board {
  const { progress, listing, epicListing } = requireTracker(requireWorkspace(context.currentDirectory));
  OutputUtil.reportIgnoredEpicFiles(context, epicListing.malformed);
  return readingBoardOf(progress, listing.tickets, epicListing.epics);
}

function listEpics(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(READING_OPTION_NAMES, EPIC_USAGE);
  commandArguments.rejectExtraPositionals(1, EPIC_USAGE);
  const board   = readingBoardFor(context);
  const entries = board.epics().map((epic) => ({ epic, rollup: board.epicRollupOf(epic) }));
  const human   = entries.length === 0 ? 'No epics.' : entries.map(({ rollup }) => epicListingLineOf(rollup)).join('\n');
  OutputUtil.printEntity(commandArguments, context, entries.map(({ epic, rollup }) => epicDocumentOf(epic, rollup)), human);
  return Promise.resolve();
}

function showEpic(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(READING_OPTION_NAMES, EPIC_USAGE);
  commandArguments.rejectExtraPositionals(2, EPIC_USAGE);
  const key = commandArguments.positionals()[1];
  if (key === undefined) throw new OperationRefusal('refused', `agent-progress epic show needs an epic key.\n  Usage: ${EPIC_USAGE}`);

  const board = readingBoardFor(context);
  const epic  = board.epicByKey(key);
  if (epic === undefined) throw new OperationRefusal('refused', { kind: 'board-refusal', boardRefusal: { reason: 'unknown-epic', missingEpicKeys: [key] } });
  const rollup = board.epicRollupOf(epic);
  OutputUtil.printEntity(commandArguments, context, epicDocumentWithBodyOf(epic, rollup), `${epicSummaryOf(epic, rollup)}\n\n${epic.body}`);
  return Promise.resolve();
}

const EPIC_SUBCOMMANDS: Readonly<Record<string, (commandArguments: ArgumentParser, context: CommandContext) => Promise<void>>> = Object.freeze({
  ...EPIC_CHANGE_SUBCOMMANDS,
  list: listEpics,
  show: showEpic,
});

export const epicCommand: CommandHandler = async (commandArguments, context) => {
  const subcommand = commandArguments.positionals()[0];

  // `Object.hasOwn`, never a bare index: `subcommand` is argv text, and `constructor` is a truthy inherited property.
  const handler = subcommand !== undefined && Object.hasOwn(EPIC_SUBCOMMANDS, subcommand) ? EPIC_SUBCOMMANDS[subcommand] : undefined;
  if (handler !== undefined) return handler(commandArguments, context);

  throw new OperationRefusal(
    'refused',
    `${subcommand === undefined ? 'agent-progress epic needs a subcommand' : `"${subcommand}" is not an agent-progress epic subcommand`}.\n  Usage: ${EPIC_USAGE}`,
  );
};
