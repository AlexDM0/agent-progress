import { existsSync, readFileSync } from 'node:fs';

import { LegacyStatusUtil }                              from '../../src/adapters/utils/LegacyStatusUtil';
import { createFileAtomically, writeFileAtomically }     from '../../src/lib/atomic-file/AtomicFile';
import type { DispatcherState, ProgressFile, ViewRange } from '../../src/lib/tracker-model/@types/ProgressFile';
import type { TaskPhase }                                from '../../src/lib/tracker-model/@types/Task';
import { DEFAULT_CONCURRENCY_LIMIT_AGENTS }              from '../../src/lib/tracker-model/constants/ConcurrencyLimits';
import { DISPATCHER_STATES }                             from '../../src/lib/tracker-model/constants/DispatcherStates';
import { FIRST_REPEAT_REVIEW_ROUND }                     from '../../src/lib/tracker-model/constants/ReviewRounds';
import { TASK_STATUSES }                                 from '../../src/lib/tracker-model/constants/Statuses';
import { VocabularyUtil }                                from '../../src/lib/tracker-model/utils/VocabularyUtil';
import { LIMITS }                                        from '../../src/shared/constants/Limits';
import type { Workspace }                                from '../platform/Workspace';

/** Checked by equality: a future format is refused rather than half-read. */
const SUPPORTED_PROGRESS_VERSION = 1;

const FIRST_TASK_ID = 1;

const LOWEST_CONCURRENCY_LIMIT = 1;

export type ReadProgressFileResult =
  | { verdict: 'readable'; progress: ProgressFile }
  | { verdict: 'absent' }
  | { verdict: 'unreadable'; reason: string };

/** `trackerId` comes from the caller: this module has no randomness, and `clear` has to keep the existing id. */
export function createEmptyProgressFile(input: { project: string; startedAt: string; trackerId: string }): ProgressFile {
  return {
    version:          SUPPORTED_PROGRESS_VERSION,
    trackerId:        input.trackerId,
    project:          input.project,
    startedAt:        input.startedAt,
    view:             { kind: 'auto' },
    nextTaskId:       FIRST_TASK_ID,
    concurrencyLimit: DEFAULT_CONCURRENCY_LIMIT_AGENTS,
    tasks:            [],
    log:              [],
  };
}

/** Well-formed on disk, which a limit above the ceiling still is: an older tracker holding one reads it as the ceiling rather than failing. */
export function concurrencyLimitIsWellFormed(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= LOWEST_CONCURRENCY_LIMIT;
}

export function dispatcherStateIsKnown(value: unknown): value is DispatcherState {
  return typeof value === 'string' && (DISPATCHER_STATES as readonly string[]).includes(value);
}

