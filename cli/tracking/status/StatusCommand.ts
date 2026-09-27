import { ProgressDocumentUtil }                                  from '../../../src/adapters/progress/utils/ProgressDocumentUtil.ts';
import { LogUtil }                                               from '../../../src/adapters/utils/LogUtil.ts';
import { StatusDocumentUtil }                                    from '../../../src/adapters/utils/StatusDocumentUtil.ts';
import { StatusWordingUtil }                                     from '../../../src/adapters/utils/StatusWordingUtil.ts';
import { TicketJsonUtil }                                        from '../../../src/adapters/utils/TicketJsonUtil.ts';
import type { Task, TaskStatus }                                 from '../../../src/lib/tracker-model/@types/Task.ts';
import type { ReadyTicket }                                      from '../../../src/lib/tracker-model/@types/Ticket.ts';
import type { TrackerProgress }                                  from '../../../src/lib/tracker-model/@types/TrackerProgress.ts';
import type { Board }                                            from '../../../src/lib/tracker-model/Board.ts';
import { readingBoardOf }                                        from '../../../src/lib/tracker-model/ReadingBoard.ts';
import { SETTLED_TASK_STATUSES, TASK_STATUSES, TICKET_STATUSES } from '../../../src/lib/tracker-model/constants/Statuses.ts';
import { TimeUtil }                                              from '../../../src/lib/utils/TimeUtil.ts';
import { TokenCountUtil }                                        from '../../../src/lib/utils/TokenCountUtil.ts';
import { requireTracker }                                        from '../../../src/services/tracker/TrackerReader.ts';
import { requireWorkspace }                                      from '../../../src/services/tracker/Workspace.ts';
import type { WordedLogEntry }                                   from '../../../src/shared/@types/WordedLogEntry.ts';
import { LIMITS }                                                from '../../../src/shared/constants/Limits.ts';
import type { CommandHandler }                                   from '../../CommandHandler.ts';
import { NextLineUtil }                                          from '../../utils/NextLineUtil.ts';
import { OutputUtil }                                            from '../../utils/OutputUtil.ts';

const USAGE = 'agent-progress status [--json] [--full]';

const KNOWN_OPTION_NAMES = ['json', 'full'];

const HUMAN_LOG_ENTRY_COUNT = 5;

const WORKING_VIEW_LOG_ENTRY_COUNT = 10;

const TASK_COLUMN_WIDTHS_CHARACTERS = {
  identifier: 5,
  status:     12,
  owner:      14,
  ticket:     7,
  tokens:     8,
};

function countsByStatus(statuses: readonly TaskStatus[], statusOfEach: readonly TaskStatus[]): string {
  const present = statuses
    .map((status) => ({ count: statusOfEach.filter((occurring) => occurring === status).length, status }))
    .filter((entry) => entry.count > 0)
    .map((entry) => `${entry.count} ${StatusWordingUtil.statusWordFor(entry.status)}`);
  return present.length === 0 ? 'none' : present.join(' · ');
}

/**
 * Sorted for display because `--at` backfills, so array order is not chronological: a stated exception
 * to "a clock decides nothing" that decides nothing but a print order, on a copy of the caller's array.
 */
function logNewestFirst(log: readonly WordedLogEntry[]): WordedLogEntry[] {
  const dated = log.map((entry, appendedIndex) => ({
    entry,
    appendedIndex,
    epochMilliseconds: TimeUtil.parseIso(entry.at)?.getTime() ?? Number.NEGATIVE_INFINITY,
  }));
  dated.sort((a, b) => b.epochMilliseconds - a.epochMilliseconds || b.appendedIndex - a.appendedIndex);
  return dated.map((datedEntry) => datedEntry.entry);
}

function logStampOf(entry: WordedLogEntry, showsTheDate: boolean): string {
  const start = showsTheDate ? LIMITS.MONTH_AND_DAY_SLICE_START_CHARACTER_OFFSET : LIMITS.CLOCK_SLICE_START_CHARACTER_OFFSET;
  return entry.at.slice(start, LIMITS.CLOCK_SLICE_END_CHARACTER_OFFSET).replace('T', ' ');
}

