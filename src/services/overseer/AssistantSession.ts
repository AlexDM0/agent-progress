/**
 * The Assistant's turns, design section 8.3: every chat to it is numbered, the first message being chat 1, and the n-th `result` of its
 * session closes chat n's turn. Incidents and User's messages go out only when it is idle; a turn's open incidents default when it closes
 * or spends its call budget; past a context-token count its input closes after the turn; and one that went down is ended, never resumed.
 */
import { readFileSync } from 'node:fs';
import { join }         from 'node:path';

import type { AgentAdapter }                                                 from '../../lib/agent-launch/AgentAdapter.ts';
import { writeFileAtomically }                                               from '../../lib/atomic-file/AtomicFile.ts';
import type { Incident, IncidentDeliveryTurn }                               from '../../lib/tracker-model/@types/Incident.ts';
import type { Job }                                                          from '../../lib/tracker-model/@types/Job.ts';
import type { Board }                                                        from '../../lib/tracker-model/Board.ts';
import { ASSISTANT_CONTEXT_TOKENS_BEFORE_FRESH, ASSISTANT_TURN_CALL_BUDGET } from '../../shared/constants/OverseerLimits.ts';
import { AssistantBoot, FIRST_CHAT_SEQUENCE }                                from './AssistantBoot.ts';
import { WatcherFleet }                                                      from './WatcherFleet.ts';

/** What the Assistant's current session printed so far, read from its event log. */
export interface AssistantReading {
  jobId:                string;
  instance:             number;
  results:              number;
  /** Top-level tool-calling turns since the newest `result`: the open turn's calls. */
  callsSinceLastResult: number;
  /** Of the newest `result`; `null` before one, or when the vendor reports none. */
  lastContextTokens:    number | null;
}

/** A chat past the first message, kept in the job folder: the incidents it delivered, or the number of User's `job message` it carries. */
export interface AssistantChat {
  sequence:      number;
  incidentIds:   readonly string[];
  messageNumber: number | null;
}

/** The incidents of one numbered chat, which the command line words. */
export interface AssistantChatFacts {
  sequence:  number;
  incidents: readonly Readonly<Incident>[];
}

export interface AssistantTurnObservations {
  closedDeliveryTurns:      IncidentDeliveryTurn[];
  budgetSpentDeliveryTurns: IncidentDeliveryTurn[];
  orchestratorHasAnswered:  boolean;
}

export interface AssistantChatDelivery {
  trackerDirectory: string;
  board:            Board;
  adapter:          Pick<AgentAdapter, 'chatLineOf' | 'interruptLineOf'>;
  readings:         readonly AssistantReading[];
  chatTextOf:       (facts: AssistantChatFacts) => string;
}

export interface AssistantQuietWatch {
  /** One sweep: the running Assistants whose cursor stood still mid-turn for `quietSweeps` sweeps, which are down. */
  sweep: (jobs: readonly Readonly<Job>[], midTurnJobIds: readonly string[]) => string[];
}

const CHATS_FILE = 'assistant-chats.json';
const MARKERS_FOLDER = 'assistant-frames';
const DOWN_CAUSE = 'assistant-down';

function liveAssistantsOf(board: Pick<Board, 'jobs'>): readonly Readonly<Job>[] {
  return board.jobs().filter((job) => AssistantBoot.isAssistantJob(job));
}

function readingOf(trackerDirectory: string, adapter: Pick<AgentAdapter, 'eventsOf'>, job: Readonly<Job>): AssistantReading {
  const entries = WatcherFleet.eventsAfter(WatcherFleet.jobFolderOf(trackerDirectory, job.id), job.watcherInstance, 0);
  let results = 0;
  let lastContextTokens: number | null = null;
  let callsSinceLastResult = new Set<string>();
  for (const entry of entries === 'malformed' ? [] : entries.filter((logged) => logged.origin === 'agent')) {
    for (const event of adapter.eventsOf(entry.line)) {
      if (event.kind === 'assistant-turn' && event.parentToolUseId === null) callsSinceLastResult.add(event.messageId);
      if (event.kind !== 'result') continue;
      results += 1;
      lastContextTokens = event.contextTokens;
      callsSinceLastResult = new Set();
    }
  }
  return {
    jobId: job.id, instance: job.watcherInstance, results, callsSinceLastResult: callsSinceLastResult.size, lastContextTokens
  };
}

function readingsOf(trackerDirectory: string, adapter: Pick<AgentAdapter, 'eventsOf'>, board: Pick<Board, 'jobs'>): AssistantReading[] {
  return liveAssistantsOf(board).map((job) => readingOf(trackerDirectory, adapter, job));
}

function chatsOf(trackerDirectory: string, jobId: string): AssistantChat[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(WatcherFleet.jobFolderOf(trackerDirectory, jobId), CHATS_FILE), 'utf8'));
    return Array.isArray(parsed) ? parsed as AssistantChat[] : [];
  } catch {
    return [];
  }
}

