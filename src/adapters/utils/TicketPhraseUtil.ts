/** The phrases a worded Board refusal or log sentence shares with the ticket command's own lines, so each reads the same everywhere. */
import type { AgentPair } from '../../lib/tracker-model/@types/Ticket.ts';

function ticketReferencesText(ticketIds: readonly string[]): string {
  return ticketIds.map((ticketId) => `#${ticketId}`).join(', ');
}

function waitingOnText(ticketIds: readonly string[]): string {
  return `waiting on ${ticketReferencesText(ticketIds)}`;
}

/** `Ticket #003`, or `Tickets #003, #004` for more than one. */
function namedTicketsText(ticketIds: readonly string[]): string {
  return `${ticketIds.length === 1 ? 'Ticket' : 'Tickets'} ${ticketReferencesText(ticketIds)}`;
}

function agentPairText(pair: AgentPair): string {
  return `${pair.model}/${pair.effort}`;
}

export const TicketPhraseUtil = {
  agentPairText,
  namedTicketsText,
  ticketReferencesText,
  waitingOnText,
} as const;
