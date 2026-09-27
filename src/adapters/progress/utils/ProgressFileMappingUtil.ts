/**
 * A validated progress.json in the current format mapped to the model and back, field by field. Keys the file held that the tool does not
 * know ride along on the model's objects in the file's order and are written back; nothing else reaches the file unless a mapper names it.
 */
import type { Task, TaskPhase }                                              from '../../../lib/tracker-model/@types/Task.ts';
import type { TrackerProgress }                                              from '../../../lib/tracker-model/@types/TrackerProgress.ts';
import type { WordedLogEntry }                                               from '../../../shared/@types/WordedLogEntry.ts';
import type { WordedProgressDocument }                                       from '../../../shared/@types/WordedProgressDocument.ts';
import type { StoredProgressFile, StoredTask, StoredTaskPhase }              from '../@types/StoredProgressFile.ts';
import { CURRENT_PROGRESS_FILE_VERSION, EMBEDDED_LOG_PROGRESS_FILE_VERSION } from '../constants/ProgressFileVersions.ts';

type KnownKeys = Readonly<Record<string, true>>;

// Each table names every key of the model and of the stored form, so a field added to either fails to compile here until it is mapped.
const KNOWN_PROGRESS_KEYS = {
  version:          true,
  trackerId:        true,
  project:          true,
  startedAt:        true,
  view:             true,
  nextTaskId:       true,
  concurrencyLimit: true,
  dispatcherState:  true,
  dispatcherRunId:  true,
  tasks:            true,
} as const satisfies Record<keyof TrackerProgress | keyof StoredProgressFile, true>;

const KNOWN_TASK_KEYS = {
  id:             true,
  name:           true,
  status:         true,
  start:          true,
  end:            true,
  owner:          true,
  note:           true,
  ticket:         true,
  tokens:         true,
  reviewed:       true,
  reviewRound:    true,
  history:        true,
  agent:          true,
  reviewOf:       true,
  reviewBarRound: true,
} as const satisfies Record<keyof Task | keyof StoredTask, true>;

const KNOWN_TASK_PHASE_KEYS = { status: true, at: true } as const satisfies Record<keyof TaskPhase | keyof StoredTaskPhase, true>;

/** Non-enumerable, so it never shows in a listing, a comparison or a JSON dump of the model, and stays on an object the Board changes in place. */
const UNKNOWN_STORED_KEYS = Symbol('the keys the file held that the tool does not know');

function unknownStoredKeysOf(modelObject: object): readonly string[] {
  const recorded: unknown = Reflect.get(modelObject, UNKNOWN_STORED_KEYS);
  return Array.isArray(recorded) ? recorded.filter((key: unknown): key is string => typeof key === 'string') : [];
}

function entriesOf(source: object, keys: readonly string[]): [string, unknown][] {
  return keys.map((key): [string, unknown] => [key, Reflect.get(source, key)]);
}

/** `mapped` and the carried entries laid out in `keyOrder`, which names every key of both. */
function laidOutIn<Mapped extends object>(keyOrder: readonly string[], carriedEntries: [string, unknown][], mapped: Mapped): Mapped {
  const keyedInOrder: Record<string, unknown> = Object.fromEntries(keyOrder.map((key) => [key, undefined]));
  return Object.assign(keyedInOrder, Object.fromEntries(carriedEntries), mapped);
}

function readInFileOrder<Mapped extends object>(stored: object, knownKeys: KnownKeys, mapped: Mapped): Mapped {
  const storedKeys  = Object.keys(stored);
  const unknownKeys = storedKeys.filter((key) => !Object.hasOwn(knownKeys, key));
  const keyOrder    = storedKeys.filter((key) => Object.hasOwn(mapped, key) || unknownKeys.includes(key));
  const read        = laidOutIn(keyOrder, entriesOf(stored, unknownKeys), mapped);
  Object.defineProperty(read, UNKNOWN_STORED_KEYS, { value: unknownKeys });
  return read;
}

/** In the model object's key order, after `leadingKeys`; a property of the model that is neither mapped nor read from the file is dropped. */
function writtenInModelOrder<Stored extends object>(modelObject: object, leadingKeys: readonly string[], stored: Stored): Stored {
  const modelKeys   = Object.keys(modelObject);
  const unknownKeys = unknownStoredKeysOf(modelObject).filter((key) => modelKeys.includes(key));
  const keyOrder    = [...leadingKeys, ...modelKeys].filter((key) => Object.hasOwn(stored, key) || unknownKeys.includes(key));
  return laidOutIn(keyOrder, entriesOf(modelObject, unknownKeys), stored);
}

