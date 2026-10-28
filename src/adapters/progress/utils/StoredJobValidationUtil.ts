/** Whether the parsed `jobs` and `nextJobId` of a progress.json are in the current format, and if not, the reason naming the offending field. */
import { JsonRecordUtil } from '../../../lib/json-record/JsonRecordUtil.ts';
import {
  FIRST_HOST_INSTANCE,
  FIRST_JOB_NUMBER,
  INTERRUPTION_CAUSES,
  JOB_ID_PREFIX,
  JOB_KINDS,
  JOB_OUTCOMES,
  JOB_ROLES,
  JOB_STATES,
  SLOT_PHASES
}                          from '../../../lib/tracker-model/constants/JobStates.ts';
import { StoredValueUtil } from '../../utils/StoredValueUtil.ts';

const FIRST_ATTEMPT = 1;

const FIRST_EVENT_SEQUENCE = 0;

function vocabularyProblem(value: unknown, path: string, vocabulary: readonly string[]): string | null {
  if (typeof value === 'string' && vocabulary.includes(value)) return null;
  return `${path} is ${JSON.stringify(value)}, which is not one of ${vocabulary.join(', ')}`;
}

function listOfTextIsWellFormed(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function nullableText(value: unknown): boolean {
  return value === null || typeof value === 'string';
}

function jobIdIsWellFormed(value: unknown): value is string {
  return typeof value === 'string' && new RegExp(`^${JOB_ID_PREFIX}[1-9][0-9]*$`).test(value);
}

function eventCursorProblem(value: unknown, path: string): string | null {
  if (!JsonRecordUtil.valueIsAPlainObject(value)) return `${path} is not an object`;
  if (!StoredValueUtil.wholeNumberIsAtLeast(value['instance'], FIRST_HOST_INSTANCE)) return `${path}.instance is not a whole number of at least ${FIRST_HOST_INSTANCE}`;
  if (!StoredValueUtil.wholeNumberIsAtLeast(value['sequence'], FIRST_EVENT_SEQUENCE)) return `${path}.sequence is not a whole number of at least ${FIRST_EVENT_SEQUENCE}`;
  return null;
}

function mergeSlotProblem(value: unknown, path: string): string | null {
  if (!JsonRecordUtil.valueIsAPlainObject(value)) return `${path} is present but not an object`;
  for (const field of ['target', 'targetTip', 'branchTip']) {
    if (typeof value[field] !== 'string') return `${path}.${field} is not a string`;
  }
  return vocabularyProblem(value['phase'], `${path}.phase`, SLOT_PHASES);
}

function jobOptionalFieldsProblem(job: Record<string, unknown>, path: string): string | null {
  if (job['interruption'] !== undefined) {
    const problem = vocabularyProblem(job['interruption'], `${path}.interruption`, INTERRUPTION_CAUSES);
    if (problem !== null) return problem;
  }
  if (job['slot'] !== undefined) {
    const problem = mergeSlotProblem(job['slot'], `${path}.slot`);
    if (problem !== null) return problem;
  }
  return job['outcome'] === undefined ? null : vocabularyProblem(job['outcome'], `${path}.outcome`, JOB_OUTCOMES);
}

function jobProblem(value: unknown, index: number): string | null {
  const path = `jobs[${index}]`;
  if (!JsonRecordUtil.valueIsAPlainObject(value)) return `${path} is not an object`;
  if (!jobIdIsWellFormed(value['id'])) return `${path}.id is ${JSON.stringify(value['id'])}, and it has to be ${JOB_ID_PREFIX} and a whole number`;
  const kindProblem = vocabularyProblem(value['kind'], `${path}.kind`, JOB_KINDS);
  if (kindProblem !== null) return kindProblem;
  if (value['role'] !== null && vocabularyProblem(value['role'], `${path}.role`, JOB_ROLES) !== null) {
    return `${path}.role is ${JSON.stringify(value['role'])}, which is neither null nor one of ${JOB_ROLES.join(', ')}`;
  }
  if (!listOfTextIsWellFormed(value['ticketIds'])) return `${path}.ticketIds is not a list of ticket ids`;
  if (!nullableText(value['parentJobId'])) return `${path}.parentJobId is neither a job id nor null`;
  if (!StoredValueUtil.wholeNumberIsAtLeast(value['attempt'], FIRST_ATTEMPT)) return `${path}.attempt is not a whole number of at least ${FIRST_ATTEMPT}`;
  if (!nullableText(value['target'])) return `${path}.target is neither a branch nor null`;
  const stateProblem = vocabularyProblem(value['state'], `${path}.state`, JOB_STATES);
  if (stateProblem !== null) return stateProblem;
  if (!StoredValueUtil.wholeNumberIsAtLeast(value['hostInstance'], FIRST_HOST_INSTANCE)) return `${path}.hostInstance is not a whole number of at least ${FIRST_HOST_INSTANCE}`;
  const cursorProblem = eventCursorProblem(value['eventCursor'], `${path}.eventCursor`);
  if (cursorProblem !== null) return cursorProblem;
  if (!listOfTextIsWellFormed(value['answeredRequestIds'])) return `${path}.answeredRequestIds is not a list of request ids`;
  if (!StoredValueUtil.wholeNumberIsAtLeast(value['crashResumes'], 0)) return `${path}.crashResumes is not a whole number of at least 0`;
  return jobOptionalFieldsProblem(value, path);
}

/** `null` when both are absent or well formed; the counter is checked first, then each job in order. */
function jobsProblemOf(document: Record<string, unknown>): string | null {
  const { nextJobId, jobs } = document;
  if (nextJobId !== undefined && !StoredValueUtil.wholeNumberIsAtLeast(nextJobId, FIRST_JOB_NUMBER)) {
    return `nextJobId is ${JSON.stringify(nextJobId)}, and when present it has to be a whole number of at least ${FIRST_JOB_NUMBER}`;
  }
  if (jobs === undefined) return null;
  if (!Array.isArray(jobs)) return 'jobs is present but not an array';
  for (const [index, job] of jobs.entries()) {
    const problem = jobProblem(job, index);
    if (problem !== null) return problem;
  }
  return null;
}

export const StoredJobValidationUtil = { jobProblem, jobsProblemOf } as const;