export function dispatcherRunIdIsWellFormed(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function textFieldIsPresent(candidate: Record<string, unknown>, field: string): boolean {
  return typeof candidate[field] === 'string';
}

function nullableTextIsWellFormed(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function viewRangeIsWellFormed(value: unknown): value is ViewRange {
  if (typeof value !== 'object' || value === null) return false;
  const view = value as { kind?: unknown; from?: unknown; to?: unknown; tickMinutes?: unknown };
  if (view.kind === 'auto') return true;
  if (view.kind !== 'absolute' && view.kind !== 'relative') return false;
  if (typeof view.from !== 'string' || typeof view.to !== 'string') return false;
  return view.tickMinutes === null || typeof view.tickMinutes === 'number';
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

function taskPhaseIsWellFormed(value: unknown): value is TaskPhase {
  if (typeof value !== 'object' || value === null) return false;
  const phase = value as Record<string, unknown>;
  if (typeof phase['status'] !== 'string' || !VocabularyUtil.taskStatusIsKnown(phase['status'])) return false;
  return typeof phase['at'] === 'string';
}

function taskHistoryIsWellFormed(value: unknown): value is TaskPhase[] {
  return Array.isArray(value) && value.every(taskPhaseIsWellFormed);
}

function taskProblem(value: unknown, index: number): string | null {
  if (typeof value !== 'object' || value === null) return `tasks[${index}] is not an object`;
  const task = value as Record<string, unknown>;
  if (typeof task['id'] !== 'number' || !Number.isSafeInteger(task['id'])) return `tasks[${index}].id is not a whole number`;
  if (!textFieldIsPresent(task, 'name')) return `tasks[${index}].name is not a string`;
  if (typeof task['status'] !== 'string' || !VocabularyUtil.taskStatusIsKnown(task['status'])) {
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
  return null;
}

function logEntryProblem(value: unknown, index: number): string | null {
  if (typeof value !== 'object' || value === null) return `log[${index}] is not an object`;
  const entry = value as Record<string, unknown>;
  if (!textFieldIsPresent(entry, 'at')) return `log[${index}].at is not a timestamp`;
  if (!textFieldIsPresent(entry, 'text')) return `log[${index}].text is not a string`;
  return null;
}

function replaceRetiredTaskStatusWord(record: unknown): void {
  if (typeof record !== 'object' || record === null) return;
  const candidate = record as Record<string, unknown>;
  if (typeof candidate['status'] !== 'string') return;
  candidate['status'] = LegacyStatusUtil.currentTaskStatusFor(candidate['status']) ?? candidate['status'];
}

/** In memory only: a read never writes, so a file keeps its retired words until the next command that changes it stores the new ones. */
function replaceRetiredTaskStatusWords(parsed: unknown): void {
  if (typeof parsed !== 'object' || parsed === null) return;
  const { tasks } = parsed as Record<string, unknown>;
  if (!Array.isArray(tasks)) return;
  for (const task of tasks) {
    replaceRetiredTaskStatusWord(task);
    const history = typeof task === 'object' && task !== null ? (task as Record<string, unknown>)['history'] : undefined;
    if (Array.isArray(history)) history.forEach(replaceRetiredTaskStatusWord);
  }
}

function progressFileProblem(parsed: unknown): string | null {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return 'the document is not a JSON object';
  const candidate = parsed as Record<string, unknown>;
  if (candidate['version'] !== SUPPORTED_PROGRESS_VERSION) {
    return `version is ${JSON.stringify(candidate['version'])}, and this build of agent-progress reads version ${SUPPORTED_PROGRESS_VERSION}`;
  }
  if (!textFieldIsPresent(candidate, 'trackerId')) return 'trackerId is not a string';
  if (!textFieldIsPresent(candidate, 'project')) return 'project is not a string';
  if (!textFieldIsPresent(candidate, 'startedAt')) return 'startedAt is not a timestamp';
  if (!viewRangeIsWellFormed(candidate['view'])) return 'view is not one of the stored range shapes';
  if (typeof candidate['nextTaskId'] !== 'number' || !Number.isSafeInteger(candidate['nextTaskId']) || candidate['nextTaskId'] < FIRST_TASK_ID) {
    return `nextTaskId is ${JSON.stringify(candidate['nextTaskId'])}, and it has to be a whole number of at least ${FIRST_TASK_ID}`;
  }
  if (candidate['concurrencyLimit'] !== undefined && !concurrencyLimitIsWellFormed(candidate['concurrencyLimit'])) {
    return `concurrencyLimit is ${JSON.stringify(candidate['concurrencyLimit'])}, and when present it has to be a whole number of at least ${LOWEST_CONCURRENCY_LIMIT}`;
  }
  if (candidate['dispatcherState'] !== undefined && !dispatcherStateIsKnown(candidate['dispatcherState'])) {
    return `dispatcherState is ${JSON.stringify(candidate['dispatcherState'])}, and when present it has to be one of ${DISPATCHER_STATES.join(', ')}`;
  }
  if (candidate['dispatcherRunId'] !== undefined && !dispatcherRunIdIsWellFormed(candidate['dispatcherRunId'])) {
    return `dispatcherRunId is ${JSON.stringify(candidate['dispatcherRunId'])}, and when present it has to be a Workflow run id`;
  }
  if (!Array.isArray(candidate['tasks'])) return 'tasks is not an array';
  if (!Array.isArray(candidate['log'])) return 'log is not an array';

  for (const [index, task] of candidate['tasks'].entries()) {
    const problem = taskProblem(task, index);
    if (problem !== null) return problem;
  }
  for (const [index, entry] of candidate['log'].entries()) {
    const problem = logEntryProblem(entry, index);
    if (problem !== null) return problem;
  }
  return null;
}

/**
 * Never throws: an unreadable file comes back as a verdict whose reason names the offending field.
 * A file that exists but cannot be read is `unreadable`, never `absent`, because `absent` is the answer that invites `init` to replace a good file.
 */
export function readProgressFile(workspace: Workspace): ReadProgressFileResult {
  let rawText: string;
  try {
    rawText = readFileSync(workspace.progressFilePath, 'utf8');
  } catch (error) {
    if (!existsSync(workspace.progressFilePath)) return { verdict: 'absent' };
    return { verdict: 'unreadable', reason: `it could not be read (${error instanceof Error ? error.message : 'unknown error'})` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    return { verdict: 'unreadable', reason: `it is not valid JSON (${error instanceof Error ? error.message : 'unparseable'})` };
  }

  replaceRetiredTaskStatusWords(parsed);
  const problem = progressFileProblem(parsed);
  if (problem !== null) return { verdict: 'unreadable', reason: problem };
  return { verdict: 'readable', progress: parsed as ProgressFile };
}

/** Through `src/lib/atomic-file/AtomicFile.ts`, because a subagent in another worktree may be reading this exact file right now. */
export function writeProgressFile(workspace: Workspace, progress: ProgressFile): void {
  writeFileAtomically(workspace.progressFilePath, `${JSON.stringify(progress, null, LIMITS.JSON_INDENT)}\n`);
}

/** `init`'s write: it never replaces a progress file, whatever path led to it, and says so instead. */
export function createProgressFile(workspace: Workspace, progress: ProgressFile): 'created' | 'already-exists' {
  return createFileAtomically(workspace.progressFilePath, `${JSON.stringify(progress, null, LIMITS.JSON_INDENT)}\n`);
}
