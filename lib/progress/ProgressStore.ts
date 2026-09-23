import { existsSync, readFileSync } from 'fs';

import { FIRST_REPEAT_REVIEW_ROUND, JSON_INDENT } from '../constants/Limits';
import { TASK_STATUSES, taskStatusIsKnown }       from '../constants/Statuses';
import type {
  LogEntry,
  ProgressFile,
  Task,
  TaskPhase,
  TaskStatus,
  ViewRange
} from '../constants/Types';
import { writeFileAtomically } from '../platform/AtomicFile';
import type { Workspace }      from '../platform/Workspace';

/** Checked by equality: a future format is refused rather than half-read. */
const SUPPORTED_PROGRESS_VERSION = 1;

const FIRST_TASK_ID = 1;

/** The statuses whose moment is the row's `end` rather than its `start`, which is what a seeded phase is stamped at. */
const TASK_STATUSES_THAT_CLOSE_THE_BAR: readonly TaskStatus[] = ['finished', 're-review', 'reviewed', 'delivered', 'abandoned'];

export type ReadProgressFileResult =
  | { verdict: 'readable'; progress: ProgressFile }
  | { verdict: 'absent' }
  | { verdict: 'unreadable'; reason: string };

export interface AddTaskInput {
  name:         string;
  owner?:       string;
  note?:        string;
  ticket?:      string | null;
  status?:      TaskStatus;
  start?:       string | null;
  end?:         string | null;
  tokens?:      number | null;
  reviewed?:    string;
  reviewRound?: number;
  /** When the row was filed. It is the stamp a `pending` row's first phase carries, and the only way the queue interval is ever measurable. */
  filedAt?:     string;
}

