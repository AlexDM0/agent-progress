/** The two `status --json` documents: the working view an agent opens a session with, and the full one `--full` prints. */
import { ProgressFileMappingUtil } from '../../../src/adapters/progress/utils/ProgressFileMappingUtil.ts';
import { StatusDocumentUtil }      from '../../../src/adapters/utils/StatusDocumentUtil.ts';
import { TicketJsonUtil }          from '../../../src/adapters/utils/TicketJsonUtil.ts';
import type { Task }               from '../../../src/lib/tracker-model/@types/Task.ts';
import type { ReadyTicket }        from '../../../src/lib/tracker-model/@types/Ticket.ts';
import type { TrackerProgress }    from '../../../src/lib/tracker-model/@types/TrackerProgress.ts';
import type { Board }              from '../../../src/lib/tracker-model/Board.ts';
import type { WordedLogEntry }     from '../../../src/shared/@types/WordedLogEntry.ts';
import { ownerTokenTotalsOf }      from './OwnerTokenTotals.ts';

const WORKING_VIEW_LOG_ENTRY_COUNT = 10;

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

function selectedTasksOf(board: Board, showsTicketsOnly: boolean): readonly Readonly<Task>[] {
  return showsTicketsOnly ? board.tasks().filter((task) => board.taskIsTicketWork(task)) : board.tasks();
}

/**
 * The whole progress file plus every ticket in the version 1 document shape, with the derived `concurrency` and `readyTickets` beside it,
 * then the dispatch fields `reviewWaitingTickets`, `pausedBuilds` and `ticketRows`, and `tokensByOwner` over every row.
 */
export function fullDocumentOf(progress: TrackerProgress, wordedLog: readonly WordedLogEntry[], board: Board, showsTicketsOnly: boolean): object {
  const progressDocument = ProgressFileMappingUtil.wordedDocumentOf(progress, wordedLog);
  return {
    ...(showsTicketsOnly ? { ...progressDocument, tasks: selectedTasksOf(board, true) } : progressDocument),
    tickets:       board.tickets().map(TicketJsonUtil.ticketDocumentOf),
    ...derivedDocumentOf(board),
    ...StatusDocumentUtil.boardWorkOf(board, board.tickets()),
    tokensByOwner: ownerTokenTotalsOf(progress.tasks),
  };
}

/** What an agent opening a session needs: unsettled rows and tickets, the recent log newest first, and counts of what was left out. */
export function workingDocumentOf(progress: TrackerProgress, logNewestFirst: readonly WordedLogEntry[], board: Board, showsTicketsOnly: boolean): object {
  const tickets          = board.tickets();
  const selectedTasks    = selectedTasksOf(board, showsTicketsOnly);
  const unsettledTasks   = selectedTasks.filter((task) => !board.taskIsSettled(task));
  const unsettledTickets = tickets.filter((ticket) => !board.ticketIsSettled(ticket));
  const recentLog        = logNewestFirst.slice(0, WORKING_VIEW_LOG_ENTRY_COUNT);
  return {
    ...ProgressFileMappingUtil.wordedDocumentOf(progress, recentLog),
    tasks:   unsettledTasks,
    tickets: unsettledTickets.map(TicketJsonUtil.ticketDocumentOf),
    ...derivedDocumentOf(board),
    omitted: {
      settledTasks:    selectedTasks.length - unsettledTasks.length,
      settledTickets:  tickets.length - unsettledTickets.length,
      olderLogEntries: logNewestFirst.length - recentLog.length,
      ...(showsTicketsOnly ? { freeStandingTasks: progress.tasks.length - selectedTasks.length } : {}),
    },
    ...StatusDocumentUtil.boardWorkOf(board, unsettledTickets),
    tokensByOwner: ownerTokenTotalsOf(progress.tasks),
  };
}