function deliveryTurnsOf(board: Pick<Board, 'incidents'>, jobId: string): IncidentDeliveryTurn[] {
  const sequences = new Set(board.incidents().flatMap((incident) => (incident.deliveredInTurn?.jobId === jobId ? [incident.deliveredInTurn.chatSequence] : [])));
  return [...sequences].sort((a, b) => a - b).map((chatSequence) => ({ jobId, chatSequence }));
}

/** The newest chat numbered so far: on the board while it is only decided, in the job folder once its line was written down. */
function newestChatOf(board: Pick<Board, 'incidents'>, chats: readonly AssistantChat[], jobId: string): number {
  return Math.max(FIRST_CHAT_SEQUENCE, ...chats.map((chat) => chat.sequence), ...deliveryTurnsOf(board, jobId).map((turn) => turn.chatSequence));
}

function isIdle(job: Readonly<Job>, reading: AssistantReading | undefined, newestChat: number): boolean {
  return job.state === 'running' && reading !== undefined && reading.instance === job.watcherInstance && reading.results >= newestChat;
}

/**
 * Run in the hold before the lifecycle: an Assistant interrupted (its Watcher lost, its session crashed, a reboot, a usage limit) or quiet
 * mid-turn is ended, `failed` before its first `result` and `replaced` after, and what it was delivered goes out again to the fresh one.
 * Returns whether a boot failed, so no retry boots in the same pass.
 */
function endDownAssistants(board: Board, readings: readonly AssistantReading[], quietJobIds: readonly string[], at: string): { bootFailed: boolean; endedJobs: Readonly<Job>[] } {
  let bootFailed = false;
  const endedJobs: Readonly<Job>[] = [];
  for (const job of liveAssistantsOf(board)) {
    const down = job.state === 'interrupted' || (job.state === 'running' && quietJobIds.includes(job.id));
    if (!down) continue;
    for (const incident of board.incidents().filter((delivered) => delivered.deliveredInTurn?.jobId === job.id)) board.withdrawIncidentDelivery(incident.id);
    const answered = (readings.find((reading) => reading.jobId === job.id)?.results ?? 0) > 0;
    board.endJob(job.id, { outcome: answered ? 'replaced' : 'failed', cause: DOWN_CAUSE }, at);
    bootFailed ||= !answered;
    endedJobs.push(job);
  }
  return { bootFailed, endedJobs };
}

/** What the lifecycle decides the turns' defaults by: turns closed by their `result`, and the open turn once it spent its call budget. */
function turnObservationsOf(board: Pick<Board, 'jobs' | 'incidents'>, readings: readonly AssistantReading[]): AssistantTurnObservations {
  const observations: AssistantTurnObservations = { closedDeliveryTurns: [], budgetSpentDeliveryTurns: [], orchestratorHasAnswered: false };
  for (const job of liveAssistantsOf(board)) {
    const reading = readings.find((candidate) => candidate.jobId === job.id && candidate.instance === job.watcherInstance);
    if (reading === undefined) continue;
    observations.orchestratorHasAnswered ||= reading.results > 0;
    for (const turn of deliveryTurnsOf(board, job.id)) {
      if (reading.results >= turn.chatSequence) observations.closedDeliveryTurns.push(turn);
      else if (turn.chatSequence === reading.results + 1 && reading.callsSinceLastResult >= ASSISTANT_TURN_CALL_BUDGET) observations.budgetSpentDeliveryTurns.push(turn);
    }
  }
  return observations;
}

/**
 * Run in the hold after the lifecycle. An idle Assistant past the context-token count has its input closed, and the next delivery goes to a
 * fresh one; otherwise every undelivered incident goes out as its next numbered chat.
 */
function deliverIncidentsWhenIdle(board: Board, readings: readonly AssistantReading[], trackerDirectory: string, at: string): void {
  for (const job of liveAssistantsOf(board)) {
    const reading = readings.find((candidate) => candidate.jobId === job.id);
    const newestChat = newestChatOf(board, chatsOf(trackerDirectory, job.id), job.id);
    if (!isIdle(job, reading, newestChat)) continue;
    if ((reading?.lastContextTokens ?? 0) >= ASSISTANT_CONTEXT_TOKENS_BEFORE_FRESH) {
      board.moveJob(job.id, 'stopping', at);
      continue;
    }
    for (const incident of board.incidents().filter((open) => open.deliveredInTurn === null)) {
      board.markIncidentDelivered(incident.id, { jobId: job.id, chatSequence: newestChat + 1 });
    }
  }
}

function userMessagesOf(board: Pick<Board, 'logRecordsSoFar'>, jobId: string): { number: number; text: string }[] {
  return board.logRecordsSoFar()
    .filter((record) => record.kind === 'job-messaged' && record.jobId === jobId)
    .map((record, index) => ({ number: index + 1, text: record.kind === 'job-messaged' ? record.fields.text : '' }));
}

