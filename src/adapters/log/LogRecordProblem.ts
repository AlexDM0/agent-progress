/** Whether one parsed log.jsonl line is a well-formed record of a known kind, and if not, the reason naming the offending field. */
import { JsonRecordUtil }                                    from '../../lib/json-record/JsonRecordUtil.ts';
import type { LogRecordKind }                                from '../../lib/tracker-model/@types/LogRecord.ts';
import { DISPATCHER_STATES }                                 from '../../lib/tracker-model/constants/DispatcherStates.ts';
import type { LogFieldShape }                                from '../../lib/tracker-model/constants/LogRecordSchema.ts';
import { LOG_RECORD_SCHEMA, LOG_RECORD_SUBJECT_IDS }         from '../../lib/tracker-model/constants/LogRecordSchema.ts';
import { FIRST_REPEAT_REVIEW_ROUND, FIRST_REVIEW_BAR_ROUND } from '../../lib/tracker-model/constants/ReviewRounds.ts';
import { TICKET_PRIORITIES, TICKET_SIZES }                   from '../../lib/tracker-model/constants/TicketFields.ts';
import { BoardSettingsUtil }                                 from '../../lib/tracker-model/utils/BoardSettingsUtil.ts';
import { VocabularyUtil }                                    from '../../lib/tracker-model/utils/VocabularyUtil.ts';
import { StoredValueUtil }                                   from '../utils/StoredValueUtil.ts';
import { ReviewRecordFieldsUtil }                            from './utils/ReviewRecordFieldsUtil.ts';

type UnknownObject = Record<string, unknown>;

/** `path` is the field as the reason names it, `fields.<name>`. */
type FieldShapeCheck = (value: unknown, path: string) => string | null;

function textProblem(value: unknown, path: string): string | null {
  return typeof value === 'string' ? null : `${path} is not a string`;
}

function listOfTextProblem(value: unknown, path: string, itemsAre: string): string | null {
  const isListOfText = Array.isArray(value) && value.every((item) => typeof item === 'string');
  return isListOfText ? null : `${path} is not a list of ${itemsAre}`;
}

function priorityProblem(value: unknown, path: string): string | null {
  if (typeof value === 'string' && VocabularyUtil.ticketPriorityIsKnown(value)) return null;
  return `${path} is ${JSON.stringify(value)}, which is not one of ${TICKET_PRIORITIES.join(', ')}`;
}

function ticketSizeProblem(value: unknown, path: string): string | null {
  if (typeof value === 'string' && VocabularyUtil.ticketSizeIsKnown(value)) return null;
  return `${path} is ${JSON.stringify(value)}, which is not one of ${TICKET_SIZES.join(', ')}`;
}

function agentPairProblem(value: unknown, path: string): string | null {
  if (!JsonRecordUtil.valueIsAPlainObject(value)) return `${path} is not an object`;
  const { model, effort } = value;
  if (typeof model !== 'string' || !VocabularyUtil.agentModelIsKnown(model)) return `${path}.model is ${JSON.stringify(model)}, which is not a known model`;
  if (typeof effort !== 'string' || !VocabularyUtil.agentEffortIsKnown(effort)) return `${path}.effort is ${JSON.stringify(effort)}, which is not a known effort`;
  return null;
}

function reviewRoundProblem(value: unknown, path: string): string | null {
  return StoredValueUtil.wholeNumberIsAtLeast(value, FIRST_REPEAT_REVIEW_ROUND) ? null : `${path} is not a whole round of at least ${FIRST_REPEAT_REVIEW_ROUND}`;
}

function reviewBarRoundProblem(value: unknown, path: string): string | null {
  return StoredValueUtil.wholeNumberIsAtLeast(value, FIRST_REVIEW_BAR_ROUND) ? null : `${path} is not a whole round of at least ${FIRST_REVIEW_BAR_ROUND}`;
}

function dispatcherStateProblem(value: unknown, path: string): string | null {
  return BoardSettingsUtil.dispatcherStateIsKnown(value) ? null : `${path} is ${JSON.stringify(value)}, which is not one of ${DISPATCHER_STATES.join(', ')}`;
}

const CHECK_FOR_FIELD_SHAPE: Readonly<Record<LogFieldShape, FieldShapeCheck>> = {
  'text':              textProblem,
  // The same rule as a task's own `id`, so every id a row can hold is one a review-bar record can name.
  'task-id':           (value, path) => (StoredValueUtil.valueIsAWholeNumber(value) ? null : `${path} is not a whole number`),
  'optional-text':     (value, path) => (value === undefined ? null : textProblem(value, path)),
  'priority':          priorityProblem,
  'ticket-size':       ticketSizeProblem,
  'optional-size':     (value, path) => (value === undefined ? null : ticketSizeProblem(value, path)),
  'agent-pair':        agentPairProblem,
  'ticket-ids':        (value, path) => listOfTextProblem(value, path, 'ticket ids'),
  'epic-keys':         (value, path) => listOfTextProblem(value, path, 'epic keys'),
  'review-round':      reviewRoundProblem,
  'chart-range':       (value, path) => (BoardSettingsUtil.viewRangeIsWellFormed(value) ? null : `${path} is not a chart range`),
  'concurrency-limit': (value, path) => (BoardSettingsUtil.concurrencyLimitIsWellFormed(value) ? null : `${path} is not a whole number of agents`),
  'dispatcher-state':  dispatcherStateProblem,
  'dispatcher-run-id': (value, path) => (value === null || BoardSettingsUtil.dispatcherRunIdIsWellFormed(value) ? null : `${path} is neither null nor a run id`),
  'check-command':     (value, path) => (value === null || BoardSettingsUtil.checkCommandIsWellFormed(value) ? null : `${path} is neither null nor a shell line that is not blank`),
  'count':             (value, path) => (StoredValueUtil.wholeNumberIsAtLeast(value, 0) ? null : `${path} is not a whole number of at least 0`),
  'review-bar-round':  reviewBarRoundProblem,
  'review-verdict':    ReviewRecordFieldsUtil.verdictProblem,
  'review-claims':     ReviewRecordFieldsUtil.claimsProblem,
  'review-findings':   ReviewRecordFieldsUtil.findingsProblem,
};

function kindIsKnown(kind: unknown): kind is LogRecordKind {
  return typeof kind === 'string' && Object.hasOwn(LOG_RECORD_SCHEMA, kind);
}

function shapesProblemOf(values: UnknownObject, shapes: Readonly<Record<string, LogFieldShape>>, pathPrefix: string): string | null {
  for (const [name, shape] of Object.entries(shapes)) {
    const problem = CHECK_FOR_FIELD_SHAPE[shape](values[name], `${pathPrefix}${name}`);
    if (problem !== null) return problem;
  }
  return null;
}

function kindProblemOf(kind: LogRecordKind, record: UnknownObject, fields: UnknownObject): string | null {
  const { subject, fields: fieldShapes } = LOG_RECORD_SCHEMA[kind];
  return shapesProblemOf(record, LOG_RECORD_SUBJECT_IDS[subject], '') ?? shapesProblemOf(fields, fieldShapes, 'fields.');
}

export function logRecordProblemOf(value: unknown): string | null {
  if (!JsonRecordUtil.valueIsAPlainObject(value)) return 'it is not an object';
  if (typeof value['at'] !== 'string') return 'at is not a string';
  const { kind } = value;
  if (!kindIsKnown(kind)) return `kind is ${JSON.stringify(kind)}, which is not a kind of log record`;
  const { fields } = value;
  if (!JsonRecordUtil.valueIsAPlainObject(fields)) return 'fields is not an object';
  return kindProblemOf(kind, value, fields);
}
