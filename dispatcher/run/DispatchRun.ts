/**
 * One dispatcher run's state and its decisions: which work starts next within the board's slots, how each finished agent is settled, and what
 * the run ends with. It does no I/O; it names what happened to its logger and hands each agent's launch to `startAgent` at the point of decision.
 */
import type { TicketPriority }                             from '../../src/lib/tracker-model/@types/Ticket.ts';
import { DEFAULT_AGENT_EFFORT, DEFAULT_AGENT_MODEL }       from '../../src/lib/tracker-model/constants/AgentSettings.ts';
import { LIMITS }                                          from '../../src/shared/constants/Limits.ts';
import { DispatcherClaimNoteUtil }                         from '../../src/shared/utils/DispatcherClaimNoteUtil.ts';
import type { AgentReading, StatusReading, SurveyReading } from '../@types/AgentReadings.ts';
import type { DispatchLogger }                             from '../@types/DispatchLogger.ts';
import type {
  DispatchOutcome,
  HeldEntry,
  ParkReason,
  PassFailure,
  ReviewedRound
} from '../@types/DispatchOutcome.ts';
import type { AgentModelAndEffort, DispatchSettings, ReadyTicketEntry } from '../@types/DispatchSettings.ts';
import type {
  AgentLaunch,
  AgentWork,
  BuildWork,
  DispatchWork,
  FinishedAgent,
  ParkWork,
  ReviewWork,
  RowRelease
} from '../@types/DispatchWork.ts';
import { DISPATCH_POLICY }  from '../constants/DispatchPolicy.ts';
import { RoundVerdictUtil } from '../utils/RoundVerdictUtil.ts';

export interface DispatchRunPorts {
  logger:     DispatchLogger;
  startAgent: (launch: AgentLaunch) => Promise<FinishedAgent>;
}

interface TicketRecord {
  failedPasses:        number;
  mainMovedReleases:   number;
  nextRound:           number;
  rounds:              ReviewedRound[];
  agentModelAndEffort: AgentModelAndEffort;
}

interface OwnAgent {
  work:      DispatchWork;
  finishing: Promise<FinishedAgent>;
}

interface ParkAwaitingTheNextAgent {
  work:   AgentWork;
  reason: ParkReason;
}

type BuildReading = Extract<AgentReading, { kind: 'build' }>;

type ReviewReading = Extract<AgentReading, { kind: 'review' }>;

function defaultAgentModelAndEffort(): AgentModelAndEffort {
  return { model: DEFAULT_AGENT_MODEL, effort: DEFAULT_AGENT_EFFORT };
}

function readyTicketEntryOf(readyTickets: readonly ReadyTicketEntry[], ticketId: string | undefined): ReadyTicketEntry | undefined {
  return readyTickets.find((entry) => entry.id === ticketId);
}

function priorityIsAdmittedWithoutTriage(priority: TicketPriority | undefined): boolean {
  return DISPATCH_POLICY.PRIORITIES_ADMITTED_WITHOUT_TRIAGE.some((admittedPriority) => admittedPriority === priority);
}

// A block without a ready ticket's entry reads it as `DISPATCH_POLICY.UNSTATED_PRIORITY`.
function lowPriorityReadyTicketIdsOf(status: StatusReading): Set<string> {
  return new Set(status.readyTicketIds.filter((ticketId) => !priorityIsAdmittedWithoutTriage(readyTicketEntryOf(status.readyTickets, ticketId)?.priority)));
}

// A held takeover's row is released while it waits, so the step that resumes it has no bar handed on to find.
function heldCopyOf(work: AgentWork, rowIsPaused: boolean): AgentWork {
  if (work.kind === 'build') return rowIsPaused ? { ...work, rowIsPaused: true } : { ...work };
  const { barIsHandedOn, ...waitingReview } = work;
  return rowIsPaused ? { ...waitingReview, rowIsPaused: true } : waitingReview;
}

