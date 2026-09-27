/** Whether a parsed progress.json is a document in the current format this build can read, and if not, the reason naming the offending field. */
import { JsonRecordUtil }                                    from '../../../lib/json-record/JsonRecordUtil.ts';
import { LOWEST_CONCURRENCY_LIMIT_AGENTS }                   from '../../../lib/tracker-model/constants/ConcurrencyLimits.ts';
import { DISPATCHER_STATES }                                 from '../../../lib/tracker-model/constants/DispatcherStates.ts';
import { FIRST_REPEAT_REVIEW_ROUND, FIRST_REVIEW_BAR_ROUND } from '../../../lib/tracker-model/constants/ReviewRounds.ts';
import { TASK_STATUSES }                                     from '../../../lib/tracker-model/constants/Statuses.ts';
import { FIRST_TASK_ID }                                     from '../../../lib/tracker-model/constants/TaskIds.ts';
import { BoardSettingsUtil }                                 from '../../../lib/tracker-model/utils/BoardSettingsUtil.ts';
import { VocabularyUtil }                                    from '../../../lib/tracker-model/utils/VocabularyUtil.ts';
import { OLDER_FORMAT_ADVICE }                               from '../../constants/OlderFormatAdvice.ts';
import { StoredValueUtil }                                   from '../../utils/StoredValueUtil.ts';
import type { StoredProgressFile, StoredTaskPhase }          from '../@types/StoredProgressFile.ts';
import { CURRENT_PROGRESS_FILE_VERSION }                     from '../constants/ProgressFileVersions.ts';

function textFieldIsPresent(candidate: Record<string, unknown>, field: string): boolean {
  return typeof candidate[field] === 'string';
}

