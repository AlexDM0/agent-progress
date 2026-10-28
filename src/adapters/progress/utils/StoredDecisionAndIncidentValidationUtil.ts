/**
 * Whether the parsed `decisions`, `nextDecisionId`, `incidents` and `nextIncidentId` of a progress.json are in the current format, and if
 * not, the reason naming the offending field.
 */
import { JsonRecordUtil }     from '../../../lib/json-record/JsonRecordUtil.ts';
import {
  DECISION_ID_PREFIX,
  DECISION_KINDS,
  FIRST_DECISION_NUMBER,
  FIRST_INCIDENT_NUMBER,
  INCIDENT_ID_PREFIX,
  INCIDENT_KINDS,
  INCIDENT_MOVES,
  NON_AGENT_DECISION_ASKERS
}                          from '../../../lib/tracker-model/constants/DecisionAndIncidentVocabulary.ts';
import { JOB_ROLES }       from '../../../lib/tracker-model/constants/JobStates.ts';
import { StoredValueUtil } from '../../utils/StoredValueUtil.ts';

type UnknownObject = Record<string, unknown>;

const DECISION_ASKERS: readonly string[] = [...JOB_ROLES, ...NON_AGENT_DECISION_ASKERS];

const FIRST_CHAT_SEQUENCE = 1;

function vocabularyProblem(value: unknown, path: string, vocabulary: readonly string[]): string | null {
  if (typeof value === 'string' && vocabulary.includes(value)) return null;
  return `${path} is ${JSON.stringify(value)}, which is not one of ${vocabulary.join(', ')}`;
}

function listOfTextIsWellFormed(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function nullableText(value: unknown): boolean {
  return value === null || typeof value === 'string';
}

function idIsWellFormed(value: unknown, prefix: string): boolean {
  return typeof value === 'string' && new RegExp(`^${prefix}[1-9][0-9]*$`).test(value);
}

function firstProblemOf(problems: readonly (() => string | null)[]): string | null {
  for (const problemOf of problems) {
    const problem = problemOf();
    if (problem !== null) return problem;
  }
  return null;
}

function optionProblem(value: unknown, path: string): string | null {
  if (!JsonRecordUtil.valueIsAPlainObject(value)) return `${path} is not an object`;
  if (typeof value['label'] !== 'string') return `${path}.label is not a string`;
  return typeof value['description'] === 'string' ? null : `${path}.description is not a string`;
}

function questionProblem(value: unknown, path: string): string | null {
  if (!JsonRecordUtil.valueIsAPlainObject(value)) return `${path} is not an object`;
  if (typeof value['question'] !== 'string') return `${path}.question is not a string`;
  if (typeof value['header'] !== 'string') return `${path}.header is not a string`;
  if (typeof value['multiSelect'] !== 'boolean') return `${path}.multiSelect is not true or false`;
  const { options } = value;
  if (!Array.isArray(options)) return `${path}.options is not a list`;
  return firstProblemOf(options.map((option, index) => () => optionProblem(option, `${path}.options[${index}]`)));
}

function sharedFieldsProblem(value: UnknownObject, path: string, idPrefix: string): string | null {
  if (!idIsWellFormed(value['id'], idPrefix)) return `${path}.id is ${JSON.stringify(value['id'])}, and it has to be ${idPrefix} and a whole number`;
  if (!listOfTextIsWellFormed(value['ticketIds'])) return `${path}.ticketIds is not a list of ticket ids`;
  if (!nullableText(value['jobId'])) return `${path}.jobId is neither a job id nor null`;
  return typeof value['openedAt'] === 'string' ? null : `${path}.openedAt is not a string`;
}

function decisionProblem(value: unknown, index: number): string | null {
  const path = `decisions[${index}]`;
  if (!JsonRecordUtil.valueIsAPlainObject(value)) return `${path} is not an object`;
  const { questions } = value;
  return firstProblemOf([
    () => sharedFieldsProblem(value, path, DECISION_ID_PREFIX),
    () => vocabularyProblem(value['kind'], `${path}.kind`, DECISION_KINDS),
    () => vocabularyProblem(value['askedBy'], `${path}.askedBy`, DECISION_ASKERS),
    () => (nullableText(value['requestId']) ? null : `${path}.requestId is neither a request id nor null`),
    () => (typeof value['context'] === 'string' ? null : `${path}.context is not a string`),
    () => (Array.isArray(questions) ? null : `${path}.questions is not a list`),
    ...(Array.isArray(questions) ? questions.map((question, questionIndex) => () => questionProblem(question, `${path}.questions[${questionIndex}]`)) : []),
  ]);
}

function deliveryTurnProblem(value: unknown, path: string): string | null {
  if (value === null) return null;
  if (!JsonRecordUtil.valueIsAPlainObject(value)) return `${path} is neither null nor an object`;
  if (typeof value['jobId'] !== 'string') return `${path}.jobId is not a string`;
  return StoredValueUtil.wholeNumberIsAtLeast(value['chatSequence'], FIRST_CHAT_SEQUENCE) ? null : `${path}.chatSequence is not a whole number of at least ${FIRST_CHAT_SEQUENCE}`;
}

function incidentProblem(value: unknown, index: number): string | null {
  const path = `incidents[${index}]`;
  if (!JsonRecordUtil.valueIsAPlainObject(value)) return `${path} is not an object`;
  const { facts } = value;
  return firstProblemOf([
    () => sharedFieldsProblem(value, path, INCIDENT_ID_PREFIX),
    () => vocabularyProblem(value['kind'], `${path}.kind`, INCIDENT_KINDS),
    () => (JsonRecordUtil.valueIsAPlainObject(facts) && Object.values(facts).every((fact) => typeof fact === 'string') ? null : `${path}.facts is not an object of text`),
    () => vocabularyProblem(value['defaultMove'], `${path}.defaultMove`, INCIDENT_MOVES),
    () => deliveryTurnProblem(value['deliveredInTurn'], `${path}.deliveredInTurn`),
  ]);
}

function counterProblem(value: unknown, key: string, firstNumber: number): string | null {
  if (value === undefined || StoredValueUtil.wholeNumberIsAtLeast(value, firstNumber)) return null;
  return `${key} is ${JSON.stringify(value)}, and when present it has to be a whole number of at least ${firstNumber}`;
}

function listProblem(value: unknown, key: string, itemProblem: (item: unknown, index: number) => string | null): string | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return `${key} is present but not an array`;
  return firstProblemOf(value.map((item, index) => () => itemProblem(item, index)));
}

/** `null` when all four are absent or well formed; the decisions' counter and list come first, then the incidents'. */
function decisionsAndIncidentsProblemOf(document: UnknownObject): string | null {
  return firstProblemOf([
    () => counterProblem(document['nextDecisionId'], 'nextDecisionId', FIRST_DECISION_NUMBER),
    () => listProblem(document['decisions'], 'decisions', decisionProblem),
    () => counterProblem(document['nextIncidentId'], 'nextIncidentId', FIRST_INCIDENT_NUMBER),
    () => listProblem(document['incidents'], 'incidents', incidentProblem),
  ]);
}

export const StoredDecisionAndIncidentValidationUtil = { decisionProblem, incidentProblem, decisionsAndIncidentsProblemOf } as const;
