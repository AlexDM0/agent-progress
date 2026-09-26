/** Whether a parsed progress.json is a document this build can read, and if not, the reason naming the offending field. */
import { LOWEST_CONCURRENCY_LIMIT_AGENTS }                                   from '../../../lib/tracker-model/constants/ConcurrencyLimits.ts';
import { DISPATCHER_STATES }                                                 from '../../../lib/tracker-model/constants/DispatcherStates.ts';
import { FIRST_REPEAT_REVIEW_ROUND, FIRST_REVIEW_BAR_ROUND }                 from '../../../lib/tracker-model/constants/ReviewRounds.ts';
import { TASK_STATUSES }                                                     from '../../../lib/tracker-model/constants/Statuses.ts';
import { FIRST_TASK_ID }                                                     from '../../../lib/tracker-model/constants/TaskIds.ts';
import { BoardSettingsUtil }                                                 from '../../../lib/tracker-model/utils/BoardSettingsUtil.ts';
import { VocabularyUtil }                                                    from '../../../lib/tracker-model/utils/VocabularyUtil.ts';
import { LegacyStatusUtil }                                                  from '../../utils/LegacyStatusUtil.ts';
import type { StoredTaskPhase }                                              from '../@types/StoredProgressFile.ts';
import { CURRENT_PROGRESS_FILE_VERSION, EMBEDDED_LOG_PROGRESS_FILE_VERSION } from '../constants/ProgressFileVersions.ts';

function textFieldIsPresent(candidate: Record<string, unknown>, field: string): boolean {
  return typeof candidate[field] === 'string';
}

function nullableTextIsWellFormed(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

/** `0` and `null` are different answers — "it used none" and "nobody said" — and every reader keeps them apart. */
function tokenCountIsWellFormed(value: unknown): value is number | null {
  if (value === null) return true;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Only a repeat review is counted, so the first round a row can record is the second one. */
function reviewRoundIsWellFormed(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= FIRST_REPEAT_REVIEW_ROUND;
}

function reviewBarRoundIsWellFormed(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= FIRST_REVIEW_BAR_ROUND;
}

/** A retired word passes: the migration step replaces it, so it is as readable as the word it became. */
function taskStatusIsReadable(value: unknown): boolean {
  return typeof value === 'string' && (VocabularyUtil.taskStatusIsKnown(value) || LegacyStatusUtil.currentTaskStatusFor(value) !== null);
}

function taskPhaseIsWellFormed(value: unknown): value is StoredTaskPhase {
  if (typeof value !== 'object' || value === null) return false;
  const phase = value as Record<string, unknown>;
  if (!taskStatusIsReadable(phase['status'])) return false;
  return typeof phase['at'] === 'string';
}

function taskHistoryIsWellFormed(value: unknown): value is StoredTaskPhase[] {
  return Array.isArray(value) && value.every(taskPhaseIsWellFormed);
}

function taskProblem(value: unknown, index: number): string | null {
  if (typeof value !== 'object' || value === null) return `tasks[${index}] is not an object`;
  const task = value as Record<string, unknown>;
  if (typeof task['id'] !== 'number' || !Number.isSafeInteger(task['id'])) return `tasks[${index}].id is not a whole number`;
  if (!textFieldIsPresent(task, 'name')) return `tasks[${index}].name is not a string`;
  if (!taskStatusIsReadable(task['status'])) {
    return `tasks[${index}].status is ${JSON.stringify(task['status'])}, which is not one of ${TASK_STATUSES.join(', ')}`;
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
    return `tasks[${index}].history is present and is not a list of phases, each a known status with the timestamp it was reached at`;
  }
  if (task['agent'] !== undefined && typeof task['agent'] !== 'string') return `tasks[${index}].agent is present but not the key of the claim that started it`;
  if (task['reviewOf'] !== undefined && typeof task['reviewOf'] !== 'string') return `tasks[${index}].reviewOf is present but not the id of the ticket it reviews`;
  if (task['reviewBarRound'] !== undefined && !reviewBarRoundIsWellFormed(task['reviewBarRound'])) {
    return `tasks[${index}].reviewBarRound is present and is not a whole round of at least ${FIRST_REVIEW_BAR_ROUND}`;
  }
  return null;
}

function logEntryProblem(value: unknown, index: number): string | null {
  if (typeof value !== 'object' || value === null) return `log[${index}] is not an object`;
  const entry = value as Record<string, unknown>;
  if (!textFieldIsPresent(entry, 'at')) return `log[${index}].at is not a timestamp`;
  if (!textFieldIsPresent(entry, 'text')) return `log[${index}].text is not a string`;
  return null;
}

/**
 * `null` for a document this build reads; retired status words pass, and are replaced by the migration step, never here. A version 1
 * file owns its log; a version 2 file keeps it in log.jsonl, so a `log` in one is refused rather than silently ignored.
 */
function documentProblemOf(parsed: unknown): string | null {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return 'the document is not a JSON object';
  const candidate = parsed as Record<string, unknown>;
  const { version } = candidate;
  if (version !== EMBEDDED_LOG_PROGRESS_FILE_VERSION && version !== CURRENT_PROGRESS_FILE_VERSION) {
    return `version is ${JSON.stringify(version)}, and this build of agent-progress reads versions ${EMBEDDED_LOG_PROGRESS_FILE_VERSION} and ${CURRENT_PROGRESS_FILE_VERSION}`;
  }
  if (!textFieldIsPresent(candidate, 'trackerId')) return 'trackerId is not a string';
  if (!textFieldIsPresent(candidate, 'project')) return 'project is not a string';
  if (!textFieldIsPresent(candidate, 'startedAt')) return 'startedAt is not a timestamp';
  if (!BoardSettingsUtil.viewRangeIsWellFormed(candidate['view'])) return 'view is not one of the stored range shapes';
  if (typeof candidate['nextTaskId'] !== 'number' || !Number.isSafeInteger(candidate['nextTaskId']) || candidate['nextTaskId'] < FIRST_TASK_ID) {
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
  if (version === CURRENT_PROGRESS_FILE_VERSION && Object.hasOwn(candidate, 'log')) {
    return `log is present, and a version ${CURRENT_PROGRESS_FILE_VERSION} file keeps its log in log.jsonl`;
  }
  if (version === EMBEDDED_LOG_PROGRESS_FILE_VERSION && !Array.isArray(candidate['log'])) return 'log is not an array';

  for (const [index, task] of candidate['tasks'].entries()) {
    const problem = taskProblem(task, index);
    if (problem !== null) return problem;
  }
  const embeddedLog: unknown[] = Array.isArray(candidate['log']) ? candidate['log'] : [];
  for (const [index, entry] of embeddedLog.entries()) {
    const problem = logEntryProblem(entry, index);
    if (problem !== null) return problem;
  }
  return null;
}

export const ProgressFileValidationUtil = { documentProblemOf } as const;
