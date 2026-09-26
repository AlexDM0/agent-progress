/** Whether one parsed log.jsonl line is a well-formed record of a known kind, and if not, the reason naming the offending field. */
import type { LogRecord }            from '../../../lib/tracker-model/@types/LogRecord.ts';
import { DISPATCHER_STATES }         from '../../../lib/tracker-model/constants/DispatcherStates.ts';
import { FIRST_REPEAT_REVIEW_ROUND } from '../../../lib/tracker-model/constants/ReviewRounds.ts';
import { TICKET_PRIORITIES }         from '../../../lib/tracker-model/constants/TicketFields.ts';
import { BoardSettingsUtil }         from '../../../lib/tracker-model/utils/BoardSettingsUtil.ts';
import { VocabularyUtil }            from '../../../lib/tracker-model/utils/VocabularyUtil.ts';

type UnknownObject = Record<string, unknown>;

type KindCheck = (fields: UnknownObject, record: UnknownObject) => string | null;

const AGENT_STOPPED_COUNT_FIELDS = ['apiCallCount', 'endContextTokens', 'totalInputTokens', 'cacheReadInputTokens', 'outputTokens'] as const;

function valueIsAnObject(value: unknown): value is UnknownObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function wholeNumberIsAtLeast(value: unknown, lowest: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= lowest;
}

function textFieldProblem(fields: UnknownObject, field: string): string | null {
  return typeof fields[field] === 'string' ? null : `fields.${field} is not a string`;
}

function ticketIdProblem(record: UnknownObject): string | null {
  return typeof record['ticketId'] === 'string' ? null : 'ticketId is not a string';
}

/** The same rule as a task's own `id`, so every id a row can hold is one a review-bar record can name. */
function taskIdProblem(record: UnknownObject): string | null {
  const { taskId } = record;
  return typeof taskId === 'number' && Number.isSafeInteger(taskId) ? null : 'taskId is not a whole number';
}