export class DispatchRun {
  private readonly settings:                DispatchSettings;
  private readonly ports:                   DispatchRunPorts;
  private readonly ticketRecords:           Map<string, TicketRecord> = new Map();
  private readonly reviewQueue:             ReviewWork[] = [];
  private readonly rebuildQueue:            BuildWork[] = [];
  private readonly takeoversWaiting:        Map<string, AgentWork> = new Map();
  private readonly ticketIdsTakenThisRun:   Set<string> = new Set();
  private readonly inFlight:                Map<number, OwnAgent> = new Map();
  private readonly delivered:               string[] = [];
  private readonly parked:                  { ticketId: string; reason: ParkReason }[] = [];
  private readonly findingsFiled:           string[] = [];
  private agentsRun:                        number = 0;
  private launchCount:                      number = 0;
  private latestStatusReading:              StatusReading | null = null;
  private othersInFlightAtStatusReading:    number = 0;
  private runWasStoppedByBoard:             boolean = false;
  private runWasStoppedByFailures:          boolean = false;
  private consecutiveDeadAgents:            number = 0;
  // The tickets whose failed pass a dead agent of the current run of deaths counted, taken back once that run turns out to be an outage.
  private failedPassesOfConsecutiveDeaths:  string[] = [];
  private parksAwaitingTheNextAgent:        ParkAwaitingTheNextAgent[] = [];
  // What `ticket show --json` said of a single-ticket run's tickets its arguments carried no `readyTickets` entry for.
  private lookedUpTicketSettings:           ReadyTicketEntry[] = [];
  private lowPriorityReadyTicketIds:        Set<string> = new Set();
  private heldTicketIds:                    Set<string>;
  private readonly heldWork:                Map<string, AgentWork> = new Map();
  // In-progress tickets whose build an earlier dispatcher run left paused, found by the survey, resumed ahead of new tickets.
  private readonly resumablePausedBuildIds: string[] = [];
  private readonly pausedBuildTicketIds:    Set<string> = new Set();
  private readonly pausedBuildPriorities:   Map<string, TicketPriority> = new Map();
  private readonly pausedBuildsLeft:        string[] = [];
  private rowsToRelease:                    AgentWork[] = [];

  constructor(settings: DispatchSettings, ports: DispatchRunPorts) {
    this.settings = settings;
    this.ports    = ports;
    // A single-ticket run reads no board before its builder starts, so its arguments' entries seed the set.
    this.heldTicketIds = new Set(settings.readyTickets.filter((entry) => entry.ticketIsHeld).map((entry) => entry.id));
  }

  recordSurveyAgentStarted(): void {
    this.agentsRun++;
  }

  // An in-progress ticket, a paused build resumed after an unhold, has no `readyTickets` entry to copy, and running it on the defaults drops its pair.
  ticketIdsWithoutStatedSettings(): string[] {
    if (this.settings.ticketIds === null) return [];
    return this.settings.ticketIds.filter((ticketId) => readyTicketEntryOf(this.settings.readyTickets, ticketId) === undefined);
  }

  adoptLookedUpTicketSettings(lookup: ReadyTicketEntry[] | 'unread', ticketIds: readonly string[]): void {
    if (lookup !== 'unread') this.lookedUpTicketSettings = lookup;
    else this.ports.logger.ticketSettingsUnread(ticketIds);
  }

  adoptSurvey(survey: SurveyReading | null): 'ready-to-dispatch' | 'nothing-dispatched' {
    if (survey === null) {
      this.ports.logger.surveyReturnedNothing();
      return 'nothing-dispatched';
    }
    this.adoptStatusReading(survey.status);
    if (this.latestStatusReading === null) {
      this.ports.logger.surveyStatusUnreadable();
      return 'nothing-dispatched';
    }
    // The frozen trace table pins a crash here, after the same log lines, when the survey lists no reviews waiting.
    if (survey.reviewWaitingTickets === 'unlisted') throw new TypeError('The survey returned no list of reviews waiting.');
    for (const reviewWaitingTicket of survey.reviewWaitingTickets) {
      this.ticketIdsTakenThisRun.add(reviewWaitingTicket.id);
      this.ticketRecordFor(reviewWaitingTicket.id).agentModelAndEffort = reviewWaitingTicket.agentModelAndEffort;
      this.queueReview(reviewWaitingTicket.id, false);
    }
    for (const pausedBuild of survey.pausedBuilds) {
      if (!DispatcherClaimNoteUtil.noteIsADispatcherClaimOn(pausedBuild.note, pausedBuild.id)) continue;
      this.resumablePausedBuildIds.push(pausedBuild.id);
      this.pausedBuildTicketIds.add(pausedBuild.id);
      this.pausedBuildPriorities.set(pausedBuild.id, pausedBuild.priority);
      this.ticketRecordFor(pausedBuild.id).agentModelAndEffort = pausedBuild.agentModelAndEffort;
    }
    return 'ready-to-dispatch';
  }

