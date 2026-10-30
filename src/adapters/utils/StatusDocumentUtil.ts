/** Maps the Board's answers into the fields `status --json` carries for the Overseer and an orchestrator, the ticket defaults resolved. */
import type { Task }          from '../../lib/tracker-model/@types/Task.ts';
import type { Ticket }        from '../../lib/tracker-model/@types/Ticket.ts';
import type { Board }         from '../../lib/tracker-model/Board.ts';
import { TicketDefaultsUtil } from '../../lib/tracker-model/utils/TicketDefaultsUtil.ts';
import type {
  InProgressIds,
  PausedBuildEntry,
  ReviewBarEntry,
  StatusBoardWork,
  StatusDecisionsAndIncidents,
  StatusJobs,
  TicketRowEntry,
  TicketRowsEntry
}                             from '../@types/StatusDocumentFields.ts';

function inProgressIdsOf(board: Board): InProgressIds {
  return { inProgressTicketIds: board.inProgressTicketIds(), inProgressReviewOfIds: board.inProgressReviewOfIds() };
}

function pausedBuildsOf(board: Board): PausedBuildEntry[] {
  return board.pausedBuildTickets().flatMap(({ frontmatter }) => {
    const pausedRow = board.pausedBuildRowOf(frontmatter.id);
    if (pausedRow === null) return [];
    return [{
      id:       frontmatter.id,
      note:     pausedRow.note,
      priority: TicketDefaultsUtil.ticketPriorityOf(frontmatter),
      model:    TicketDefaultsUtil.agentModelOf(frontmatter),
      effort:   TicketDefaultsUtil.agentEffortOf(frontmatter),
    }];
  });
}

function ticketRowEntryOf(row: Readonly<Task> | null): TicketRowEntry | null {
  if (row === null) return null;
  return { id: row.id, status: row.status, note: row.note };
}

function reviewBarEntryOf(bar: Readonly<Task>): ReviewBarEntry {
  return { id: bar.id, status: bar.status, ...(bar.reviewBarRound === undefined ? {} : { round: bar.reviewBarRound }) };
}

function ticketRowsEntryOf(board: Board, ticketId: string): TicketRowsEntry {
  return { id: ticketId, row: ticketRowEntryOf(board.linkedRowOf(ticketId)), reviewBars: board.reviewRowsOf(ticketId).map(reviewBarEntryOf) };
}

/** `ticketRows` covers the tickets listed, in their order, so the working view describes only the tickets it prints. */
function boardWorkOf(board: Board, listedTickets: readonly Readonly<Ticket>[]): StatusBoardWork {
  return {
    reviewWaitingTickets: board.reviewWaitingTickets().map(({ frontmatter }) => ({
      id:     frontmatter.id,
      model:  TicketDefaultsUtil.agentModelOf(frontmatter),
      effort: TicketDefaultsUtil.agentEffortOf(frontmatter),
    })),
    pausedBuilds: pausedBuildsOf(board),
    ticketRows:   listedTickets.map((ticket) => ticketRowsEntryOf(board, ticket.frontmatter.id)),
  };
}

/** Carried by both documents, empty on a tracker that launched none, so a reader never has to tell an absent list from an empty one. */
function jobsOf(board: Board): StatusJobs {
  return { jobs: board.jobs() };
}

/** Carried by both documents, each empty when none is open, as `jobsOf`. */
function decisionsAndIncidentsOf(board: Board): StatusDecisionsAndIncidents {
  return { decisions: board.decisions(), incidents: board.incidents() };
}

export const StatusDocumentUtil = {
  inProgressIdsOf,
  boardWorkOf,
  jobsOf,
  decisionsAndIncidentsOf,
} as const;
