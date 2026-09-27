/** The Kanban tab's lane rules: which lane a ticket's card sits in and the order within a lane. DOM-free, and reads no clock. */

import type { DisplayState }     from '../../../src/lib/tracker-model/@types/Task.ts';
import type { TicketPriority }   from '../../../src/lib/tracker-model/@types/Ticket.ts';
import { TicketDefaultsUtil }    from '../../../src/lib/tracker-model/utils/TicketDefaultsUtil.ts';
import type { PageTicket }       from '../../../src/shared/@types/PagePayload.ts';
import type { KanbanCard }       from '../../@types/KanbanCard.ts';
import type { BoardTicket }      from '../../@types/PageBoard.ts';
import { TimeUtil }              from '../../utils/TimeUtil.ts';
import type { KanbanLane }       from '../@types/KanbanLane.ts';
import type { ClosedKanbanLane } from '../constants/KanbanBoardLayout.ts';
import { CLOSED_KANBAN_LANES }   from '../constants/KanbanBoardLayout.ts';

/** A card's lane is the pill its ticket's own row shows on the Progress tab. */
const LANE_FOR_DISPLAY_STATE: Record<DisplayState, KanbanLane> = {
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

function laneOfState(state: DisplayState): KanbanLane {
  return LANE_FOR_DISPLAY_STATE[state];
}

function kanbanCardsFor(tickets: readonly BoardTicket[], waitingOnById: ReadonlyMap<string, readonly string[]>): KanbanCard[] {
  return tickets.map((ticket) => ({
    ticket,
    ownRow:     ticket.ownRow,
    state:      ticket.displayState,
    reviewBars: ticket.reviewBars,
    waitingOn:  waitingOnById.get(ticket.id) ?? [],
  }));
}

function laneIsClosed(lane: KanbanLane): lane is ClosedKanbanLane {
  return CLOSED_KANBAN_LANES.some((closedLane) => closedLane === lane);
}

function laneMixesStates(lane: KanbanLane): boolean {
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

function priorityRankOf(card: KanbanCard): number {
  return PRIORITY_ORDER[TicketDefaultsUtil.ticketPriorityOf(card.ticket)];
}

/** Every card of the band a card waits on, directly or through a chain, itself included when it sits on a cycle. */
function reachableDependenciesOf(card: KanbanCard, bandById: ReadonlyMap<number, KanbanCard>): Set<KanbanCard> {
  const reached = new Set<KanbanCard>();
  const toVisit = [card];
  for (let current = toVisit.pop(); current !== undefined; current = toVisit.pop()) {
    for (const dependencyId of current.waitingOn) {
      const dependency = bandById.get(Number(dependencyId));
      if (dependency !== undefined && !reached.has(dependency)) {
        reached.add(dependency);
        toVisit.push(dependency);
      }
    }
  }
  return reached;
}

/**
 * One priority band of To Do: the cards waiting on nothing by id, then the waiting cards, each after every card of the band it reaches, ties by
 * id. A card is next once every unplaced card it reaches reaches it back, which on a cycle lets its members out in id order.
 */
function dependencyOrderOf(band: readonly KanbanCard[]): KanbanCard[] {
  const byId = (a: KanbanCard, b: KanbanCard): number => idNumberOf(a) - idNumberOf(b);
  const bandById = new Map(band.map((card) => [idNumberOf(card), card]));
  const reachableByCard = new Map(band.map((card) => [card, reachableDependenciesOf(card, bandById)]));
  const reaches = (from: KanbanCard, to: KanbanCard): boolean => reachableByCard.get(from)?.has(to) ?? false;
  const ordered = band.filter((card) => card.waitingOn.length === 0).toSorted(byId);
  let unplaced = band.filter((card) => card.waitingOn.length > 0).toSorted(byId);
  while (unplaced.length > 0) {
    const next = unplaced.find((card) => unplaced.every((other) => other === card || !reaches(card, other) || reaches(other, card))) ?? unplaced[0];
    if (next === undefined) {
      break;
    }
    ordered.push(next);
    unplaced = unplaced.filter((card) => card !== next);
  }
  return ordered;
}

/**
 * Open lanes run high → normal → low, then by id as a number, except that To Do orders each band by what its cards wait on; the closed lanes
 * newest first by their closing stamp, a tie to the higher id.
 */
function cardsInLane(cards: readonly KanbanCard[], lane: KanbanLane): KanbanCard[] {
  const members = cards.filter((card) => laneOfState(card.state) === lane);
  if (laneIsClosed(lane)) {
    // Sorting by closing stamp is a stated clock exception that decides only the order the cards are shown in.
    return members.toSorted((a, b) => {
      const newerFirst = epochMillisecondsOrOldest(closingStampOf(b.ticket, lane)) - epochMillisecondsOrOldest(closingStampOf(a.ticket, lane));
      return (Number.isNaN(newerFirst) ? 0 : newerFirst) || idNumberOf(b) - idNumberOf(a);
    });
  }
  const byPriorityThenId = members.toSorted((a, b) => priorityRankOf(a) - priorityRankOf(b) || idNumberOf(a) - idNumberOf(b));
  if (lane !== 'todo') {
    return byPriorityThenId;
  }
  const bandRanks = [...new Set(byPriorityThenId.map((card) => priorityRankOf(card)))];
  return bandRanks.flatMap((rank) => dependencyOrderOf(byPriorityThenId.filter((card) => priorityRankOf(card) === rank)));
}

function laneIsDividedByPriority(lane: KanbanLane, members: readonly KanbanCard[]): boolean {
  return !laneIsClosed(lane) && new Set(members.map((card) => TicketDefaultsUtil.ticketPriorityOf(card.ticket))).size > 1;
}

const OVERFLOW_TOLERANCE_PIXELS = 1;

/** `start`, `end`, both space-separated, or `null` when the board fits: the directions the board can still scroll. */
function overflowDirectionsOf(scrollLeft: number, scrollWidth: number, clientWidth: number): string | null {
  const scrollableWidth = scrollWidth - clientWidth;
  const directions      = [
    ...scrollLeft > OVERFLOW_TOLERANCE_PIXELS ? ['start'] : [],
    ...scrollLeft < scrollableWidth - OVERFLOW_TOLERANCE_PIXELS ? ['end'] : [],
  ];
  return directions.length === 0 ? null : directions.join(' ');
}

export const KanbanLaneUtil = {
  laneOfState,
  overflowDirectionsOf,
  kanbanCardsFor,
  laneIsClosed,
  laneMixesStates,
  cardsInLane,
  laneIsDividedByPriority,
} as const;