/** The chats decided on the board, then one of User's messages if the Assistant is idle, written down before any line is sent. */
function chatsToWriteOf(board: Board, job: Readonly<Job>, reading: AssistantReading | undefined, chats: readonly AssistantChat[]): AssistantChat[] {
  const written = new Set(chats.map((chat) => chat.sequence));
  const deliveredIn = (turn: IncidentDeliveryTurn): string[] => board.incidents()
    .filter((incident) => incident.deliveredInTurn?.chatSequence === turn.chatSequence && incident.deliveredInTurn.jobId === turn.jobId)
    .map((incident) => incident.id);
  const decided = deliveryTurnsOf(board, job.id)
    .filter((turn) => turn.chatSequence > FIRST_CHAT_SEQUENCE && !written.has(turn.chatSequence))
    .map((turn) => ({ sequence: turn.chatSequence, incidentIds: deliveredIn(turn), messageNumber: null }));
  const all = [...chats, ...decided];
  const carried = new Set(all.flatMap((chat) => (chat.messageNumber === null ? [] : [chat.messageNumber])));
  const nextMessage = userMessagesOf(board, job.id).find((message) => !carried.has(message.number));
  const newestChat = newestChatOf(board, all, job.id);
  if (nextMessage === undefined || !isIdle(job, reading, newestChat)) return all;
  return [...all, { sequence: newestChat + 1, incidentIds: [], messageNumber: nextMessage.number }];
}

/**
 * After the hold: each numbered chat as one line, in order, a marker keeping a restart from sending one twice, and the interrupt line once
 * the open turn spent its call budget.
 */
async function deliverChats(request: AssistantChatDelivery): Promise<void> {
  const { board, adapter } = request;
  for (const job of liveAssistantsOf(board).filter((live) => live.state === 'running')) {
    const jobFolder = WatcherFleet.jobFolderOf(request.trackerDirectory, job.id);
    const reading   = request.readings.find((candidate) => candidate.jobId === job.id);
    const earlier   = chatsOf(request.trackerDirectory, job.id);
    const chats     = chatsToWriteOf(board, job, reading, earlier);
    if (chats.length !== earlier.length) writeFileAtomically(join(jobFolder, CHATS_FILE), `${JSON.stringify(chats)}\n`);
    const messages = userMessagesOf(board, job.id);
    for (const chat of chats) {
      const text = chat.messageNumber === null
        ? request.chatTextOf({ sequence: chat.sequence, incidents: board.incidents().filter((incident) => chat.incidentIds.includes(incident.id)) })
        : messages.find((message) => message.number === chat.messageNumber)?.text ?? '';
      const marker = join(jobFolder, MARKERS_FOLDER, `chat-${chat.sequence}`);
      await WatcherFleet.sendFramesOnce(marker, jobFolder, job.watcherInstance, [{ kind: 'write', line: adapter.chatLineOf(text) }]);
    }
    if (reading !== undefined && reading.results < newestChatOf(board, chats, job.id) && reading.callsSinceLastResult >= ASSISTANT_TURN_CALL_BUDGET) {
      const marker = join(jobFolder, MARKERS_FOLDER, `interrupt-${reading.results + 1}`);
      await WatcherFleet.sendFramesOnce(marker, jobFolder, job.watcherInstance, [{ kind: 'write', line: adapter.interruptLineOf() }]);
    }
  }
}

/** The running Assistants with a chat their session has not answered yet. */
function midTurnJobIdsOf(trackerDirectory: string, board: Board, readings: readonly AssistantReading[]): string[] {
  return liveAssistantsOf(board).filter((job) => {
    const reading = readings.find((candidate) => candidate.jobId === job.id);
    return job.state === 'running' && reading !== undefined && reading.results < newestChatOf(board, chatsOf(trackerDirectory, job.id), job.id);
  }).map((job) => job.id);
}

/** In memory, like the build jobs' watch in `src/services/overseer/IncidentRouter.ts`, and for the same reason a clock exception. */
function createAssistantQuietWatch(quietSweeps: number): AssistantQuietWatch {
  const standingByJobId = new Map<string, { cursor: string; sweeps: number }>();
  return {
    sweep: (jobs, midTurnJobIds) => {
      const due: string[] = [];
      const watched = jobs.filter((job) => AssistantBoot.isAssistantJob(job) && job.state === 'running' && midTurnJobIds.includes(job.id));
      for (const jobId of [...standingByJobId.keys()]) {
        if (!watched.some((job) => job.id === jobId)) standingByJobId.delete(jobId);
      }
      for (const job of watched) {
        const cursor   = `${job.watcherInstance}.${job.eventCursor.instance}.${job.eventCursor.sequence}`;
        const standing = standingByJobId.get(job.id);
        const sweeps   = standing?.cursor === cursor ? standing.sweeps + 1 : 0;
        standingByJobId.set(job.id, { cursor, sweeps });
        if (sweeps >= quietSweeps) due.push(job.id);
      }
      return due;
    },
  };
}

export const AssistantSession = Object.freeze({
  readingsOf,
  endDownAssistants,
  turnObservationsOf,
  deliverIncidentsWhenIdle,
  chatsToWriteOf,
  deliverChats,
  midTurnJobIdsOf,
  createAssistantQuietWatch,
});