/** `trackerId` comes from the caller: this module has no randomness, and `clear` has to keep the existing id. */
export function createEmptyProgressFile(input: { project: string; startedAt: string; trackerId: string }): ProgressFile {
  return {
    version:    SUPPORTED_PROGRESS_VERSION,
    trackerId:  input.trackerId,
    project:    input.project,
    startedAt:  input.startedAt,
    view:       { kind: 'auto' },
    nextTaskId: FIRST_TASK_ID,
    tasks:      [],
    log:        [],
  };
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
  if (typeof phase['status'] !== 'string' || !taskStatusIsKnown(phase['status'])) return false;
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
  if (typeof task['status'] !== 'string' || !taskStatusIsKnown(task['status'])) {
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
  return null;
}

function logEntryProblem(value: unknown, index: number): string | null {
  if (typeof value !== 'object' || value === null) return `log[${index}] is not an object`;
  const entry = value as Record<string, unknown>;
  if (!textFieldIsPresent(entry, 'at')) return `log[${index}].at is not a timestamp`;
  if (!textFieldIsPresent(entry, 'text')) return `log[${index}].text is not a string`;
  return null;
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

  const problem = progressFileProblem(parsed);
  if (problem !== null) return { verdict: 'unreadable', reason: problem };
  return { verdict: 'readable', progress: parsed as ProgressFile };
}

/** Through `lib/platform/AtomicFile.ts`, because a subagent in another worktree may be reading this exact file right now. */
export function writeProgressFile(workspace: Workspace, progress: ProgressFile): void {
  writeFileAtomically(workspace.progressFilePath, `${JSON.stringify(progress, null, JSON_INDENT)}\n`);
}

/** The counter is stored and never wound back, so `task remove` and `clear` cannot hand a live row's id to a new one. */
function takeNextTaskId(progress: ProgressFile): number {
  const highestExistingId = progress.tasks.reduce((highest, task) => Math.max(highest, task.id), 0);
  const allocated         = Math.max(progress.nextTaskId, highestExistingId + 1);
  progress.nextTaskId     = allocated + 1;
  return allocated;
}

export function findTask(progress: ProgressFile, taskId: number): Task | undefined {
  return progress.tasks.find((task) => task.id === taskId);
}

/**
 * The stamp follows the status: a phase that opens the row's interval is stamped where it opens, a terminal one where it closes, and a
 * `pending` row is stamped where it was filed. A caller that supplied no stamp at all leaves the row with nothing to record.
 */
function seededHistoryFor(input: AddTaskInput): TaskPhase[] | null {
  const status = input.status ?? 'pending';
  if (status === 'pending') {
    return input.filedAt === undefined ? null : [{ status, at: input.filedAt }];
  }
  const reachedAt = TASK_STATUSES_THAT_CLOSE_THE_BAR.includes(status) ? input.end ?? input.start : input.start ?? input.end;
  return reachedAt === undefined || reachedAt === null ? null : [{ status, at: reachedAt }];
}

export function addTask(progress: ProgressFile, input: AddTaskInput): Task {
  const seededHistory = seededHistoryFor(input);
  const task: Task    = {
    id:     takeNextTaskId(progress),
    name:   input.name,
    status: input.status ?? 'pending',
    start:  input.start ?? null,
    end:    input.end ?? null,
    owner:  input.owner ?? '',
    note:   input.note ?? '',
    ticket: input.ticket ?? null,
    tokens: input.tokens ?? null,
    ...(input.reviewed === undefined ? {} : { reviewed: input.reviewed }),
    ...(input.reviewRound === undefined ? {} : { reviewRound: input.reviewRound }),
    ...(seededHistory === null ? {} : { history: seededHistory }),
  };
  progress.tasks.push(task);
  return task;
}

export function setTaskTokens(progress: ProgressFile, taskId: number, tokens: number | null): 'applied' | 'no-such-task' {
  const task = findTask(progress, taskId);
  if (task === undefined) return 'no-such-task';
  task.tokens = tokens;
  return 'applied';
}

/** Accumulates rather than sets, so an agent's tokens reach a row that other agents have already worked on; an unset count counts as 0. */
export function addTaskTokens(progress: ProgressFile, taskId: number, tokens: number): 'applied' | 'no-such-task' {
  const task = findTask(progress, taskId);
  if (task === undefined) return 'no-such-task';
  task.tokens = (task.tokens ?? 0) + tokens;
  return 'applied';
}

function recordPhase(task: Task, status: TaskStatus, at: string): void {
  const history = task.history ?? [];
  history.push({ status, at });
  task.history = history;
}

/**
 * An existing timestamp is never overwritten, which is what makes re-running a command safe — and a phase is filed only when the
 * status really moved, `re-review` excepted, because every review round is an event of its own on a row that does not change status.
 */
export function transitionTask(progress: ProgressFile, taskId: number, status: TaskStatus, at: string): 'applied' | 'no-such-task' {
  const task = findTask(progress, taskId);
  if (task === undefined) return 'no-such-task';

  const statusMoved = task.status !== status;

  if (status === 'running' || status === 'paused') {
    task.start = task.start ?? at;
    task.end = null;
  } else if (status === 'finished' || status === 're-review' || status === 'reviewed' || status === 'delivered') {
    task.start = task.start ?? at;
    task.end = task.end ?? at;
    if (status === 're-review') task.reviewRound = task.reviewRound === undefined ? FIRST_REPEAT_REVIEW_ROUND : task.reviewRound + 1;
    if (status === 'reviewed') task.reviewed = task.reviewed ?? at;
  } else if (status === 'abandoned') {
    if (task.start !== null) task.end = task.end ?? at;
  } else {
    task.start = null;
    task.end = null;
    delete task.reviewed;
    delete task.reviewRound;
  }

  if (statusMoved || status === 're-review') recordPhase(task, status, at);

  task.status = status;
  return 'applied';
}

/** Stored oldest-first; readers sort by `at` for display, since `--at` backfills out of order. */
export function appendLogEntry(progress: ProgressFile, at: string, text: string): void {
  const entry: LogEntry = { at, text };
  progress.log.push(entry);
}

export function removeTask(progress: ProgressFile, taskId: number): Task | undefined {
  const index = progress.tasks.findIndex((task) => task.id === taskId);
  if (index < 0) return undefined;
  const [removed] = progress.tasks.splice(index, 1);
  return removed;
}
