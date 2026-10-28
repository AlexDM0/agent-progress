/**
 * A validated progress.json in the current format mapped to the model and back, field by field. Keys the file held that the tool does not
 * know ride along on the model's objects in the file's order and are written back; nothing else reaches the file unless a mapper names it.
 */
import type { Decision, DecisionQuestion, DecisionQuestionOption } from '../../../lib/tracker-model/@types/Decision.ts';
import type { Incident, IncidentDeliveryTurn }                     from '../../../lib/tracker-model/@types/Incident.ts';
import type {
  Job,
  JobEventCursor,
  JobIntake,
  MergeSlot
} from '../../../lib/tracker-model/@types/Job.ts';
import type { Task, TaskPhase }        from '../../../lib/tracker-model/@types/Task.ts';
import type { TrackerProgress }        from '../../../lib/tracker-model/@types/TrackerProgress.ts';
import type { WordedLogEntry }         from '../../../shared/@types/WordedLogEntry.ts';
import type { WordedProgressDocument } from '../../../shared/@types/WordedProgressDocument.ts';
import type {
  StoredDecision,
  StoredDecisionQuestion,
  StoredDecisionQuestionOption,
  StoredIncident,
  StoredIncidentDeliveryTurn,
  StoredJob,
  StoredJobEventCursor,
  StoredMergeSlot,
  StoredProgressFile,
  StoredTask,
  StoredTaskPhase
}                                                                            from '../@types/StoredProgressFile.ts';
import { CURRENT_PROGRESS_FILE_VERSION, EMBEDDED_LOG_PROGRESS_FILE_VERSION } from '../constants/ProgressFileVersions.ts';

type KnownKeys = Readonly<Record<string, true>>;

// Each table names every key of the model and of the stored form, so a field added to either fails to compile here until it is mapped.
const KNOWN_PROGRESS_KEYS = {
  version:               true,
  trackerId:             true,
  project:               true,
  startedAt:             true,
  view:                  true,
  nextTaskId:            true,
  concurrencyLimit:      true,
  dispatcherState:       true,
  dispatcherRunId:       true,
  checkCommand:          true,
  installCommand:        true,
  checksDefinitionFiles: true,
  nextDraftId:           true,
  nextJobId:             true,
  jobs:                  true,
  nextDecisionId:        true,
  decisions:             true,
  nextIncidentId:        true,
  incidents:             true,
  tasks:                 true,
} as const satisfies Record<keyof TrackerProgress | keyof StoredProgressFile, true>;

const KNOWN_JOB_KEYS = {
  id:                 true,
  kind:               true,
  role:               true,
  ticketIds:          true,
  parentJobId:        true,
  attempt:            true,
  target:             true,
  state:              true,
  interruption:       true,
  hostInstance:       true,
  eventCursor:        true,
  answeredRequestIds: true,
  crashResumes:       true,
  slot:               true,
  stopRequest:        true,
  intake:             true,
  outcome:            true,
} as const satisfies Record<keyof Job | keyof StoredJob, true>;

function intakeCopyOf(intake: JobIntake): JobIntake {
  return {
    text: intake.text,
    ...(intake.proposedDraftSets === undefined ? {} : { proposedDraftSets: intake.proposedDraftSets.map((draftSet) => [...draftSet]) }),
    ...(intake.carriedAnswers === undefined ? {} : { carriedAnswers: intake.carriedAnswers.map((answer) => ({ ...answer })) }),
  };
}

const KNOWN_EVENT_CURSOR_KEYS = { instance: true, sequence: true } as const satisfies Record<keyof JobEventCursor | keyof StoredJobEventCursor, true>;

const KNOWN_DECISION_KEYS = {
  id:        true,
  kind:      true,
  ticketIds: true,
  jobId:     true,
  askedBy:   true,
  requestId: true,
  questions: true,
  context:   true,
  openedAt:  true,
} as const satisfies Record<keyof Decision | keyof StoredDecision, true>;

const KNOWN_DECISION_QUESTION_KEYS = {
  question:    true,
  header:      true,
  multiSelect: true,
  options:     true,
} as const satisfies Record<keyof DecisionQuestion | keyof StoredDecisionQuestion, true>;

const KNOWN_DECISION_OPTION_KEYS = { label: true, description: true } as const satisfies Record<keyof DecisionQuestionOption | keyof StoredDecisionQuestionOption, true>;

const KNOWN_INCIDENT_KEYS = {
  id:              true,
  kind:            true,
  ticketIds:       true,
  jobId:           true,
  facts:           true,
  defaultMove:     true,
  deliveredInTurn: true,
  openedAt:        true,
} as const satisfies Record<keyof Incident | keyof StoredIncident, true>;

