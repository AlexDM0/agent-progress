/** Whether one parsed log.jsonl line is a well-formed record of a known kind, and if not, the reason naming the offending field. */
import { JsonRecordUtil }     from '../../lib/json-record/JsonRecordUtil.ts';
import type { LogRecordKind } from '../../lib/tracker-model/@types/LogRecord.ts';
import {
  DECISION_KINDS,
  INCIDENT_DEFAULT_CAUSES,
  INCIDENT_KINDS,
  INCIDENT_MOVES
}                             from '../../lib/tracker-model/constants/DecisionAndIncidentVocabulary.ts';
import {
  FIRST_HOST_INSTANCE,
  GATE_OUTCOMES,
  LANDING_KINDS,
  INTERRUPTION_CAUSES,
  JOB_KINDS,
  JOB_OUTCOMES,
  JOB_ROLES,
  RUNNER_STOP_REASONS,
  JOB_STOP_MODES
}                                                            from '../../lib/tracker-model/constants/JobStates.ts';
import type { LogFieldShape }                                                   from '../../lib/tracker-model/constants/LogRecordSchema.ts';
import { LOG_RECORD_SCHEMA, LOG_RECORD_SUBJECT_IDS, RETIRED_DISPATCHER_STATES } from '../../lib/tracker-model/constants/LogRecordSchema.ts';
import { FIRST_REPEAT_REVIEW_ROUND, FIRST_REVIEW_BAR_ROUND }                    from '../../lib/tracker-model/constants/ReviewRounds.ts';
import { RUNNER_STATES }                                                        from '../../lib/tracker-model/constants/RunnerStates.ts';
import { TICKET_PRIORITIES, TICKET_SIZES }                                      from '../../lib/tracker-model/constants/TicketFields.ts';
import { BoardSettingsUtil }                                                    from '../../lib/tracker-model/utils/BoardSettingsUtil.ts';
import { VocabularyUtil }                                                       from '../../lib/tracker-model/utils/VocabularyUtil.ts';
import { StoredValueUtil }                                                      from '../utils/StoredValueUtil.ts';
import { ReviewRecordFieldsUtil }                                               from './utils/ReviewRecordFieldsUtil.ts';

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

function vocabularyProblem(value: unknown, path: string, vocabulary: readonly string[]): string | null {
  if (typeof value === 'string' && vocabulary.includes(value)) return null;
  return `${path} is ${JSON.stringify(value)}, which is not one of ${vocabulary.join(', ')}`;
}

function checkCommandProblem(value: unknown, path: string): string | null {
  return value === null || BoardSettingsUtil.checkCommandIsWellFormed(value) ? null : `${path} is neither null nor a shell line that is not blank`;
}

function hostInstanceProblem(value: unknown, path: string): string | null {
  return StoredValueUtil.wholeNumberIsAtLeast(value, FIRST_HOST_INSTANCE) ? null : `${path} is not a whole number of at least ${FIRST_HOST_INSTANCE}`;
}

