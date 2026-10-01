import type {
  AgentEffort,
  AgentModel,
  TicketPriority,
  TicketType
} from '../../../src/lib/tracker-model/@types/Ticket.ts';
import { AGENT_EFFORTS, AGENT_MODELS }     from '../../../src/lib/tracker-model/constants/AgentSettings.ts';
import { TICKET_STATUSES }                 from '../../../src/lib/tracker-model/constants/Statuses.ts';
import { TICKET_PRIORITIES, TICKET_TYPES } from '../../../src/lib/tracker-model/constants/TicketFields.ts';
import { TicketIdUtil }                    from '../../../src/lib/tracker-model/utils/TicketIdUtil.ts';
import { VocabularyUtil }                  from '../../../src/lib/tracker-model/utils/VocabularyUtil.ts';
import { OperationRefusal }                from '../../../src/shared/OperationRefusal.ts';

const LIST_SEPARATOR_PATTERN = /[\s,]+/;

function requirePriority(writtenPriority: string): TicketPriority {
  if (!VocabularyUtil.ticketPriorityIsKnown(writtenPriority)) {
    throw new OperationRefusal('refused', `"${writtenPriority}" is not a ticket priority. The priorities are ${TICKET_PRIORITIES.join(', ')}.`);
  }
  return writtenPriority;
}

function priorityFrom(writtenPriority: string | undefined): TicketPriority | undefined {
  return writtenPriority === undefined ? undefined : requirePriority(writtenPriority);
}

function ticketTypeFrom(writtenType: string | undefined): TicketType | undefined {
  if (writtenType === undefined) return undefined;
  if (!VocabularyUtil.ticketTypeIsKnown(writtenType)) {
    throw new OperationRefusal('refused', `"${writtenType}" is not a ticket type. The types are ${TICKET_TYPES.join(', ')}.`);
  }
  return writtenType;
}

function agentModelFrom(writtenModel: string | undefined): AgentModel | undefined {
  if (writtenModel === undefined) return undefined;
  if (!VocabularyUtil.agentModelIsKnown(writtenModel)) {
    throw new OperationRefusal('refused', `"${writtenModel}" is not an agent model. The models are ${AGENT_MODELS.join(', ')}.`);
  }
  return writtenModel;
}

function agentEffortFrom(writtenEffort: string | undefined): AgentEffort | undefined {
  if (writtenEffort === undefined) return undefined;
  if (!VocabularyUtil.agentEffortIsKnown(writtenEffort)) {
    throw new OperationRefusal('refused', `"${writtenEffort}" is not an agent effort. The efforts are ${AGENT_EFFORTS.join(', ')}.`);
  }
  return writtenEffort;
}

/** The keys as written, a repeated one kept at its first place; whether each names an epic is the Board's to judge. */
function epicKeyListFrom(texts: readonly string[]): string[] {
  return [...new Set(texts.flatMap((text) => text.split(LIST_SEPARATOR_PATTERN)).filter((part) => part !== ''))];
}

function dependencyListFrom(texts: readonly string[]): string[] {
  const dependsOn: string[] = [];
  for (const reference of texts.flatMap((text) => text.split(LIST_SEPARATOR_PATTERN)).filter((part) => part !== '')) {
    const identifier = TicketIdUtil.parseTicketReference(reference);
    if (identifier === null) {
      throw new OperationRefusal('refused', `"${reference}" is not a ticket id. Write it as \`3\`, \`003\` or \`#3\`.`);
    }
    if (!dependsOn.includes(identifier)) dependsOn.push(identifier);
  }
  return dependsOn;
}

function refuseAnUnknownTicketStatus(writtenStatus: string): never {
  throw new OperationRefusal('refused', `"${writtenStatus}" is not a ticket status. The statuses are ${TICKET_STATUSES.join(', ')}.`);
}

export const TicketArgumentUtil = {
  requirePriority,
  priorityFrom,
  ticketTypeFrom,
  agentModelFrom,
  agentEffortFrom,
  dependencyListFrom,
  epicKeyListFrom,
  refuseAnUnknownTicketStatus,
} as const;