function countIsWellFormed(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function priorityProblem(fields: UnknownObject, field: 'from' | 'to'): string | null {
  const priority = fields[field];
  if (typeof priority === 'string' && VocabularyUtil.ticketPriorityIsKnown(priority)) return null;
  return `fields.${field} is ${JSON.stringify(priority)}, which is not one of ${TICKET_PRIORITIES.join(', ')}`;
}

function agentPairProblem(fields: UnknownObject, field: 'from' | 'to'): string | null {
  const agentPair = fields[field];
  if (!valueIsAnObject(agentPair)) return `fields.${field} is not an object`;
  const { model, effort } = agentPair;
  if (typeof model !== 'string' || !VocabularyUtil.agentModelIsKnown(model)) return `fields.${field}.model is ${JSON.stringify(model)}, which is not a known model`;
  if (typeof effort !== 'string' || !VocabularyUtil.agentEffortIsKnown(effort)) return `fields.${field}.effort is ${JSON.stringify(effort)}, which is not a known effort`;
  return null;
}

function firstProblemOf(...problems: readonly (string | null)[]): string | null {
  return problems.find((problem) => problem !== null) ?? null;
}

function noteProblem(fields: UnknownObject): string | null {
  return textFieldProblem(fields, 'text');
}

function ticketOnlyProblem(_fields: UnknownObject, record: UnknownObject): string | null {
  return ticketIdProblem(record);
}

function ticketFiledProblem(fields: UnknownObject, record: UnknownObject): string | null {
  return firstProblemOf(ticketIdProblem(record), textFieldProblem(fields, 'title'));
}

function ticketWithReasonProblem(fields: UnknownObject, record: UnknownObject): string | null {
  return firstProblemOf(ticketIdProblem(record), textFieldProblem(fields, 'reason'));
}

function ticketRereviewedProblem(fields: UnknownObject, record: UnknownObject): string | null {
  const roundProblem = wholeNumberIsAtLeast(fields['round'], FIRST_REPEAT_REVIEW_ROUND) ? null : `fields.round is not a whole round of at least ${FIRST_REPEAT_REVIEW_ROUND}`;
  return firstProblemOf(ticketIdProblem(record), roundProblem);
}

function ticketPriorityChangedProblem(fields: UnknownObject, record: UnknownObject): string | null {
  return firstProblemOf(ticketIdProblem(record), priorityProblem(fields, 'from'), priorityProblem(fields, 'to'));
}

function ticketDependenciesSetProblem(fields: UnknownObject, record: UnknownObject): string | null {
  const { dependsOn } = fields;
  const dependenciesAreTicketIds = Array.isArray(dependsOn) && dependsOn.every((dependency) => typeof dependency === 'string');
  return firstProblemOf(ticketIdProblem(record), dependenciesAreTicketIds ? null : 'fields.dependsOn is not a list of ticket ids');
}

function ticketAgentsChangedProblem(fields: UnknownObject, record: UnknownObject): string | null {
  return firstProblemOf(ticketIdProblem(record), agentPairProblem(fields, 'from'), agentPairProblem(fields, 'to'));
}

function reviewBarProblem(fields: UnknownObject, record: UnknownObject): string | null {
  return firstProblemOf(taskIdProblem(record), ticketIdProblem(record), textFieldProblem(fields, 'name'));
}

function chartRangeSetProblem(fields: UnknownObject): string | null {
  return BoardSettingsUtil.viewRangeIsWellFormed(fields['view']) ? null : 'fields.view is not a chart range';
}

function concurrencyLimitSetProblem(fields: UnknownObject): string | null {
  return BoardSettingsUtil.concurrencyLimitIsWellFormed(fields['limit']) ? null : 'fields.limit is not a whole number of agents';
}

function dispatcherSetProblem(fields: UnknownObject): string | null {
  const { state, runId } = fields;
  if (!BoardSettingsUtil.dispatcherStateIsKnown(state)) return `fields.state is ${JSON.stringify(state)}, which is not one of ${DISPATCHER_STATES.join(', ')}`;
  return runId === null || BoardSettingsUtil.dispatcherRunIdIsWellFormed(runId) ? null : 'fields.runId is neither null nor a run id';
}

function trackerClearedProblem(): null {
  return null;
}

function agentStoppedProblem(fields: UnknownObject): string | null {
  return firstProblemOf(
    textFieldProblem(fields, 'agentId'),
    textFieldProblem(fields, 'agentType'),
    ...AGENT_STOPPED_COUNT_FIELDS.map((field) => (countIsWellFormed(fields[field]) ? null : `fields.${field} is not a whole number of at least 0`)),
  );
}

const CHECK_FOR_KIND: Readonly<Record<LogRecord['kind'], KindCheck>> = {
  'note':                    noteProblem,
  'ticket-filed':            ticketFiledProblem,
  'ticket-reopened':         ticketOnlyProblem,
  'ticket-started':          ticketOnlyProblem,
  'ticket-finished':         ticketOnlyProblem,
  'ticket-approved':         ticketOnlyProblem,
  'ticket-delivered':        ticketOnlyProblem,
  'ticket-abandoned':        ticketWithReasonProblem,
  'ticket-rereviewed':       ticketRereviewedProblem,
  'ticket-priority-changed': ticketPriorityChangedProblem,
  'ticket-dependencies-set': ticketDependenciesSetProblem,
  'ticket-agents-changed':   ticketAgentsChangedProblem,
  'ticket-held':             ticketWithReasonProblem,
  'ticket-unheld':           ticketOnlyProblem,
  'review-bar-started':      reviewBarProblem,
  'review-bar-closed':       reviewBarProblem,
  'chart-range-set':         chartRangeSetProblem,
  'concurrency-limit-set':   concurrencyLimitSetProblem,
  'dispatcher-set':          dispatcherSetProblem,
  'tracker-cleared':         trackerClearedProblem,
  'agent-stopped':           agentStoppedProblem,
};

function kindIsKnown(kind: unknown): kind is LogRecord['kind'] {
  return typeof kind === 'string' && Object.hasOwn(CHECK_FOR_KIND, kind);
}

function recordProblemOf(value: unknown): string | null {
  if (!valueIsAnObject(value)) return 'it is not an object';
  if (typeof value['at'] !== 'string') return 'at is not a string';
  const { kind } = value;
  if (!kindIsKnown(kind)) return `kind is ${JSON.stringify(kind)}, which is not a kind of log record`;
  const { fields } = value;
  if (!valueIsAnObject(fields)) return 'fields is not an object';
  return CHECK_FOR_KIND[kind](fields, value);
}

export const LogRecordValidationUtil = { recordProblemOf } as const;