const KNOWN_DELIVERY_TURN_KEYS = { jobId: true, chatSequence: true } as const satisfies Record<keyof IncidentDeliveryTurn | keyof StoredIncidentDeliveryTurn, true>;

const KNOWN_MERGE_SLOT_KEYS = {
  target:    true,
  targetTip: true,
  branchTip: true,
  phase:     true,
} as const satisfies Record<keyof MergeSlot | keyof StoredMergeSlot, true>;

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
  checkCommand:   true,
  mergeQueued:    true,
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
    ...(stored.checkCommand === undefined ? {} : { checkCommand: stored.checkCommand }),
    ...(stored.mergeQueued === undefined ? {} : { mergeQueued: stored.mergeQueued }),
  });
}

function eventCursorOf(stored: StoredJobEventCursor): JobEventCursor {
  return readInFileOrder(stored, KNOWN_EVENT_CURSOR_KEYS, { instance: stored.instance, sequence: stored.sequence });
}

function mergeSlotOf(stored: StoredMergeSlot): MergeSlot {
  return readInFileOrder(stored, KNOWN_MERGE_SLOT_KEYS, {
    target:    stored.target,
    targetTip: stored.targetTip,
    branchTip: stored.branchTip,
    phase:     stored.phase,
  });
}

function questionOf(stored: StoredDecisionQuestion): DecisionQuestion {
  return readInFileOrder(stored, KNOWN_DECISION_QUESTION_KEYS, {
    question:    stored.question,
    header:      stored.header,
    multiSelect: stored.multiSelect,
    options:     stored.options.map((option) => readInFileOrder(option, KNOWN_DECISION_OPTION_KEYS, { label: option.label, description: option.description })),
  });
}

function decisionOf(stored: StoredDecision): Decision {
  return readInFileOrder(stored, KNOWN_DECISION_KEYS, {
    id:        stored.id,
    kind:      stored.kind,
    ticketIds: [...stored.ticketIds],
    jobId:     stored.jobId,
    askedBy:   stored.askedBy,
    requestId: stored.requestId,
    questions: stored.questions.map(questionOf),
    context:   stored.context,
    openedAt:  stored.openedAt,
  });
}

/** `facts` is a map whose every key is the runner's, so it is copied whole. */
function incidentOf(stored: StoredIncident): Incident {
  const turn = stored.deliveredInTurn;
  return readInFileOrder(stored, KNOWN_INCIDENT_KEYS, {
    id:              stored.id,
    kind:            stored.kind,
    ticketIds:       [...stored.ticketIds],
    jobId:           stored.jobId,
    facts:           { ...stored.facts },
    defaultMove:     stored.defaultMove,
    deliveredInTurn: turn === null ? null : readInFileOrder(turn, KNOWN_DELIVERY_TURN_KEYS, { jobId: turn.jobId, chatSequence: turn.chatSequence }),
    openedAt:        stored.openedAt,
  });
}

function jobOf(stored: StoredJob): Job {
  return readInFileOrder(stored, KNOWN_JOB_KEYS, {
    id:                 stored.id,
    kind:               stored.kind,
    role:               stored.role,
    ticketIds:          [...stored.ticketIds],
    parentJobId:        stored.parentJobId,
    attempt:            stored.attempt,
    target:             stored.target,
    state:              stored.state,
    ...(stored.interruption === undefined ? {} : { interruption: stored.interruption }),
    hostInstance:       stored.hostInstance,
    eventCursor:        eventCursorOf(stored.eventCursor),
    answeredRequestIds: [...stored.answeredRequestIds],
    crashResumes:       stored.crashResumes,
    ...(stored.slot === undefined ? {} : { slot: mergeSlotOf(stored.slot) }),
    ...(stored.stopRequest === undefined ? {} : { stopRequest: stored.stopRequest }),
    ...(stored.intake === undefined ? {} : { intake: intakeCopyOf(stored.intake) }),
    ...(stored.outcome === undefined ? {} : { outcome: stored.outcome }),
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
    ...(document.checkCommand === undefined ? {} : { checkCommand: document.checkCommand }),
    ...(document.installCommand === undefined ? {} : { installCommand: document.installCommand }),
    ...(document.checksDefinitionFiles === undefined ? {} : { checksDefinitionFiles: [...document.checksDefinitionFiles] }),
    ...(document.nextDraftId === undefined ? {} : { nextDraftId: document.nextDraftId }),
    ...(document.nextJobId === undefined ? {} : { nextJobId: document.nextJobId }),
    ...(document.jobs === undefined ? {} : { jobs: document.jobs.map(jobOf) }),
    ...(document.nextDecisionId === undefined ? {} : { nextDecisionId: document.nextDecisionId }),
    ...(document.decisions === undefined ? {} : { decisions: document.decisions.map(decisionOf) }),
    ...(document.nextIncidentId === undefined ? {} : { nextIncidentId: document.nextIncidentId }),
    ...(document.incidents === undefined ? {} : { incidents: document.incidents.map(incidentOf) }),
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
    ...(task.checkCommand === undefined ? {} : { checkCommand: task.checkCommand }),
    ...(task.mergeQueued === undefined ? {} : { mergeQueued: task.mergeQueued }),
  });
}

