import { TicketPhraseUtil }   from '../../src/adapters/utils/TicketPhraseUtil.ts';
import type { OverseerState } from '../../src/lib/tracker-model/@types/TrackerProgress.ts';
import type { Board }         from '../../src/lib/tracker-model/Board.ts';

const READY_TICKETS_LISTED_AT_MOST = 5;

interface BoardCapacity {
  limit:          number;
  agentsInFlight: number;
  freeSlots:      number;
  readyTicketIds: readonly string[];
  heldTicketIds:  readonly string[];
  overseerState:  OverseerState;
}

/** A running Overseer needs no advice; only a pause, which starts no new job, does. */
function overseerAdviceOf(capacity: BoardCapacity): string {
  return capacity.overseerState === 'paused' ? '; Overseer paused: wait for the user\'s go' : '';
}

function slotsTextOf(capacity: BoardCapacity): string {
  if (capacity.freeSlots === 0) return `no slot free (${capacity.agentsInFlight} ${capacity.agentsInFlight === 1 ? 'agent' : 'agents'} in flight)`;
  return `${capacity.freeSlots} of ${capacity.limit} slots free`;
}

/** The ids are printed as given, in the dispatch order `readyTicketIdsOf` already sorts them into; only the first five are named. */
function ticketListTextOf(ticketIds: readonly string[]): string {
  const named    = TicketPhraseUtil.ticketReferencesText(ticketIds.slice(0, READY_TICKETS_LISTED_AT_MOST));
  const leftOver = ticketIds.length - READY_TICKETS_LISTED_AT_MOST;
  return leftOver > 0 ? `${named} and ${leftOver} more` : named;
}

function readyTextOf(startableTicketIds: readonly string[]): string {
  return startableTicketIds.length === 0 ? 'nothing ready' : `ready: ${ticketListTextOf(startableTicketIds)}`;
}

/** Only a ready ticket is named as held: the line speaks of what could be started, and a held ticket in progress or review is not that. */
function heldTextOf(heldReadyTicketIds: readonly string[]): string {
  return heldReadyTicketIds.length === 0 ? '' : `; held: ${ticketListTextOf(heldReadyTicketIds)}`;
}

/** The last line a human-facing command prints, so an orchestrator is told after every move whether a slot and a ticket are both waiting. */
function composeNextLine(capacity: BoardCapacity): string {
  const startableTicketIds = capacity.readyTicketIds.filter((ticketId) => !capacity.heldTicketIds.includes(ticketId));
  const heldReadyTicketIds = capacity.readyTicketIds.filter((ticketId) => capacity.heldTicketIds.includes(ticketId));
  return `Next: ${slotsTextOf(capacity)}; ${readyTextOf(startableTicketIds)}${heldTextOf(heldReadyTicketIds)}${overseerAdviceOf(capacity)}`;
}

/** Read from the Board's own dispatch capacity and ready entries, so the line and `status --json` cannot disagree on a slot or a ticket. */
function nextLineOf(board: Board): string {
  return composeNextLine(board.dispatchCapacity());
}

export const NextLineUtil = { composeNextLine, nextLineOf } as const;