/** `null` when no row reported a usage, which is a different answer from `0`. */
function totalTokensOf(tasks: readonly Readonly<Task>[]): number | null {
  const reported = tasks.filter((task) => task.tokens !== null);
  if (reported.length === 0) return null;
  return reported.reduce((running, task) => running + (task.tokens ?? 0), 0);
}

/**
 * The stored run id rides in `concurrency` beside the state it belongs to, so the orchestrator finds the run to resume where it reads the
 * state, and the ids in flight end the block; `readyTickets` is read from the Board's ready tickets, as `readyTicketIds` is.
 */
function derivedDocumentOf(board: Board): { concurrency: object; readyTickets: ReadyTicket[] } {
  const concurrency     = board.dispatchCapacity();
  const dispatcherRunId = board.dispatcherRunId();
  return {
    concurrency:  { ...(dispatcherRunId === undefined ? concurrency : { ...concurrency, dispatcherRunId }), ...StatusDocumentUtil.inProgressIdsOf(board) },
    readyTickets: board.readyTicketEntries(),
  };
}

/**
 * The whole progress file plus every ticket in the version 1 document shape, with the derived `concurrency` and `readyTickets` beside it,
 * then the dispatch fields `reviewWaitingTickets`, `pausedBuilds` and `ticketRows`.
 */
function fullDocumentOf(progress: TrackerProgress, wordedLog: readonly WordedLogEntry[], board: Board): object {
  return {
    ...ProgressDocumentUtil.documentOf(progress, wordedLog),
    tickets: board.tickets().map(TicketJsonUtil.ticketDocumentOf),
    ...derivedDocumentOf(board),
    ...StatusDocumentUtil.boardWorkOf(board, board.tickets()),
  };
}

/** What an agent opening a session needs: unsettled rows and tickets, the recent log newest first, and counts of what was left out. */
function workingDocumentOf(progress: TrackerProgress, wordedLog: readonly WordedLogEntry[], board: Board): object {
  const tickets          = board.tickets();
  const unsettledTasks   = board.tasks().filter((task) => !board.taskIsSettled(task));
  const unsettledTickets = tickets.filter((ticket) => !board.ticketIsSettled(ticket));
  const recentLog        = logNewestFirst(wordedLog).slice(0, WORKING_VIEW_LOG_ENTRY_COUNT);
  return {
    ...ProgressDocumentUtil.documentOf(progress, recentLog),
    tasks:   unsettledTasks,
    tickets: unsettledTickets.map(TicketJsonUtil.ticketDocumentOf),
    ...derivedDocumentOf(board),
    omitted: {
      settledTasks:    progress.tasks.length - unsettledTasks.length,
      settledTickets:  tickets.length - unsettledTickets.length,
      olderLogEntries: wordedLog.length - recentLog.length,
    },
    ...StatusDocumentUtil.boardWorkOf(board, unsettledTickets),
  };
}

