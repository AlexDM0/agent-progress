import { ProgressDocumentUtil }           from '../../../src/adapters/progress/utils/ProgressDocumentUtil';
import { LogUtil }                        from '../../../src/adapters/utils/LogUtil';
import type { ProgressFile }              from '../../../src/lib/tracker-model/@types/ProgressFile';
import type { Task }                      from '../../../src/lib/tracker-model/@types/Task';
import type { Board }                     from '../../../src/lib/tracker-model/Board';
import { TASK_STATUSES, TICKET_STATUSES } from '../../../src/lib/tracker-model/constants/Statuses';
import { TimeUtil }                       from '../../../src/lib/utils/TimeUtil';
import { TokenCountUtil }                 from '../../../src/lib/utils/TokenCountUtil';
import { requireTracker }                 from '../../../src/services/tracker/TrackerReader';
import { requireWorkspace }               from '../../../src/services/tracker/Workspace';
import type { WordedLogEntry }            from '../../../src/shared/@types/WordedLogEntry';
import { LIMITS }                         from '../../../src/shared/constants/Limits';
import {
  boardForReading,
  concurrencyDocumentOf,
  nextLineFor,
  padColumn,
  printEntityThenNextLine,
  readyTicketsOf,
  reportIgnoredTicketFiles,
  ticketDocumentOf,
  type ReadyTicket
} from '../../CommandSupport';
import type { CommandHandler } from '../../CommandTable';

const USAGE = 'agent-progress status [--json] [--full]';

const KNOWN_OPTION_NAMES = ['json', 'full'];

const HUMAN_LOG_ENTRY_COUNT = 5;

const WORKING_VIEW_LOG_ENTRY_COUNT = 10;

const TASK_COLUMN_WIDTHS = {
  identifier: 5,
  status:     12,
  owner:      14,
  ticket:     7,
  tokens:     8,
};

function countsByStatus(statuses: readonly string[], statusOfEach: readonly string[]): string {
  const present = statuses
    .map((status) => ({ count: statusOfEach.filter((occurring) => occurring === status).length, status }))
    .filter((entry) => entry.count > 0)
    .map((entry) => `${entry.count} ${entry.status}`);
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
  const start = showsTheDate ? LIMITS.MONTH_AND_DAY_SLICE_START : LIMITS.CLOCK_SLICE_START;
  return entry.at.slice(start, LIMITS.CLOCK_SLICE_END).replace('T', ' ');
}

/** `null` when no row reported a usage, which is a different answer from `0`. */
function totalTokensOf(tasks: readonly Readonly<Task>[]): number | null {
  const reported = tasks.filter((task) => task.tokens !== null);
  if (reported.length === 0) return null;
  return reported.reduce((running, task) => running + (task.tokens ?? 0), 0);
}

/**
 * The stored run id rides in `concurrency` beside the state it belongs to, so the orchestrator finds the run to resume where it reads the
 * state; `readyTickets` is read from the Board's ready tickets, as `readyTicketIds` is.
 */
function derivedDocumentOf(board: Board): { concurrency: object; readyTickets: ReadyTicket[] } {
  const concurrency     = concurrencyDocumentOf(board);
  const dispatcherRunId = board.dispatcherRunId();
  return {
    concurrency:  dispatcherRunId === undefined ? concurrency : { ...concurrency, dispatcherRunId },
    readyTickets: readyTicketsOf(board),
  };
}

/** The whole progress file plus every ticket in the version 1 document shape, with the derived `concurrency` and `readyTickets` beside it. */
function fullDocumentOf(progress: ProgressFile, wordedLog: readonly WordedLogEntry[], board: Board): object {
  return { ...ProgressDocumentUtil.documentOf(progress, wordedLog), tickets: board.tickets().map(ticketDocumentOf), ...derivedDocumentOf(board) };
}

/** What an agent opening a session needs: unsettled rows and tickets, the recent log newest first, and counts of what was left out. */
function workingDocumentOf(progress: ProgressFile, wordedLog: readonly WordedLogEntry[], board: Board): object {
  const tickets          = board.tickets();
  const unsettledTasks   = board.tasks().filter((task) => !board.taskIsSettled(task));
  const unsettledTickets = tickets.filter((ticket) => !board.ticketIsSettled(ticket));
  const recentLog        = logNewestFirst(wordedLog).slice(0, WORKING_VIEW_LOG_ENTRY_COUNT);
  return {
    ...ProgressDocumentUtil.documentOf(progress, recentLog),
    tasks:   unsettledTasks,
    tickets: unsettledTickets.map(ticketDocumentOf),
    ...derivedDocumentOf(board),
    omitted: {
      settledTasks:    progress.tasks.length - unsettledTasks.length,
      settledTickets:  tickets.length - unsettledTickets.length,
      olderLogEntries: wordedLog.length - recentLog.length,
    },
  };
}

function renderHumanStatus(progress: ProgressFile, wordedLog: readonly WordedLogEntry[], board: Board, showsEverything: boolean): string {
  const tickets = board.tickets();
  const lines = [
    `${progress.project} — started ${progress.startedAt.slice(0, LIMITS.DATE_AND_CLOCK_LENGTH).replace('T', ' ')}`,
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
      padColumn('id', TASK_COLUMN_WIDTHS.identifier),
      padColumn('status', TASK_COLUMN_WIDTHS.status),
      padColumn('owner', TASK_COLUMN_WIDTHS.owner),
      padColumn('ticket', TASK_COLUMN_WIDTHS.ticket),
      padColumn('tokens', TASK_COLUMN_WIDTHS.tokens),
      'name',
    ].join(''));
    for (const task of listedTasks) {
      lines.push([
        padColumn(`#${task.id}`, TASK_COLUMN_WIDTHS.identifier),
        padColumn(task.status, TASK_COLUMN_WIDTHS.status),
        padColumn(task.owner === '' ? '-' : task.owner, TASK_COLUMN_WIDTHS.owner),
        padColumn(task.ticket === null ? '-' : `#${task.ticket}`, TASK_COLUMN_WIDTHS.ticket),
        padColumn(task.tokens === null ? '-' : TokenCountUtil.formatTokenCount(task.tokens), TASK_COLUMN_WIDTHS.tokens),
        task.name,
      ].join(''));
    }
  }

  const settledTaskCount = progress.tasks.length - listedTasks.length;
  if (settledTaskCount > 0) lines.push(`(${settledTaskCount} delivered or abandoned rows not shown; --full lists them)`);

  const newestFirst  = logNewestFirst(wordedLog);
  const recentLog    = showsEverything ? newestFirst : newestFirst.slice(0, HUMAN_LOG_ENTRY_COUNT);
  const distinctDays = new Set(wordedLog.map((entry) => entry.at.slice(0, LIMITS.CALENDAR_DATE_LENGTH)));
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
  const board           = boardForReading(progress, listing.tickets);

  reportIgnoredTicketFiles(context, listing.malformed);

  const showsEverything = commandArguments.flag('full');
  const asJson          = showsEverything ? fullDocumentOf(progress, wordedLog, board) : workingDocumentOf(progress, wordedLog, board);
  printEntityThenNextLine(commandArguments, context, asJson, renderHumanStatus(progress, wordedLog, board, showsEverything), nextLineFor(board));
  return Promise.resolve();
};
