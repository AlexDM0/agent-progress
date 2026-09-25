/** The Kanban tab's lane rules: which lane a ticket's card sits in and the order within a lane. DOM-free, and reads no clock. */

import type { Task }                         from '../../src/lib/tracker-model/@types/Task.ts';
import type { TicketPriority }               from '../../src/lib/tracker-model/@types/Ticket.ts';
import { TicketDefaultsUtil }                from '../../src/lib/tracker-model/utils/TicketDefaultsUtil.ts';
import type { PageTicket }                   from '../../src/shared/@types/PagePayload.ts';
import type { KanbanCard }                   from '../@types/KanbanCard.ts';
import type { ClosedKanbanLane, KanbanLane } from '../constants/KanbanLane.ts';
import type { RowState }                     from '../constants/RowState.ts';
import { BoardRulesUtil }                    from '../utils/BoardRulesUtil.ts';
import { TimeUtil }                          from '../utils/TimeUtil.ts';

/** A card's lane is the pill its ticket's own row shows on the Progress tab. */
const LANE_FOR_ROW_STATE: Record<RowState, KanbanLane> = {
  'pending':     'todo',
  'in-progress': 'progress',
  'paused':      'progress',
  'in-review':   'review',
  'reviewing':   'review',
  're-review':   'review',
  'reviewed':    'merge',
  'delivered':   'done',
  'abandoned':   'abandoned',
};

const PRIORITY_ORDER: Record<TicketPriority, number> = { high: 0, normal: 1, low: 2 };

/** A ticket with no row reads the pill a row in its own status would show. */
function cardStateFor(ticket: PageTicket, ownRow: Task | null): RowState {
  return BoardRulesUtil.rowStateFor(ownRow ?? { status: ticket.status }, ticket.status);
}

export function laneOfState(state: RowState): KanbanLane {
  return LANE_FOR_ROW_STATE[state];
}

export function kanbanCardsFor(tickets: readonly PageTicket[], tasks: readonly Task[], waitingOnById: ReadonlyMap<string, readonly string[]>): KanbanCard[] {
  return tickets.map((ticket) => {
    const ownRow = BoardRulesUtil.ownRowOf(ticket.id, tasks);
    return {
      ticket,
      ownRow,
      state:     cardStateFor(ticket, ownRow),
      waitingOn: waitingOnById.get(ticket.id) ?? [],
    };
  });
}

export function laneIsClosed(lane: KanbanLane): lane is ClosedKanbanLane {
  return lane === 'done' || lane === 'abandoned';
}

export function laneMixesStates(lane: KanbanLane): boolean {
  return lane === 'progress' || lane === 'review';
}

function closingStampOf(ticket: PageTicket, lane: ClosedKanbanLane): string | null {
  return lane === 'done' ? ticket.delivered : ticket.abandonedAt;
}

function epochMillisecondsOrOldest(stamp: string | null): number {
  return TimeUtil.epochMillisecondsOf(stamp) ?? Number.NEGATIVE_INFINITY;
}

function idNumberOf(card: KanbanCard): number {
  return Number(card.ticket.id);
}

/** Open lanes run high → normal → low, then by id as a number; the closed lanes newest first by their closing stamp, a tie to the higher id. */
export function cardsInLane(cards: readonly KanbanCard[], lane: KanbanLane): KanbanCard[] {
  const members = cards.filter((card) => laneOfState(card.state) === lane);
  if (laneIsClosed(lane)) {
    // Sorting by closing stamp is a stated clock exception that decides only the order the cards are shown in.
    return members.toSorted((a, b) => {
      const newerFirst = epochMillisecondsOrOldest(closingStampOf(b.ticket, lane)) - epochMillisecondsOrOldest(closingStampOf(a.ticket, lane));
      return (Number.isNaN(newerFirst) ? 0 : newerFirst) || idNumberOf(b) - idNumberOf(a);
    });
  }
  return members.toSorted((a, b) => {
    const priorityDifference = PRIORITY_ORDER[TicketDefaultsUtil.ticketPriorityOf(a.ticket)] - PRIORITY_ORDER[TicketDefaultsUtil.ticketPriorityOf(b.ticket)];
    return priorityDifference || idNumberOf(a) - idNumberOf(b);
  });
}

export function laneIsDividedByPriority(lane: KanbanLane, members: readonly KanbanCard[]): boolean {
  return !laneIsClosed(lane) && new Set(members.map((card) => TicketDefaultsUtil.ticketPriorityOf(card.ticket))).size > 1;
}
