import {
  CALENDAR_DATE_LENGTH,
  CLOCK_SLICE_END,
  CLOCK_SLICE_START,
  DATE_AND_CLOCK_LENGTH,
  MONTH_AND_DAY_SLICE_START
}                                            from '../../lib/constants/Limits';
import {
  SETTLED_TASK_STATUSES,
  SETTLED_TICKET_STATUSES,
  TASK_STATUSES,
  TICKET_STATUSES
}                                          from '../../lib/constants/Statuses';
import type {
  LogEntry,
  ProgressFile,
  Task,
  Ticket
}                                            from '../../lib/constants/Types';
import { requireWorkspace } from '../../lib/platform/Workspace';
import { listTickets }      from '../../lib/tickets/TicketStore';
import { TimeUtil }         from '../../lib/utils/TimeUtil';
import { TokenCountUtil }   from '../../lib/utils/TokenCountUtil';
import {
  concurrencyDocumentOf,
  nextLineFor,
  padColumn,
  printEntityThenNextLine,
  readyTicketsOf,
  requireProgressFile,
  ticketDocumentOf,
  type ReadyTicket
}                                                                      from '../CommandSupport';
import type { CommandHandler } from '../CommandTable';

const USAGE = 'agent-progress status [--json] [--full]';

const KNOWN_OPTION_NAMES = ['json', 'full'];

const HUMAN_LOG_ENTRY_COUNT = 5;

const WORKING_VIEW_LOG_ENTRY_COUNT = 10;

const TASK_COLUMN_WIDTHS = {
  identifier: 5,
  status:     11,
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
function logNewestFirst(log: readonly LogEntry[]): LogEntry[] {
  const dated = log.map((entry, appendedIndex) => ({
    entry,
    appendedIndex,
    epochMilliseconds: TimeUtil.parseIso(entry.at)?.getTime() ?? Number.NEGATIVE_INFINITY,
  }));
  dated.sort((a, b) => b.epochMilliseconds - a.epochMilliseconds || b.appendedIndex - a.appendedIndex);
  return dated.map((datedEntry) => datedEntry.entry);
}

function logStampOf(entry: LogEntry, showsTheDate: boolean): string {
  const start = showsTheDate ? MONTH_AND_DAY_SLICE_START : CLOCK_SLICE_START;
  return entry.at.slice(start, CLOCK_SLICE_END).replace('T', ' ');
}

/** `null` when no row reported a usage, which is a different answer from `0`. */
function totalTokensOf(tasks: readonly Task[]): number | null {
  const reported = tasks.filter((task) => task.tokens !== null);
  if (reported.length === 0) return null;
  return reported.reduce((running, task) => running + (task.tokens ?? 0), 0);
}

function taskIsSettled(task: Task): boolean {
  return SETTLED_TASK_STATUSES.includes(task.status);
}

function ticketIsSettled(ticket: Ticket): boolean {
  return SETTLED_TICKET_STATUSES.includes(ticket.frontmatter.status);
}

/**
 * The stored run id rides in `concurrency` beside the state it belongs to, so the orchestrator finds the run to resume where it reads the
 * state; `readyTickets` is built from the same `readyTicketIds`.
 */
function derivedDocumentOf(progress: ProgressFile, tickets: readonly Ticket[]): { concurrency: object; readyTickets: ReadyTicket[] } {
  const concurrency = concurrencyDocumentOf(progress, tickets);
  return {
    concurrency:  progress.dispatcherRunId === undefined ? concurrency : { ...concurrency, dispatcherRunId: progress.dispatcherRunId },
    readyTickets: readyTicketsOf(concurrency.readyTicketIds, tickets),
  };
}

/** The whole progress file plus every ticket: a document an agent could write back, with the derived `concurrency` and `readyTickets` beside it. */
function fullDocumentOf(progress: ProgressFile, tickets: readonly Ticket[]): object {
  return { ...progress, tickets: tickets.map(ticketDocumentOf), ...derivedDocumentOf(progress, tickets) };
}

/** What an agent opening a session needs: unsettled rows and tickets, the recent log newest first, and counts of what was left out. */
function workingDocumentOf(progress: ProgressFile, tickets: readonly Ticket[]): object {
  const unsettledTasks   = progress.tasks.filter((task) => !taskIsSettled(task));
  const unsettledTickets = tickets.filter((ticket) => !ticketIsSettled(ticket));
  const recentLog        = logNewestFirst(progress.log).slice(0, WORKING_VIEW_LOG_ENTRY_COUNT);
  return {
    ...progress,
    tasks:   unsettledTasks,
    tickets: unsettledTickets.map(ticketDocumentOf),
    log:     recentLog,
    ...derivedDocumentOf(progress, tickets),
    omitted: {
      settledTasks:    progress.tasks.length - unsettledTasks.length,
      settledTickets:  tickets.length - unsettledTickets.length,
      olderLogEntries: progress.log.length - recentLog.length,
    },
  };
}

function renderHumanStatus(progress: ProgressFile, tickets: readonly Ticket[], showsEverything: boolean): string {
  const lines = [
    `${progress.project} — started ${progress.startedAt.slice(0, DATE_AND_CLOCK_LENGTH).replace('T', ' ')}`,
    `Tasks:   ${countsByStatus(TASK_STATUSES, progress.tasks.map((task) => task.status))}`,
    `Tickets: ${countsByStatus(TICKET_STATUSES, tickets.map((ticket) => ticket.frontmatter.status))}`,
  ];

  const totalTokens = totalTokensOf(progress.tasks);
  if (totalTokens !== null) {
    const reportedCount = progress.tasks.filter((task) => task.tokens !== null).length;
    lines.push(`Tokens:  ${TokenCountUtil.formatTokenCount(totalTokens)} reported across ${reportedCount} of ${progress.tasks.length} rows`);
  }

  const listedTasks = showsEverything ? progress.tasks : progress.tasks.filter((task) => !taskIsSettled(task));
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

  const newestFirst  = logNewestFirst(progress.log);
  const recentLog    = showsEverything ? newestFirst : newestFirst.slice(0, HUMAN_LOG_ENTRY_COUNT);
  const distinctDays = new Set(progress.log.map((entry) => entry.at.slice(0, CALENDAR_DATE_LENGTH)));
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
  const progress  = requireProgressFile(workspace);
  const listing   = listTickets(workspace);

  for (const malformed of listing.malformed) {
    const place = malformed.line > 0 ? ` (line ${malformed.line})` : '';
    context.standardError(`Ticket file ignored: ${malformed.filePath}${place}: ${malformed.reason}`);
  }

  const showsEverything = commandArguments.flag('full');
  const asJson          = showsEverything ? fullDocumentOf(progress, listing.tickets) : workingDocumentOf(progress, listing.tickets);
  printEntityThenNextLine(commandArguments, context, asJson, renderHumanStatus(progress, listing.tickets, showsEverything), nextLineFor(progress, listing.tickets));
  return Promise.resolve();
};
