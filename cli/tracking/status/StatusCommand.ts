import { LogUtil }                           from '../../../src/adapters/utils/LogUtil.ts';
import { readingBoardOf }                    from '../../../src/lib/tracker-model/ReadingBoard.ts';
import { TimeUtil }                          from '../../../src/lib/utils/TimeUtil.ts';
import { requireTracker }                    from '../../../src/services/tracker/TrackerReader.ts';
import { requireWorkspace }                  from '../../../src/services/tracker/Workspace.ts';
import type { WordedLogEntry }               from '../../../src/shared/@types/WordedLogEntry.ts';
import type { CommandHandler }               from '../../CommandHandler.ts';
import { NextLineUtil }                      from '../../utils/NextLineUtil.ts';
import { OutputUtil }                        from '../../utils/OutputUtil.ts';
import { fullDocumentOf, workingDocumentOf } from './StatusDocuments.ts';
import { humanStatusTextOf }                 from './StatusText.ts';

const USAGE = 'agent-progress status [--json] [--full]';

const KNOWN_OPTION_NAMES = ['json', 'full'];

/**
 * Sorted for display because `--at` backfills, so array order is not chronological: a stated exception
 * to "a clock decides nothing" that decides nothing but a print order, on a copy of the caller's array.
 */
function logNewestFirstOf(log: readonly WordedLogEntry[]): WordedLogEntry[] {
  const dated = log.map((entry, appendedIndex) => ({
    entry,
    appendedIndex,
    epochMilliseconds: TimeUtil.parseIso(entry.at)?.getTime() ?? Number.NEGATIVE_INFINITY,
  }));
  dated.sort((a, b) => b.epochMilliseconds - a.epochMilliseconds || b.appendedIndex - a.appendedIndex);
  return dated.map((datedEntry) => datedEntry.entry);
}

export const statusCommand: CommandHandler = async (commandArguments, context) => {
  commandArguments.rejectUnknownOptions(KNOWN_OPTION_NAMES, USAGE);
  commandArguments.rejectExtraPositionals(0, USAGE);

  const workspace = requireWorkspace(context.currentDirectory);
  const { progress, storedLog, listing } = requireTracker(workspace);
  const wordedLog       = storedLog.records.map(LogUtil.wordedEntryOf);
  const logNewestFirst  = logNewestFirstOf(wordedLog);
  const board           = readingBoardOf(progress, listing.tickets);

  OutputUtil.reportIgnoredTicketFiles(context, listing.malformed);

  const showsEverything = commandArguments.flag('full');
  const asJson          = showsEverything ? fullDocumentOf(progress, wordedLog, board) : workingDocumentOf(progress, logNewestFirst, board);
  const humanText       = humanStatusTextOf(progress, logNewestFirst, board, showsEverything);
  OutputUtil.printEntityThenNextLine(commandArguments, context, asJson, humanText, NextLineUtil.nextLineOf(board));
  return Promise.resolve();
};