  startWorkWithinSlots(): void {
    const slotLimit = this.ownSlotLimit();
    while (!this.runIsStopped() && this.inFlight.size + this.parksAwaitingTheNextAgent.length < slotLimit) {
      const work = this.nextWork();
      if (work === null) break;
      this.launch(work);
    }
  }

  agentsInFlight(): Promise<FinishedAgent>[] {
    return [...this.inFlight.values()].map((ownAgent) => ownAgent.finishing);
  }

  settleFinished(finished: FinishedAgent): void {
    this.inFlight.delete(finished.key);
    this.noteWhetherTheAgentDied(finished.reading);
    // Settled first, so a row this agent left running is a takeover or being parked by the time its own status block is read.
    if (finished.reading === null && this.runWasStoppedByFailures) this.settleDeadAgentOfAStoppedRun(finished.work);
    else this.settle(finished);
    if (finished.reading !== null) this.adoptStatusReading(finished.reading.status);
  }

  // With no agent left to settle, nothing can show a park waiting for one to have been an outage's.
  carryOutParksAwaitingTheNextAgent(): void {
    const awaiting = this.parksAwaitingTheNextAgent;
    this.parksAwaitingTheNextAgent = [];
    for (const { work, reason } of awaiting) this.park(work.ticketId, reason);
  }

  // A takeover still waiting here never starts in this run, a stop or others holding the limit kept it out, so its row is released like a parked one.
  setAsideRowsToRelease(): boolean {
    this.rowsToRelease = [...this.takeoversWaiting.values()];
    return this.rowsToRelease.length > 0 || this.inFlight.size > 0;
  }

  // No agent just finished for a parking agent to replace here, so it starts only within a free slot: it is an agent, and the limit counts it.
  releaseRowsWithinSlots(): void {
    while (this.rowsToRelease.length > 0 && this.inFlight.size < this.ownSlotLimit()) {
      const rowToRelease = this.rowsToRelease.shift();
      if (rowToRelease === undefined) break;
      if (rowToRelease.kind === 'build') this.pausedBuildsLeft.push(rowToRelease.ticketId);
      this.releaseRowsOf(rowToRelease.ticketId, { cause: 'left-for-the-go' });
    }
  }

  noteRowsLeftRunning(): void {
    if (this.rowsToRelease.length > 0) this.ports.logger.rowsLeftRunning(this.rowsToRelease.map((takeover) => takeover.ticketId));
  }

  closeTheRun(): void {
    const leftWaiting = [
      ...[...this.takeoversWaiting.values()].map((takeover) => takeover.ticketId),
      ...this.reviewQueue.map((review) => review.ticketId),
      ...this.rebuildQueue.map((rebuild) => rebuild.ticketId),
      ...this.admittedPausedBuildIds(),
      ...this.untakenTicketIds(),
    ];
    // A paused build this run found and never started stays paused, for the next run's survey like the ones it paused itself, and so does a held
    // takeover whose row the hold paused when the hold was lifted too late for it to start.
    const unheldBuildsWithPausedRows = this.rebuildQueue
      .filter((rebuild) => rebuild.rowIsPaused === true && !this.ticketIsHeld(rebuild.ticketId))
      .map((rebuild) => rebuild.ticketId);
    this.pausedBuildsLeft.push(...[...unheldBuildsWithPausedRows, ...this.untakenPausedBuildIds()].filter((ticketId) => !this.pausedBuildsLeft.includes(ticketId)));
    const leftWaitingUnheld = leftWaiting.filter((ticketId) => !this.ticketIsHeld(ticketId));
    if (leftWaitingUnheld.length > 0) this.ports.logger.ticketsLeftWaiting(leftWaitingUnheld, this.runIsStopped());
    const lowPriorityWaiting = this.lowPriorityWaitingIds();
    if (lowPriorityWaiting.length > 0) this.ports.logger.lowPriorityLeftForTriage(lowPriorityWaiting);
    const heldAtEnd = this.heldEntries();
    if (heldAtEnd.length > 0) this.ports.logger.heldAtEnd(heldAtEnd);
    this.ports.logger.runDone(this.delivered.length, this.parked.map((parkedTicket) => parkedTicket.ticketId), this.findingsFiled.length, this.agentsRun);
  }