function nullableTextIsWellFormed(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

/** `0` and `null` are different answers — "it used none" and "nobody said" — and every reader keeps them apart. */
function tokenCountIsWellFormed(value: unknown): value is number | null {
  return value === null || StoredValueUtil.wholeNumberIsAtLeast(value, 0);
}

/** Only a repeat review is counted, so the first round a row can record is the second one. */
function reviewRoundIsWellFormed(value: unknown): value is number {
  return StoredValueUtil.wholeNumberIsAtLeast(value, FIRST_REPEAT_REVIEW_ROUND);
}

function reviewBarRoundIsWellFormed(value: unknown): value is number {
  return StoredValueUtil.wholeNumberIsAtLeast(value, FIRST_REVIEW_BAR_ROUND);
}

function taskStatusIsKnown(value: unknown): boolean {
  return typeof value === 'string' && VocabularyUtil.taskStatusIsKnown(value);
}

function taskPhaseIsWellFormed(value: unknown): value is StoredTaskPhase {
  if (!JsonRecordUtil.valueIsAPlainObject(value)) return false;
  return taskStatusIsKnown(value['status']) && typeof value['at'] === 'string';
}

function taskHistoryIsWellFormed(value: unknown): value is StoredTaskPhase[] {
  return Array.isArray(value) && value.every(taskPhaseIsWellFormed);
}

function taskProblem(value: unknown, index: number): string | null {
  // An array row is let through to the field checks, so its reason names the first field it lacks.
  if (typeof value !== 'object' || value === null) return `tasks[${index}] is not an object`;
  const task: Record<string, unknown> = { ...value };
  if (!StoredValueUtil.valueIsAWholeNumber(task['id'])) return `tasks[${index}].id is not a whole number`;
  if (!textFieldIsPresent(task, 'name')) return `tasks[${index}].name is not a string`;
  if (!taskStatusIsKnown(task['status'])) {
    return `tasks[${index}].status is ${JSON.stringify(task['status'])}, which is not one of ${TASK_STATUSES.join(', ')}; ${OLDER_FORMAT_ADVICE}`;
  }
  if (!nullableTextIsWellFormed(task['start'])) return `tasks[${index}].start is neither a timestamp nor null`;
  if (!nullableTextIsWellFormed(task['end'])) return `tasks[${index}].end is neither a timestamp nor null`;
  if (!textFieldIsPresent(task, 'owner')) return `tasks[${index}].owner is not a string`;
  if (!textFieldIsPresent(task, 'note')) return `tasks[${index}].note is not a string`;
  if (!nullableTextIsWellFormed(task['ticket'])) return `tasks[${index}].ticket is neither a ticket id nor null`;
  if (!tokenCountIsWellFormed(task['tokens'])) return `tasks[${index}].tokens is neither a whole number of tokens nor null`;
  if (task['reviewed'] !== undefined && typeof task['reviewed'] !== 'string') return `tasks[${index}].reviewed is present but not a timestamp`;
  if (task['reviewRound'] !== undefined && !reviewRoundIsWellFormed(task['reviewRound'])) {
    return `tasks[${index}].reviewRound is present and is not a whole round of at least ${FIRST_REPEAT_REVIEW_ROUND}`;
  }
  if (task['history'] !== undefined && !taskHistoryIsWellFormed(task['history'])) {
    return `tasks[${index}].history is present and is not a list of phases, each a known status with the timestamp it was reached at; ${OLDER_FORMAT_ADVICE}`;
  }
  if (task['agent'] !== undefined && typeof task['agent'] !== 'string') return `tasks[${index}].agent is present but not the key of the claim that started it`;
  if (task['reviewOf'] !== undefined && typeof task['reviewOf'] !== 'string') return `tasks[${index}].reviewOf is present but not the id of the ticket it reviews`;
  if (task['reviewBarRound'] !== undefined && !reviewBarRoundIsWellFormed(task['reviewBarRound'])) {
    return `tasks[${index}].reviewBarRound is present and is not a whole round of at least ${FIRST_REVIEW_BAR_ROUND}`;
  }
  return null;
}

/**
 * `null` for a document whose top level this build reads, before its rows are looked at. A version 2 file keeps its log in log.jsonl, so a
 * `log` in one is refused rather than silently ignored.
 */
function documentHeaderProblemOf(candidate: unknown): string | null {
  if (!JsonRecordUtil.valueIsAPlainObject(candidate)) return 'the document is not a JSON object';
  const { version } = candidate;
  if (version !== CURRENT_PROGRESS_FILE_VERSION) {
    return `version is ${JSON.stringify(version)}, and this build of agent-progress reads version ${CURRENT_PROGRESS_FILE_VERSION}; ${OLDER_FORMAT_ADVICE}`;
  }
  if (!textFieldIsPresent(candidate, 'trackerId')) return 'trackerId is not a string';
  if (!textFieldIsPresent(candidate, 'project')) return 'project is not a string';
  if (!textFieldIsPresent(candidate, 'startedAt')) return 'startedAt is not a timestamp';
  if (!BoardSettingsUtil.viewRangeIsWellFormed(candidate['view'])) return 'view is not one of the stored range shapes';
  if (!StoredValueUtil.wholeNumberIsAtLeast(candidate['nextTaskId'], FIRST_TASK_ID)) {
    return `nextTaskId is ${JSON.stringify(candidate['nextTaskId'])}, and it has to be a whole number of at least ${FIRST_TASK_ID}`;
  }
  if (candidate['concurrencyLimit'] !== undefined && !BoardSettingsUtil.concurrencyLimitIsWellFormed(candidate['concurrencyLimit'])) {
    return `concurrencyLimit is ${JSON.stringify(candidate['concurrencyLimit'])}, and when present it has to be a whole number of at least ${LOWEST_CONCURRENCY_LIMIT_AGENTS}`;
  }
  if (candidate['dispatcherState'] !== undefined && !BoardSettingsUtil.dispatcherStateIsKnown(candidate['dispatcherState'])) {
    return `dispatcherState is ${JSON.stringify(candidate['dispatcherState'])}, and when present it has to be one of ${DISPATCHER_STATES.join(', ')}`;
  }
  if (candidate['dispatcherRunId'] !== undefined && !BoardSettingsUtil.dispatcherRunIdIsWellFormed(candidate['dispatcherRunId'])) {
    return `dispatcherRunId is ${JSON.stringify(candidate['dispatcherRunId'])}, and when present it has to be a Workflow run id`;
  }
  if (!Array.isArray(candidate['tasks'])) return 'tasks is not an array';
  if (Object.hasOwn(candidate, 'log')) return `log is present, and a version ${CURRENT_PROGRESS_FILE_VERSION} file keeps its log in log.jsonl`;
  return null;
}

function taskRowsProblemOf(tasks: readonly unknown[]): string | null {
  for (const [index, task] of tasks.entries()) {
    const problem = taskProblem(task, index);
    if (problem !== null) return problem;
  }
  return null;
}

/** `null` for a document in the current format this build reads; the first problem found otherwise, the top level before the rows. */
function documentProblemOf(parsed: unknown): string | null {
  const headerProblem = documentHeaderProblemOf(parsed);
  if (headerProblem !== null) return headerProblem;
  const tasks = JsonRecordUtil.recordOf(parsed)?.['tasks'];
  return Array.isArray(tasks) ? taskRowsProblemOf(tasks) : 'tasks is not an array';
}

/** The checks above are the stored format's type written as checks, so a document they find nothing wrong with is one of that type. */
function documentIsStored(parsed: unknown, problemFound: string | null): parsed is StoredProgressFile {
  return problemFound === null && JsonRecordUtil.valueIsAPlainObject(parsed);
}

function readingOf(parsed: unknown): { verdict: 'readable'; document: StoredProgressFile } | { verdict: 'unreadable'; reason: string } {
  const problem = documentProblemOf(parsed);
  if (problem !== null) return { verdict: 'unreadable', reason: problem };
  return documentIsStored(parsed, problem) ? { verdict: 'readable', document: parsed } : { verdict: 'unreadable', reason: 'the document is not in the current format' };
}

export const ProgressFileValidationUtil = { documentProblemOf, readingOf } as const;
