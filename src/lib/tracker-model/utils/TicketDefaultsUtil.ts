/** What a ticket's optional fields read as when its file does not carry them. */
import type { AgentEffort, AgentModel, TicketPriority } from '../@types/Ticket.ts';
import { DEFAULT_AGENT_EFFORT, DEFAULT_AGENT_MODEL }    from '../constants/AgentSettings.ts';
import { DEFAULT_TICKET_PRIORITY }                      from '../constants/TicketFields.ts';

function ticketPriorityOf(ticket: { priority?: TicketPriority }): TicketPriority {
  return ticket.priority ?? DEFAULT_TICKET_PRIORITY;
}

function agentModelOf(ticket: { model?: AgentModel }): AgentModel {
  return ticket.model ?? DEFAULT_AGENT_MODEL;
}

function agentEffortOf(ticket: { effort?: AgentEffort }): AgentEffort {
  return ticket.effort ?? DEFAULT_AGENT_EFFORT;
}

export const TicketDefaultsUtil = {
  ticketPriorityOf,
  agentModelOf,
  agentEffortOf,
} as const;