  outcome(): DispatchOutcome {
    return {
      delivered:               this.delivered,
      parked:                  this.parked,
      findingsFiled:           this.findingsFiled,
      agentsRun:               this.agentsRun,
      runWasStoppedByBoard:    this.runWasStoppedByBoard,
      runWasStoppedByFailures: this.runWasStoppedByFailures,
      lowPriorityWaiting:      this.lowPriorityWaitingIds(),
      held:                    this.heldEntries(),
      pausedBuilds:            this.pausedBuildsLeft,
      reviewsLeft:             this.reviewsLeftIds(),
    };
  }

  private ticketRecordFor(ticketId: string): TicketRecord {
    const existingRecord = this.ticketRecords.get(ticketId);
    if (existingRecord !== undefined) return existingRecord;
    const record: TicketRecord = {
      failedPasses:        0,
      mainMovedReleases:   0,
      nextRound:           1,
      rounds:              [],
      agentModelAndEffort: defaultAgentModelAndEffort(),
    };
    this.ticketRecords.set(ticketId, record);
    return record;
  }

  private ticketIsHeld(ticketId: string): boolean {
    return this.heldTicketIds.has(ticketId);
  }

  private readyTicketIsAdmitted(ticketId: string): boolean {
    return this.settings.lowPriorityIsIncluded || !this.lowPriorityReadyTicketIds.has(ticketId);
  }

  // Like a ready ticket's, a priority the survey did not state reads as `DISPATCH_POLICY.UNSTATED_PRIORITY`.
  private pausedBuildIsAdmitted(ticketId: string): boolean {
    return this.settings.lowPriorityIsIncluded || priorityIsAdmittedWithoutTriage(this.pausedBuildPriorities.get(ticketId));
  }

  private priorityRankOf(priority: TicketPriority | undefined): number {
    const rank = DISPATCH_POLICY.PRIORITIES_IN_ORDER.findIndex((priorityInOrder) => priorityInOrder === priority);
    return rank === -1 ? DISPATCH_POLICY.PRIORITIES_IN_ORDER.length - 1 : rank;
  }

  private lowPriorityWaitingIds(): string[] {
    if (this.latestStatusReading === null || this.settings.ticketIds !== null) return [];
    return [
      ...this.untakenPausedBuildIds().filter((ticketId) => !this.pausedBuildIsAdmitted(ticketId)),
      ...this.latestStatusReading.readyTicketIds.filter((ticketId) => !this.ticketIdsTakenThisRun.has(ticketId) && !this.readyTicketIsAdmitted(ticketId)),
    ];
  }

  // A review whose bar was released at the end, or that never started, waits for the next run's survey; a held one is named under `held` instead.
  private reviewsLeftIds(): string[] {
    const reviewsLeft = [...this.takeoversWaiting.values(), ...this.reviewQueue].filter((work) => work.kind === 'review' && !this.ticketIsHeld(work.ticketId));
    return [...new Set(reviewsLeft.map((review) => review.ticketId))];
  }

  // A builder is on the board from its claim, a reviewer from its bar; a status block without the rows confirms nothing, except a bar handed on: the
  // one a builder's `in-review` or a reviewer's call for another round says was left running, which only a block listing the rows can contradict.
  // A parking agent never is on the board, so the row it is pausing counts as another's until it returns: the safe side, for the few turns it runs.
  private ownAgentIsConfirmedByStatus(work: DispatchWork, status: StatusReading): boolean {
    if (work.kind === 'park') return false;
    const confirmingTicketIds = work.kind === 'build' ? status.inProgressTicketIds : status.inProgressReviewOfIds;
    if (confirmingTicketIds === 'unlisted') return work.kind === 'review' && work.barIsHandedOn === true;
    return confirmingTicketIds.includes(work.ticketId);
  }

  private takeoverKeyOf(work: AgentWork): string {
    return `${work.kind} ${work.ticketId}`;
  }

  // An agent that stopped short left its row running, and the fresh agent for the same work takes that row over rather than adding one.
  private awaitTakeover(work: AgentWork): void {
    this.takeoversWaiting.set(this.takeoverKeyOf(work), work);
  }

