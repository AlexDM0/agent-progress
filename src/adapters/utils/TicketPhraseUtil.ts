/** The phrases a worded Board refusal or log sentence shares with the ticket command's own lines, so each reads the same everywhere. */
import type { AgentPair }    from '../../lib/tracker-model/@types/Ticket.ts';
import { StatusWordingUtil } from './StatusWordingUtil.ts';

function ticketReferencesText(ticketIds: readonly string[]): string {
  return ticketIds.map((ticketId) => `#${ticketId}`).join(', ');
}

function waitingOnText(ticketIds: readonly string[]): string {
  return `waiting on ${ticketReferencesText(ticketIds)}`;
}

function lowPriorityHeldBackText(ticketId: string, holdingBackTicketIds: readonly string[]): string {
  const { priorityWordFor, statusWordFor } = StatusWordingUtil;
  return `Ticket #${ticketId} is ${priorityWordFor('low')} priority, and ${ticketReferencesText(holdingBackTicketIds)} `
    + `${holdingBackTicketIds.length === 1 ? 'is' : 'are'} ${priorityWordFor('normal')} or ${priorityWordFor('high')} `
    + `and not ${statusWordFor('delivered')} or ${statusWordFor('abandoned')} yet`;
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
  lowPriorityHeldBackText,
  namedTicketsText,
  ticketReferencesText,
  waitingOnText,
} as const;
