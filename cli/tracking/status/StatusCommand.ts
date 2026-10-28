import { LogUtil }                                from '../../../src/adapters/utils/LogUtil.ts';
import { LocalTimeUtil }                          from '../../../src/lib/local-time/LocalTimeUtil.ts';
import { readingBoardOf }                         from '../../../src/lib/tracker-model/ReadingBoard.ts';
import { holdJournalFilePathOf, readHoldJournal } from '../../../src/services/tracker/HoldJournal.ts';
import { requireTracker }                         from '../../../src/services/tracker/TrackerReader.ts';
import { requireWorkspace }                       from '../../../src/services/tracker/Workspace.ts';
import type { WordedLogEntry }                    from '../../../src/shared/@types/WordedLogEntry.ts';
import { PRODUCT_NAMES }                          from '../../../src/shared/constants/ProductNames.ts';
import type { CommandHandler }                    from '../../CommandHandler.ts';
import { NextLineUtil }                           from '../../utils/NextLineUtil.ts';
import { OutputUtil }                             from '../../utils/OutputUtil.ts';
import { fullDocumentOf, workingDocumentOf }      from './StatusDocuments.ts';
import { humanStatusTextOf }                      from './StatusText.ts';

const USAGE = `${PRODUCT_NAMES.PROGRAM} status [--json] [--full] [--tickets-only]`;

const KNOWN_OPTION_NAMES = ['json', 'full', 'tickets-only'];

/**
 * Sorted for display because `--at` backfills, so array order is not chronological: a stated exception
 * to "a clock decides nothing" that decides nothing but a print order, on a copy of the caller's array.
 */
function logNewestFirstOf(log: readonly WordedLogEntry[]): WordedLogEntry[] {
  const dated = log.map((entry, appendedIndex) => ({
    entry,
    appendedIndex,
    epochMilliseconds: LocalTimeUtil.parseIso(entry.at)?.getTime() ?? Number.NEGATIVE_INFINITY,
  }));
  dated.sort((a, b) => b.epochMilliseconds - a.epochMilliseconds || b.appendedIndex - a.appendedIndex);
  return dated.map((datedEntry) => datedEntry.entry);
}

export const statusCommand: CommandHandler = async (commandArguments, context) => {
  commandArguments.rejectUnknownOptions(KNOWN_OPTION_NAMES, USAGE);
  commandArguments.rejectExtraPositionals(0, USAGE);

  const workspace = requireWorkspace(context.currentDirectory);
  const holdJournalReading = readHoldJournal(workspace);
  if (holdJournalReading.verdict === 'malformed') {
    context.standardError(`Hold journal unreadable: ${holdJournalFilePathOf(workspace)}: ${holdJournalReading.reason}. `
      + 'Every write refuses until it is repaired or removed.');
  }
  const {
    progress, storedLog, listing, epicListing, draftListing
  } = requireTracker(workspace);
  const wordedLog       = storedLog.records.map(LogUtil.wordedEntryOf);
  const logNewestFirst  = logNewestFirstOf(wordedLog);
  const board           = readingBoardOf(progress, listing.tickets, epicListing.epics, draftListing.drafts);

  OutputUtil.reportIgnoredTicketFiles(context, listing.malformed);
  OutputUtil.reportIgnoredEpicFiles(context, epicListing.malformed);
  OutputUtil.reportIgnoredDraftFiles(context, draftListing.malformed);

  const showsEverything  = commandArguments.flag('full');
  const showsTicketsOnly = commandArguments.flag('tickets-only');
  const asJson           = showsEverything
    ? fullDocumentOf(progress, wordedLog, board, showsTicketsOnly)
    : workingDocumentOf(progress, logNewestFirst, board, showsTicketsOnly);
  const humanText        = humanStatusTextOf(progress, logNewestFirst, board, { showsEverything, showsTicketsOnly });
  OutputUtil.printEntityThenNextLine(commandArguments, context, asJson, humanText, NextLineUtil.nextLineOf(board));
  return Promise.resolve();
};