  private takeoversConfirmedByStatus(status: StatusReading): AgentWork[] {
    return [...this.takeoversWaiting.values()].filter((takeover) => this.ownAgentIsConfirmedByStatus(takeover, status));
  }

  // Only an own agent whose row the board shows is subtracted: one that has not run its first command yet is not in `agentsInFlight`, and
  // subtracting it too would read a real other agent's slot as free. A row left running for a takeover is the dispatcher's own, not another's.
  private adoptStatusReading(status: StatusReading | 'unreadable'): void {
    if (status === 'unreadable') return;
    this.latestStatusReading       = status;
    this.lowPriorityReadyTicketIds = lowPriorityReadyTicketIdsOf(status);
    // A block without the list keeps the last held set read: a lifted hold is acted on only once a block shows it lifted.
    if (status.heldTicketIds !== 'unlisted') this.heldTicketIds = new Set(status.heldTicketIds);
    this.resumeUnheldWork();
    const ownAgentsConfirmedByStatus = [...this.inFlight.values()].filter((ownAgent) => this.ownAgentIsConfirmedByStatus(ownAgent.work, status)).length
      + this.takeoversConfirmedByStatus(status).length;
    this.othersInFlightAtStatusReading = Math.max(0, status.agentsInFlight - ownAgentsConfirmedByStatus);
    // A stop is final for this run: the agents in flight finish and are settled, and nothing new starts until the user's go launches a new run.
    if (status.dispatcherIsStopped && !this.runWasStoppedByBoard) {
      this.runWasStoppedByBoard = true;
      this.ports.logger.statusShowsTheRunStopped(this.inFlight.size);
    }
  }

  // Every own agent counts against the slots, on the board yet or not; the ceiling holds whatever limit the board states. A single-ticket run is
  // one agent's work, and its builder's claim is what the board's limit refuses.
  private ownSlotLimit(): number {
    if (this.settings.ticketIds !== null) return DISPATCH_POLICY.SINGLE_TICKET_RUN_AGENTS;
    const statedLimit = this.latestStatusReading?.limit ?? 0;
    return Math.max(0, Math.min(statedLimit, LIMITS.CONCURRENCY_LIMIT_CEILING_AGENTS) - this.othersInFlightAtStatusReading);
  }

  private untakenTicketIds(): string[] {
    if (this.settings.ticketIds !== null) return this.settings.ticketIds.filter((ticketId) => !this.ticketIdsTakenThisRun.has(ticketId) && !this.ticketIsHeld(ticketId));
    const readyTicketIds = this.latestStatusReading?.readyTicketIds ?? [];
    return readyTicketIds.filter((ticketId) => !this.ticketIsHeld(ticketId) && !this.ticketIdsTakenThisRun.has(ticketId) && this.readyTicketIsAdmitted(ticketId));
  }

  private heldUntakenTicketIds(): string[] {
    const candidates = this.settings.ticketIds ?? (this.latestStatusReading === null ? [] : [...this.resumablePausedBuildIds, ...this.latestStatusReading.readyTicketIds]);
    return candidates.filter((ticketId) => !this.ticketIdsTakenThisRun.has(ticketId) && this.ticketIsHeld(ticketId));
  }

  private untakenPausedBuildIds(): string[] {
    return this.resumablePausedBuildIds.filter((ticketId) => !this.ticketIdsTakenThisRun.has(ticketId) && !this.ticketIsHeld(ticketId));
  }

  // Highest priority first, the survey's order within one; stable, as `sort` is.
  private admittedPausedBuildIds(): string[] {
    return this.untakenPausedBuildIds()
      .filter((ticketId) => this.pausedBuildIsAdmitted(ticketId))
      .sort((a, b) => this.priorityRankOf(this.pausedBuildPriorities.get(a)) - this.priorityRankOf(this.pausedBuildPriorities.get(b)));
  }

  private holdBack(work: AgentWork, rowIsPaused: boolean): void {
    this.heldWork.set(work.ticketId, heldCopyOf(work, rowIsPaused));
    this.ports.logger.ticketHeld(work.ticketId, work.kind);
  }

