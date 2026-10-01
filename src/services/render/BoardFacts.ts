/** Maps a Board to the progress island's `boardFacts`, one Board query per fact, with every row named by its position in `board.tasks()`. */
import type { Task }                                          from '../../lib/tracker-model/@types/Task.ts';
import type { Board }                                         from '../../lib/tracker-model/Board.ts';
import type { PageBoardFacts, PageRowFacts, PageTicketFacts } from '../../shared/@types/PagePayload.ts';

type RowPositions = ReadonlyMap<Readonly<Task>, number>;

function positionOf(row: Readonly<Task> | null, rowPositions: RowPositions): number | null {
  if (row === null) return null;
  return rowPositions.get(row) ?? null;
}

/** Which rows are bars is the Board's to decide; the stored `reviewOf` values only list the tickets to ask about. */
function ownRowPositionByReviewBar(board: Board, rowPositions: RowPositions): Map<Readonly<Task>, number | null> {
  const reviewedTicketIds    = new Set(board.tasks().flatMap((task) => task.reviewOf ?? []));
  const ownRowPositionByBar = new Map<Readonly<Task>, number | null>();
  for (const ticketId of reviewedTicketIds) {
    const ownRowPosition = positionOf(board.ownRowOf(ticketId), rowPositions);
    for (const bar of board.reviewBarsOf(ticketId)) ownRowPositionByBar.set(bar, ownRowPosition);
  }
  return ownRowPositionByBar;
}

export function boardFactsOf(board: Board): PageBoardFacts {
  const rowPositions        = new Map(board.tasks().map((task, position) => [task, position] as const));
  const ownRowPositionByBar = ownRowPositionByReviewBar(board, rowPositions);

  const rows = board.tasks().map((task): PageRowFacts => ({
    displayState:                   board.rowDisplayStateOf(task),
    deliveredRowCountsAsReviewed:   board.deliveredRowCountsAsReviewed(task),
    ownRowPositionOfReviewedTicket: ownRowPositionByBar.get(task) ?? null,
  }));

  const tickets = board.tickets().map((ticket): PageTicketFacts => ({
    ticketId:           ticket.frontmatter.id,
    ownRowPosition:     positionOf(board.ownRowOf(ticket.frontmatter.id), rowPositions),
    reviewBarPositions: board.reviewBarsOf(ticket.frontmatter.id).flatMap((bar) => positionOf(bar, rowPositions) ?? []),
    displayState:       board.ticketDisplayStateOf(ticket),
    waitingOnTicketIds: board.waitingOnOf(ticket),
  }));

  return { rows, tickets, epics: board.epicRollups() };
}
