const READY_TICKETS_LISTED_AT_MOST = 5;

interface BoardCapacity {
  limit:          number;
  agentsInFlight: number;
  freeSlots:      number;
  readyTicketIds: readonly string[];
}

function slotsTextOf(capacity: BoardCapacity): string {
  if (capacity.freeSlots === 0) return `no slot free (${capacity.agentsInFlight} ${capacity.agentsInFlight === 1 ? 'agent' : 'agents'} in flight)`;
  return `${capacity.freeSlots} of ${capacity.limit} slots free`;
}

/** The ids are printed as given, in the dispatch order `readyTicketIdsOf` already sorts them into; only the first five are named. */
function readyTextOf(readyTicketIds: readonly string[]): string {
  if (readyTicketIds.length === 0) return 'nothing ready';

  const named    = readyTicketIds.slice(0, READY_TICKETS_LISTED_AT_MOST).map((identifier) => `#${identifier}`).join(', ');
  const leftOver = readyTicketIds.length - READY_TICKETS_LISTED_AT_MOST;
  return leftOver > 0 ? `ready: ${named} and ${leftOver} more` : `ready: ${named}`;
}

/** The last line a human-facing command prints, so an orchestrator is told after every move whether a slot and a ticket are both waiting. */
function composeNextLine(capacity: BoardCapacity): string {
  return `Next: ${slotsTextOf(capacity)}; ${readyTextOf(capacity.readyTicketIds)}`;
}

export const NextLineUtil = { composeNextLine } as const;