  // Front of the queue, as a takeover would have gone first: the step was due when the hold stopped it.
  private resumeUnheldWork(): void {
    for (const [ticketId, work] of this.heldWork) {
      if (this.ticketIsHeld(ticketId)) continue;
      this.heldWork.delete(ticketId);
      this.ports.logger.ticketUnheld(ticketId, work.kind);
      if (work.kind === 'review') this.reviewQueue.unshift(work);
      else this.rebuildQueue.unshift(work);
    }
  }

  // A step still queued when the run ends is listed too: a stop can end the run before the step's turn came round to find the hold.
  private heldEntries(): HeldEntry[] {
    const heldSteps = [...this.heldWork.values(), ...this.takeoversWaiting.values(), ...this.reviewQueue, ...this.rebuildQueue]
      .filter((work) => this.ticketIsHeld(work.ticketId));
    return [
      ...heldSteps.map((work): HeldEntry => ({ ticketId: work.ticketId, waitingFor: work.kind })),
      ...this.heldUntakenTicketIds().map((ticketId): HeldEntry => ({ ticketId, waitingFor: 'build' })),
    ];
  }

  // A single-ticket run was never surveyed: what the board said of its tickets came in with its arguments.
  private readyTicketsStatement(): ReadyTicketEntry[] {
    if (this.settings.ticketIds === null) return this.latestStatusReading?.readyTickets ?? [];
    return [...this.settings.readyTickets, ...this.lookedUpTicketSettings];
  }

  private runIsStopped(): boolean {
    return this.runWasStoppedByBoard || this.runWasStoppedByFailures;
  }

  private releaseRowsOf(ticketId: string, release: RowRelease): void {
    this.launch({ kind: 'park', ticketId, release });
  }

  // A row nobody works on would be counted against the limit by every builder's claim, so the parking agent starts at once, in the slot of the agent
  // that just finished: the dispatcher's agents alive stay as many as a moment before.
  private park(ticketId: string, reason: ParkReason): void {
    this.parked.push({ ticketId, reason });
    this.ports.logger.ticketParked(ticketId, reason);
    this.releaseRowsOf(ticketId, { cause: 'parked', parkReason: reason });
  }

  private reviewWorkFor(ticketId: string, rereviewRunsFirst: boolean, earlierReviewerDied: boolean): ReviewWork {
    return {
      kind:  'review',
      ticketId,
      round: this.ticketRecordFor(ticketId).nextRound,
      rereviewRunsFirst,
      earlierReviewerDied,
    };
  }

  private queueReview(ticketId: string, rereviewRunsFirst: boolean): void {
    this.reviewQueue.push(this.reviewWorkFor(ticketId, rereviewRunsFirst, false));
  }

  // A reviewer asking for another round leaves its bar running for the next one's `rereview --start-review`, so the slot never shows free between them.
  private takeOverTheBarLeftForTheNextRound(ticketId: string): void {
    this.awaitTakeover({ ...this.reviewWorkFor(ticketId, true, false), barIsHandedOn: true });
  }

  // A death may be the first of an outage, so a park it causes waits, holding the dead agent's slot, for the next of the agents in flight to settle.
  // With none in flight nothing would settle to show it, and at a limit of 1 the held slot would stop the run.
  private countFailedPass(ticketId: string, failure: PassFailure, retry: () => void, deadAgentWork: AgentWork | null = null): void {
    const record = this.ticketRecordFor(ticketId);
    record.failedPasses++;
    if (record.failedPasses >= DISPATCH_POLICY.FAILED_PASSES_BEFORE_PARKING) {
      const reason: ParkReason = { cause: 'second-failed-pass', failure };
      if (deadAgentWork === null || this.inFlight.size === 0) this.park(ticketId, reason);
      else this.parksAwaitingTheNextAgent.push({ work: deadAgentWork, reason });
      return;
    }
    this.ports.logger.freshAgentTakesOver(ticketId, failure);
    retry();
  }