function taskPhaseOf(stored: StoredTaskPhase): TaskPhase {
  return readInFileOrder(stored, KNOWN_TASK_PHASE_KEYS, { status: stored.status, at: stored.at });
}

function taskOf(stored: StoredTask): Task {
  return readInFileOrder(stored, KNOWN_TASK_KEYS, {
    id:     stored.id,
    name:   stored.name,
    status: stored.status,
    start:  stored.start,
    end:    stored.end,
    owner:  stored.owner,
    note:   stored.note,
    ticket: stored.ticket,
    tokens: stored.tokens,
    ...(stored.reviewed === undefined ? {} : { reviewed: stored.reviewed }),
    ...(stored.reviewRound === undefined ? {} : { reviewRound: stored.reviewRound }),
    ...(stored.history === undefined ? {} : { history: stored.history.map(taskPhaseOf) }),
    ...(stored.agent === undefined ? {} : { agent: stored.agent }),
    ...(stored.reviewOf === undefined ? {} : { reviewOf: stored.reviewOf }),
    ...(stored.reviewBarRound === undefined ? {} : { reviewBarRound: stored.reviewBarRound }),
  });
}

function progressOf(document: StoredProgressFile): TrackerProgress {
  return readInFileOrder(document, KNOWN_PROGRESS_KEYS, {
    trackerId:  document.trackerId,
    project:    document.project,
    startedAt:  document.startedAt,
    view:       document.view,
    nextTaskId: document.nextTaskId,
    ...(document.concurrencyLimit === undefined ? {} : { concurrencyLimit: document.concurrencyLimit }),
    ...(document.dispatcherState === undefined ? {} : { dispatcherState: document.dispatcherState }),
    ...(document.dispatcherRunId === undefined ? {} : { dispatcherRunId: document.dispatcherRunId }),
    tasks:      document.tasks.map(taskOf),
  });
}

function storedTaskPhaseOf(phase: TaskPhase): StoredTaskPhase {
  return writtenInModelOrder(phase, [], { status: phase.status, at: phase.at });
}

function storedTaskOf(task: Task): StoredTask {
  return writtenInModelOrder(task, [], {
    id:     task.id,
    name:   task.name,
    status: task.status,
    start:  task.start,
    end:    task.end,
    owner:  task.owner,
    note:   task.note,
    ticket: task.ticket,
    tokens: task.tokens,
    ...(task.reviewed === undefined ? {} : { reviewed: task.reviewed }),
    ...(task.reviewRound === undefined ? {} : { reviewRound: task.reviewRound }),
    ...(task.history === undefined ? {} : { history: task.history.map(storedTaskPhaseOf) }),
    ...(task.agent === undefined ? {} : { agent: task.agent }),
    ...(task.reviewOf === undefined ? {} : { reviewOf: task.reviewOf }),
    ...(task.reviewBarRound === undefined ? {} : { reviewBarRound: task.reviewBarRound }),
  });
}

/** `version` first, then every key in the progress's order. */
function storedDocumentOf(progress: TrackerProgress): StoredProgressFile {
  return writtenInModelOrder(progress, ['version'], {
    version:    CURRENT_PROGRESS_FILE_VERSION,
    trackerId:  progress.trackerId,
    project:    progress.project,
    startedAt:  progress.startedAt,
    view:       progress.view,
    nextTaskId: progress.nextTaskId,
    ...(progress.concurrencyLimit === undefined ? {} : { concurrencyLimit: progress.concurrencyLimit }),
    ...(progress.dispatcherState === undefined ? {} : { dispatcherState: progress.dispatcherState }),
    ...(progress.dispatcherRunId === undefined ? {} : { dispatcherRunId: progress.dispatcherRunId }),
    tasks:      progress.tasks.map(storedTaskOf),
  });
}

/**
 * The progress in the version 1 shape, which the ingestion reads back: `version` first, every other key in the progress's order, and the
 * worded log directly after `tasks`.
 */
function wordedDocumentOf<Entry extends WordedLogEntry>(progress: TrackerProgress, log: readonly Entry[]): WordedProgressDocument<Entry> {
  const keyOrder                             = ['version', ...Object.keys(progress).flatMap((key) => (key === 'tasks' ? [key, 'log'] : [key]))];
  const keyedInOrder: Record<string, unknown> = Object.fromEntries(keyOrder.map((key) => [key, undefined]));
  return Object.assign(keyedInOrder, progress, { version: EMBEDDED_LOG_PROGRESS_FILE_VERSION, log: [...log] });
}

export const ProgressFileMappingUtil = { progressOf, storedDocumentOf, wordedDocumentOf } as const;