function humanStatusTextOf(progress: TrackerProgress, wordedLog: readonly WordedLogEntry[], board: Board, showsEverything: boolean): string {
  const tickets = board.tickets();
  const lines = [
    `${progress.project} — started ${progress.startedAt.slice(0, LIMITS.DATE_AND_CLOCK_LENGTH_CHARACTERS).replace('T', ' ')}`,
    `Tasks:   ${countsByStatus(TASK_STATUSES, progress.tasks.map((task) => task.status))}`,
    `Tickets: ${countsByStatus(TICKET_STATUSES, tickets.map((ticket) => ticket.frontmatter.status))}`,
  ];

  const totalTokens = totalTokensOf(progress.tasks);
  if (totalTokens !== null) {
    const reportedCount = progress.tasks.filter((task) => task.tokens !== null).length;
    lines.push(`Tokens:  ${TokenCountUtil.formatTokenCount(totalTokens)} reported across ${reportedCount} of ${progress.tasks.length} rows`);
  }

  const listedTasks = showsEverything ? progress.tasks : progress.tasks.filter((task) => !board.taskIsSettled(task));
  if (listedTasks.length > 0) {
    lines.push('');
    lines.push([
      OutputUtil.padColumn('id', TASK_COLUMN_WIDTHS_CHARACTERS.identifier),
      OutputUtil.padColumn('status', TASK_COLUMN_WIDTHS_CHARACTERS.status),
      OutputUtil.padColumn('owner', TASK_COLUMN_WIDTHS_CHARACTERS.owner),
      OutputUtil.padColumn('ticket', TASK_COLUMN_WIDTHS_CHARACTERS.ticket),
      OutputUtil.padColumn('tokens', TASK_COLUMN_WIDTHS_CHARACTERS.tokens),
      'name',
    ].join(''));
    for (const task of listedTasks) {
      lines.push([
        OutputUtil.padColumn(`#${task.id}`, TASK_COLUMN_WIDTHS_CHARACTERS.identifier),
        OutputUtil.padColumn(StatusWordingUtil.statusWordFor(task.status), TASK_COLUMN_WIDTHS_CHARACTERS.status),
        OutputUtil.padColumn(task.owner === '' ? '-' : task.owner, TASK_COLUMN_WIDTHS_CHARACTERS.owner),
        OutputUtil.padColumn(task.ticket === null ? '-' : `#${task.ticket}`, TASK_COLUMN_WIDTHS_CHARACTERS.ticket),
        OutputUtil.padColumn(task.tokens === null ? '-' : TokenCountUtil.formatTokenCount(task.tokens), TASK_COLUMN_WIDTHS_CHARACTERS.tokens),
        task.name,
      ].join(''));
    }
  }

  const settledTaskCount = progress.tasks.length - listedTasks.length;
  if (settledTaskCount > 0) {
    const settledStatusesText = SETTLED_TASK_STATUSES.map((status) => StatusWordingUtil.statusWordFor(status)).join(' or ');
    lines.push(`(${settledTaskCount} ${settledStatusesText} rows not shown; --full lists them)`);
  }

  const newestFirst  = logNewestFirst(wordedLog);
  const recentLog    = showsEverything ? newestFirst : newestFirst.slice(0, HUMAN_LOG_ENTRY_COUNT);
  const distinctDays = new Set(wordedLog.map((entry) => entry.at.slice(0, LIMITS.CALENDAR_DATE_LENGTH_CHARACTERS)));
  if (recentLog.length > 0) {
    lines.push('');
    lines.push(showsEverything ? `Log (all ${recentLog.length}):` : `Log (last ${recentLog.length}):`);
    for (const entry of recentLog) lines.push(`  ${logStampOf(entry, distinctDays.size > 1)}  ${entry.text}`);
  }

  return lines.join('\n');
}

export const statusCommand: CommandHandler = async (commandArguments, context) => {
  commandArguments.rejectUnknownOptions(KNOWN_OPTION_NAMES, USAGE);
  commandArguments.rejectExtraPositionals(0, USAGE);

  const workspace = requireWorkspace(context.currentDirectory);
  const { progress, storedLog, listing } = requireTracker(workspace);
  const wordedLog       = storedLog.records.map(LogUtil.wordedEntryOf);
  const board           = readingBoardOf(progress, listing.tickets);

  OutputUtil.reportIgnoredTicketFiles(context, listing.malformed);

  const showsEverything = commandArguments.flag('full');
  const asJson          = showsEverything ? fullDocumentOf(progress, wordedLog, board) : workingDocumentOf(progress, wordedLog, board);
  OutputUtil.printEntityThenNextLine(commandArguments, context, asJson, humanStatusTextOf(progress, wordedLog, board, showsEverything), NextLineUtil.nextLineOf(board));
  return Promise.resolve();
};