  // A takeover goes first: until it starts, its row is on the board and counted as the dispatcher's own, beside every agent it has in flight.
  // Then reviews waiting: a built ticket holds a worktree and a finished pass, a new ticket holds nothing yet.
  // A held ticket's pending step waits in `heldWork` instead, and the queue moves on to the next ticket's.
  private nextWork(): DispatchWork | null {
    for (;;) {
      const [takeover] = this.takeoversWaiting.values();
      if (takeover !== undefined) {
        this.takeoversWaiting.delete(this.takeoverKeyOf(takeover));
        if (!this.ticketIsHeld(takeover.ticketId)) return takeover;
        this.holdBack(takeover, true);
        // Its row is left running and would hold a slot for as long as the hold lasts, so a parking agent releases it in the slot the takeover
        // would have taken.
        return { kind: 'park', ticketId: takeover.ticketId, release: { cause: 'held' } };
      }
      const review = this.reviewQueue.shift();
      const queued = review ?? this.rebuildQueue.shift();
      if (queued === undefined) break;
      if (!this.ticketIsHeld(queued.ticketId)) return queued;
      this.holdBack(queued, false);
    }
    // A paused build already holds a worktree and a pass's work, so it goes before a ready ticket of the same priority, never one of a higher.
    const [pausedBuildId] = this.admittedPausedBuildIds();
    const [readyTicketId] = this.untakenTicketIds();
    const readyTicketPriority = readyTicketEntryOf(this.readyTicketsStatement(), readyTicketId)?.priority;
    if (pausedBuildId !== undefined
      && (readyTicketId === undefined || this.priorityRankOf(this.pausedBuildPriorities.get(pausedBuildId)) <= this.priorityRankOf(readyTicketPriority))) {
      this.ticketIdsTakenThisRun.add(pausedBuildId);
      return { kind: 'build', ticketId: pausedBuildId, previousPass: 'paused' };
    }
    if (readyTicketId === undefined) return null;
    this.ticketIdsTakenThisRun.add(readyTicketId);
    // Taken, the ticket leaves the ready list, so every later pass and round runs on what the board stated for it now.
    this.ticketRecordFor(readyTicketId).agentModelAndEffort = readyTicketEntryOf(this.readyTicketsStatement(), readyTicketId)?.agentModelAndEffort ?? defaultAgentModelAndEffort();
    return { kind: 'build', ticketId: readyTicketId, previousPass: null };
  }

  private launch(work: DispatchWork): void {
    const key = this.launchCount++;
    this.agentsRun++;
    const finishing = this.ports.startAgent(this.launchOf(key, work));
    this.inFlight.set(key, { work, finishing });
  }

  private launchOf(key: number, work: DispatchWork): AgentLaunch {
    if (work.kind === 'park') return { key, work };
    return {
      key,
      work,
      agentModelAndEffort:         this.ticketRecordFor(work.ticketId).agentModelAndEffort,
      pausedBuildWasFoundBySurvey: this.pausedBuildTicketIds.has(work.ticketId),
    };
  }

  private settle(finished: FinishedAgent): void {
    const { work, reading } = finished;
    if (work.kind === 'build') this.settleBuild(work, reading?.kind === 'build' ? reading : null);
    else if (work.kind === 'park') this.settleParking(work, reading);
    else this.settleReview(work, reading?.kind === 'review' ? reading : null);
  }

  private settleBuild(work: BuildWork, reading: BuildReading | null): void {
    const { ticketId } = work;
    // A builder that stopped short of `ticket finish` left its claimed row running.
    const rebuild = (): void => { this.awaitTakeover({ kind: 'build', ticketId, previousPass: 'builder' }); };
    if (reading === null) {
      this.countFailedPass(ticketId, { cause: 'builder-returned-nothing' }, rebuild, work);
      this.failedPassesOfConsecutiveDeaths.push(ticketId);
      return;
    }
    // A row carrying this run's claim note is this run's own claim, made by an attempt the runtime restarted: skipped, that row would be read as another
    // agent's and hold a slot for the rest of the run. Another run's claim on the ticket carries that run's note, and is skipped like any refusal.
    if (reading.outcome === 'claim-refused' && reading.claimNote === DispatcherClaimNoteUtil.claimNoteFor(this.settings.runLabel, ticketId)) {
      this.countFailedPass(ticketId, { cause: 'own-claim-refused', detail: reading.detail }, rebuild);
      return;
    }
    if (reading.outcome === 'claim-refused') {
      this.ports.logger.ticketSkipped(ticketId, reading.detail);
      return;
    }
    if (reading.outcome === 'failed') {
      this.countFailedPass(ticketId, { cause: 'builder-stopped-short', detail: reading.detail }, rebuild);
      return;
    }
    // The builder's `--start-review` left the reviewer's bar running, so the reviewer takes it over like any row this run left running.
    this.awaitTakeover({ ...this.reviewWorkFor(ticketId, false, false), barIsHandedOn: true });
  }

