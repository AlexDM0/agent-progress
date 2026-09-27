/** Whether a text read from outside names a member of one of the model's vocabularies. */
import type { TaskStatus } from '../@types/Task.ts';
import type {
  AgentEffort,
  AgentModel,
  TicketPriority,
  TicketStatus,
  TicketType
} from '../@types/Ticket.ts';
import { AGENT_EFFORTS, AGENT_MODELS }     from '../constants/AgentSettings.ts';
import { TASK_STATUSES, TICKET_STATUSES }  from '../constants/Statuses.ts';
import { TICKET_PRIORITIES, TICKET_TYPES } from '../constants/TicketFields.ts';

/** A membership test, not a record lookup: `constructor` is a truthy, callable property of every object and outside text can spell it. */
function taskStatusIsKnown(text: string): text is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(text);
}

function ticketStatusIsKnown(text: string): text is TicketStatus {
  return (TICKET_STATUSES as readonly string[]).includes(text);
}

function ticketTypeIsKnown(text: string): text is TicketType {
  return (TICKET_TYPES as readonly string[]).includes(text);
}

function ticketPriorityIsKnown(text: string): text is TicketPriority {
  return (TICKET_PRIORITIES as readonly string[]).includes(text);
}

function agentModelIsKnown(text: string): text is AgentModel {
  return (AGENT_MODELS as readonly string[]).includes(text);
}

function agentEffortIsKnown(text: string): text is AgentEffort {
  return (AGENT_EFFORTS as readonly string[]).includes(text);
}

export const VocabularyUtil = {
  taskStatusIsKnown,
  ticketStatusIsKnown,
  ticketTypeIsKnown,
  ticketPriorityIsKnown,
  agentModelIsKnown,
  agentEffortIsKnown,
} as const;