function decisionAnswerProblem(value: unknown, path: string): string | null {
  const answers = JsonRecordUtil.valueIsAPlainObject(value) ? Object.values(value) : [];
  const isMapOfText = answers.length > 0 && answers.every((answer) => typeof answer === 'string');
  return isMapOfText ? null : `${path} is not an object of at least one answer keyed by its question`;
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

function runnerStateProblem(value: unknown, path: string): string | null {
  return BoardSettingsUtil.runnerStateIsKnown(value) ? null : `${path} is ${JSON.stringify(value)}, which is not one of ${RUNNER_STATES.join(', ')}`;
}

function retiredDispatcherRunIdProblem(value: unknown, path: string): string | null {
  return value === null || (typeof value === 'string' && value.trim() !== '') ? null : `${path} is neither null nor a run id`;
}

const CHECK_FOR_FIELD_SHAPE: Readonly<Record<LogFieldShape, FieldShapeCheck>> = {
  'text':                   textProblem,
  // The same rule as a task's own `id`, so every id a row can hold is one a review-bar record can name.
  'task-id':                (value, path) => (StoredValueUtil.valueIsAWholeNumber(value) ? null : `${path} is not a whole number`),
  'optional-text':          (value, path) => (value === undefined ? null : textProblem(value, path)),
  'priority':               priorityProblem,
  'ticket-size':            ticketSizeProblem,
  'optional-size':          (value, path) => (value === undefined ? null : ticketSizeProblem(value, path)),
  'agent-pair':             agentPairProblem,
  'ticket-ids':             (value, path) => listOfTextProblem(value, path, 'ticket ids'),
  'epic-keys':              (value, path) => listOfTextProblem(value, path, 'epic keys'),
  'network-domains':        (value, path) => listOfTextProblem(value, path, 'domains'),
  'review-round':           reviewRoundProblem,
  'chart-range':            (value, path) => (BoardSettingsUtil.viewRangeIsWellFormed(value) ? null : `${path} is not a chart range`),
  'concurrency-limit':      (value, path) => (BoardSettingsUtil.concurrencyLimitIsWellFormed(value) ? null : `${path} is not a whole number of agents`),
  'runner-state':           runnerStateProblem,
  'dispatcher-state':       (value, path) => vocabularyProblem(value, path, RETIRED_DISPATCHER_STATES),
  'dispatcher-run-id':      retiredDispatcherRunIdProblem,
  'check-command':          checkCommandProblem,
  'count':                  (value, path) => (StoredValueUtil.wholeNumberIsAtLeast(value, 0) ? null : `${path} is not a whole number of at least 0`),
  'review-bar-round':       reviewBarRoundProblem,
  'review-verdict':         ReviewRecordFieldsUtil.verdictProblem,
  'review-claims':          ReviewRecordFieldsUtil.claimsProblem,
  'review-findings':        ReviewRecordFieldsUtil.findingsProblem,
  'nullable-text':          (value, path) => (value === null ? null : textProblem(value, path)),
  'job-kind':               (value, path) => vocabularyProblem(value, path, JOB_KINDS),
  'job-role':               (value, path) => (value === null ? null : vocabularyProblem(value, path, JOB_ROLES)),
  'job-outcome':            (value, path) => vocabularyProblem(value, path, JOB_OUTCOMES),
  'interruption-cause':     (value, path) => vocabularyProblem(value, path, INTERRUPTION_CAUSES),
  'host-instance':          hostInstanceProblem,
  'permission-names':       (value, path) => listOfTextProblem(value, path, 'permission names'),
  'runner-stop-reason':     (value, path) => vocabularyProblem(value, path, RUNNER_STOP_REASONS),
  'job-stop-mode':          (value, path) => vocabularyProblem(value, path, JOB_STOP_MODES),
  'decision-kind':          (value, path) => vocabularyProblem(value, path, DECISION_KINDS),
  'decision-answer':        decisionAnswerProblem,
  'incident-kind':          (value, path) => vocabularyProblem(value, path, INCIDENT_KINDS),
  'incident-move':          (value, path) => vocabularyProblem(value, path, INCIDENT_MOVES),
  'incident-default-cause': (value, path) => vocabularyProblem(value, path, INCIDENT_DEFAULT_CAUSES),
  'gate-outcome':           (value, path) => vocabularyProblem(value, path, GATE_OUTCOMES),
  'file-paths':             (value, path) => listOfTextProblem(value, path, 'file paths'),
  'landing-kind':           (value, path) => vocabularyProblem(value, path, LANDING_KINDS),
  'flag':                   (value, path) => (typeof value === 'boolean' ? null : `${path} is not true or false`),
  'optional-flag':          (value, path) => (value === undefined || typeof value === 'boolean' ? null : `${path} is not true or false`),
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