  private settleReview(work: ReviewWork, reading: ReviewReading | null): void {
    const { ticketId } = work;
    const record = this.ticketRecordFor(ticketId);
    if (reading === null) {
      record.nextRound = work.round + 1;
      this.countFailedPass(ticketId, { cause: 'reviewer-returned-nothing' }, () => { this.awaitTakeover(this.reviewWorkFor(ticketId, true, true)); }, work);
      this.failedPassesOfConsecutiveDeaths.push(ticketId);
      return;
    }
    this.findingsFiled.push(...reading.filedTicketIds);
    const round = reading.round === 'unstated' ? work.round : reading.round;
    record.rounds.push({ round, findings: reading.findings });
    record.nextRound = round + 1;
    if (reading.verdict === 'released') {
      this.delivered.push(ticketId);
      return;
    }
    if (reading.verdict === 'does-not-hold') {
      this.countFailedPass(ticketId, { cause: 'review-does-not-hold' }, () => { this.rebuildQueue.push({ kind: 'build', ticketId, previousPass: 'review' }); });
      return;
    }
    if (reading.verdict === 'not-released') {
      if (reading.releaseRefusal !== 'main-moved') {
        this.park(ticketId, { cause: 'release-refused', statedReason: reading.releaseRefusal.statedReason });
        return;
      }
      record.mainMovedReleases++;
      if (record.mainMovedReleases >= DISPATCH_POLICY.MAIN_MOVED_RELEASES_BEFORE_PARKING) {
        this.park(ticketId, { cause: 'main-line-moved', releases: record.mainMovedReleases });
        return;
      }
      this.ports.logger.mainLineMovedUnderRelease(ticketId, record.nextRound);
      this.takeOverTheBarLeftForTheNextRound(ticketId);
      return;
    }
    const verdict = RoundVerdictUtil.nextRoundVerdictOf(record.rounds, { round, findings: reading.findings, reworkedLines: reading.reworkedLines });
    if (!verdict.granted) {
      this.park(ticketId, { cause: 'round-refused', refusal: verdict.refusal });
      return;
    }
    this.ports.logger.roundGranted(ticketId, record.nextRound, reading.reworkedLines);
    this.takeOverTheBarLeftForTheNextRound(ticketId);
  }

  private settleParking(work: ParkWork, reading: AgentReading | null): void {
    if (reading === null) this.ports.logger.parkingAgentReturnedNothing(work.ticketId);
  }

  private noteWhetherTheAgentDied(reading: AgentReading | null): void {
    if (reading !== null) {
      this.consecutiveDeadAgents           = 0;
      this.failedPassesOfConsecutiveDeaths = [];
      this.carryOutParksAwaitingTheNextAgent();
      return;
    }
    this.consecutiveDeadAgents++;
    if (this.consecutiveDeadAgents < DISPATCH_POLICY.CONSECUTIVE_DEAD_AGENTS_BEFORE_STOPPING || this.runWasStoppedByFailures) return;
    this.runWasStoppedByFailures = true;
    for (const ticketId of this.failedPassesOfConsecutiveDeaths) this.ticketRecordFor(ticketId).failedPasses--;
    this.failedPassesOfConsecutiveDeaths = [];
    const cancelledParks = this.parksAwaitingTheNextAgent;
    this.parksAwaitingTheNextAgent = [];
    for (const { work } of cancelledParks) this.settleDeadAgentOfAStoppedRun(work);
    this.ports.logger.agentsDiedInARow(this.consecutiveDeadAgents, this.inFlight.size);
  }

  // Not a failed pass: its row is left for the release at the end of the run, like a takeover a stop kept from starting.
  private settleDeadAgentOfAStoppedRun(work: DispatchWork): void {
    if (work.kind === 'park') {
      this.settleParking(work, null);
      return;
    }
    if (work.kind === 'build') {
      this.awaitTakeover({ kind: 'build', ticketId: work.ticketId, previousPass: 'builder' });
      return;
    }
    this.ticketRecordFor(work.ticketId).nextRound = work.round + 1;
    this.awaitTakeover(this.reviewWorkFor(work.ticketId, true, true));
  }
}