function storedEventCursorOf(cursor: JobEventCursor): StoredJobEventCursor {
  return writtenInModelOrder(cursor, [], { instance: cursor.instance, sequence: cursor.sequence });
}

function storedMergeSlotOf(slot: MergeSlot): StoredMergeSlot {
  return writtenInModelOrder(slot, [], {
    target:    slot.target,
    targetTip: slot.targetTip,
    branchTip: slot.branchTip,
    phase:     slot.phase,
  });
}

function storedQuestionOf(question: DecisionQuestion): StoredDecisionQuestion {
  return writtenInModelOrder(question, [], {
    question:    question.question,
    header:      question.header,
    multiSelect: question.multiSelect,
    options:     question.options.map((option) => writtenInModelOrder(option, [], { label: option.label, description: option.description })),
  });
}

function storedDecisionOf(decision: Decision): StoredDecision {
  return writtenInModelOrder(decision, [], {
    id:        decision.id,
    kind:      decision.kind,
    ticketIds: [...decision.ticketIds],
    jobId:     decision.jobId,
    askedBy:   decision.askedBy,
    requestId: decision.requestId,
    questions: decision.questions.map(storedQuestionOf),
    context:   decision.context,
    openedAt:  decision.openedAt,
  });
}

function storedIncidentOf(incident: Incident): StoredIncident {
  const turn = incident.deliveredInTurn;
  return writtenInModelOrder(incident, [], {
    id:              incident.id,
    kind:            incident.kind,
    ticketIds:       [...incident.ticketIds],
    jobId:           incident.jobId,
    facts:           { ...incident.facts },
    defaultMove:     incident.defaultMove,
    deliveredInTurn: turn === null ? null : writtenInModelOrder(turn, [], { jobId: turn.jobId, chatSequence: turn.chatSequence }),
    openedAt:        incident.openedAt,
  });
}

function storedJobOf(job: Job): StoredJob {
  return writtenInModelOrder(job, [], {
    id:                 job.id,
    kind:               job.kind,
    role:               job.role,
    ticketIds:          [...job.ticketIds],
    parentJobId:        job.parentJobId,
    attempt:            job.attempt,
    target:             job.target,
    state:              job.state,
    ...(job.interruption === undefined ? {} : { interruption: job.interruption }),
    hostInstance:       job.hostInstance,
    eventCursor:        storedEventCursorOf(job.eventCursor),
    answeredRequestIds: [...job.answeredRequestIds],
    crashResumes:       job.crashResumes,
    ...(job.slot === undefined ? {} : { slot: storedMergeSlotOf(job.slot) }),
    ...(job.stopRequest === undefined ? {} : { stopRequest: job.stopRequest }),
    ...(job.intake === undefined ? {} : { intake: intakeCopyOf(job.intake) }),
    ...(job.outcome === undefined ? {} : { outcome: job.outcome }),
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
    ...(progress.checkCommand === undefined ? {} : { checkCommand: progress.checkCommand }),
    ...(progress.installCommand === undefined ? {} : { installCommand: progress.installCommand }),
    ...(progress.checksDefinitionFiles === undefined ? {} : { checksDefinitionFiles: [...progress.checksDefinitionFiles] }),
    ...(progress.nextDraftId === undefined ? {} : { nextDraftId: progress.nextDraftId }),
    ...(progress.nextJobId === undefined ? {} : { nextJobId: progress.nextJobId }),
    ...(progress.jobs === undefined ? {} : { jobs: progress.jobs.map(storedJobOf) }),
    ...(progress.nextDecisionId === undefined ? {} : { nextDecisionId: progress.nextDecisionId }),
    ...(progress.decisions === undefined ? {} : { decisions: progress.decisions.map(storedDecisionOf) }),
    ...(progress.nextIncidentId === undefined ? {} : { nextIncidentId: progress.nextIncidentId }),
    ...(progress.incidents === undefined ? {} : { incidents: progress.incidents.map(storedIncidentOf) }),
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
