/**
 * The tracker's aggregate for one invocation and the one domain class callers use: the compound changes to rows and tickets, the queries
 * over them, and which tickets it changed. It does no I/O, logs through the `Logger` and refuses with a `BoardRefusal`; it changes the
 * records it was handed in place. Each rule lives in the module beside it that the method hands it to.
 */
import type {
  AgentChoice,
  AgentStopRecorded,
  ConcurrencyLimitSet,
  DispatcherStateSet,
  DraftChanged,
  DraftClaimChanged,
  EpicChanged,
  EpicEdited,
  DecisionAnswered,
  DecisionClosed,
  DecisionOpened,
  IncidentClosed,
  IncidentEscalated,
  IncidentOpened,
  JobChanged,
  LifecycleAdvanced,
  Logged,
  PipelineChanged,
  ReviewBarRequest,
  ReviewBarStarted,
  ReviewRecorded,
  ReviewRecording,
  TaskAddition,
  TaskAnnotation,
  TaskCorrection,
  TicketChanged,
  TicketClaim,
  TicketDependenciesChanged,
  TicketEpicsChanged,
  TicketMoved,
  TicketMoveRequest,
  TicketRelease,
  TicketsClaimed,
  TicketsReadied,
  TicketsReleased,
  TokenCredit,
  TrackerCleared
}                                                           from './@types/BoardChanges.ts';
import type { Concurrency, DispatchCapacity }                 from './@types/Concurrency.ts';
import type { Decision, DecisionAnswerForm, DecisionOpening } from './@types/Decision.ts';
import type {
  Draft,
  DraftNoteAddition,
  DraftOpening,
  DraftQuestionAsking,
  DraftState,
  DraftSummary
}                                                           from './@types/Draft.ts';
import type {
  Epic,
  EpicAddition,
  EpicEdit,
  EpicRollup
}                                                           from './@types/Epic.ts';
import type {
  Incident,
  IncidentDefaultCause,
  IncidentDeliveryTurn,
  IncidentMove,
  IncidentOpening
}                                              from './@types/Incident.ts';
import type {
  InterruptionCause,
  Job,
  JobEnding,
  JobEventCursor,
  JobLaunch,
  JobStopMode,
  MergeSlot,
  RunnerStopReason
}                                              from './@types/Job.ts';
import type { LifecycleLimits } from './@types/LifecycleLimits.ts';
import type {
  DecisionDraft,
  DecisionWording,
  LifecycleObservations,
  LifecycleStep
}                                              from './@types/LifecycleStep.ts';
import type { AgentUsage, LogRecord, LogRecordFieldsOf } from './@types/LogRecord.ts';
import type { Pipeline, PipelineGate, PipelineStep }     from './@types/Pipeline.ts';
import type { DisplayState, Task, TaskStatus }           from './@types/Task.ts';
import type {
  ReadinessGap,
  ReadyTicket,
  Ticket,
  TicketPriority,
  TicketSize,
  TicketStatus
}                                                         from './@types/Ticket.ts';
import type { DispatcherState, TrackerProgress, ViewRange } from './@types/TrackerProgress.ts';
import { AgentQuestions }                                   from './AgentQuestions.ts';
import { BoardRecords }                                     from './BoardRecords.ts';
import { BoardRefusal }                                     from './BoardRefusal.ts';
import { Decisions }                                        from './Decisions.ts';
import { DispatchQueries }                                  from './DispatchQueries.ts';
import { DisplayQueries }                                   from './DisplayQueries.ts';
import { DraftContents }                                    from './DraftContents.ts';
import { Drafts }                                           from './Drafts.ts';
import { Epics }                                            from './Epics.ts';
import { GroupReleases }                                    from './GroupReleases.ts';
import { IncidentMoves }                                    from './IncidentMoves.ts';
import type { IncidentEscalation }                          from './Incidents.ts';
import { Incidents }                                        from './Incidents.ts';
import { JobControls }                                      from './JobControls.ts';
import type { SteppedJobState }                             from './Jobs.ts';
import { Jobs }                                             from './Jobs.ts';
import type { LifecycleFacts }                              from './LifecyclePolicy.ts';
import { LifecyclePolicy }                                  from './LifecyclePolicy.ts';
import type { Logger }                                      from './Logger.ts';
import { MergeQueueMarks }                                  from './MergeQueueMarks.ts';
import {
  type MergeCandidate,
  type MergeLanding,
  MergeSlotClaims,
  type MergeSlotClaim,
  type MergeTargetOf,
  type RefreshSlotClaim
}                                                         from './MergeSlotClaims.ts';
import { ReviewBars }                    from './ReviewBars.ts';
import type { ReviewStatisticsReport }   from './ReviewStatistics.ts';
import { ReviewStatistics }              from './ReviewStatistics.ts';
import { TaskRows }                      from './TaskRows.ts';
import { TicketClaims }                  from './TicketClaims.ts';
import { TicketDependencies }            from './TicketDependencies.ts';
import type { TicketEdit, TicketEdited } from './TicketEdits.ts';
import { TicketEdits }                   from './TicketEdits.ts';
import { TicketLinks }                   from './TicketLinks.ts';
import { TicketMoves }                   from './TicketMoves.ts';
import { TicketSettings }                from './TicketSettings.ts';
import { TokenCredits }                  from './TokenCredits.ts';
import { TrackerChanges }                from './TrackerChanges.ts';
import { PARKED_HOLD_PREFIX }            from './constants/DecisionAndIncidentVocabulary.ts';
import { PipelineUtil }                  from './utils/PipelineUtil.ts';

export interface BoardInput {
  progress:          TrackerProgress;
  tickets:           Ticket[];
  epics:             Epic[];
  /** Absent for a caller that reads no drafts, which reads as none. */
  drafts?:           Draft[];
  logger:            Logger;
  /** The log as stored, which orders the ready tickets by readiness; absent reads as an empty log. */
  storedLogRecords?: readonly LogRecord[];
  /** The stored pipeline; absent or `null` when none is stored or it could not be read, which reads as no gates set. */
  pipeline?:         Pipeline | null;
}

export class Board {
  private readonly records: BoardRecords;

  private readonly trackerChanges: TrackerChanges;

  private readonly taskRows: TaskRows;

  private readonly tokenCredits: TokenCredits;

  private readonly ticketMoves: TicketMoves;

  private readonly ticketDependencies: TicketDependencies;

  private readonly ticketLinks: TicketLinks;

  private readonly ticketSettings: TicketSettings;

  private readonly ticketClaims: TicketClaims;

  private readonly ticketEdits: TicketEdits;

  private readonly groupReleases: GroupReleases;

  private readonly reviewBars: ReviewBars;

  private readonly dispatchQueries: DispatchQueries;

  private readonly displayQueries: DisplayQueries;

  private readonly reviewStatistics: ReviewStatistics;

  private readonly epicRules: Epics;

  private readonly draftRules: Drafts;

  private readonly draftContents: DraftContents;

  private readonly jobRules: Jobs;

  private readonly mergeQueueMarks: MergeQueueMarks;

  private readonly mergeSlotClaims: MergeSlotClaims;

  private readonly decisionRules: Decisions;

  private readonly incidentRules: Incidents;

  private readonly agentQuestions: AgentQuestions;

  private readonly jobControls: JobControls;

  private readonly incidentMoves: IncidentMoves;

  constructor(input: BoardInput) {
    this.records            = new BoardRecords(input.progress, input.tickets, input.epics, input.drafts ?? [], input.logger, input.storedLogRecords ?? [], input.pipeline ?? null);
    this.reviewBars         = new ReviewBars(this.records);
    this.groupReleases      = new GroupReleases(this.records);
    this.dispatchQueries    = new DispatchQueries(this.records, this.groupReleases);
    this.displayQueries     = new DisplayQueries(this.records, this.reviewBars);
    this.reviewStatistics   = new ReviewStatistics(this.records, this.reviewBars);
    this.ticketDependencies = new TicketDependencies(this.records);
    this.ticketLinks        = new TicketLinks(this.records);
    this.ticketMoves        = new TicketMoves(this.records, this.reviewBars, this.ticketDependencies, this.groupReleases);
    this.ticketClaims       = new TicketClaims(this.records, this.ticketMoves, this.reviewBars, this.dispatchQueries, this.groupReleases);
    this.ticketSettings     = new TicketSettings(this.records);
    this.ticketEdits        = new TicketEdits(this.records);
    this.taskRows           = new TaskRows(this.records);
    this.tokenCredits       = new TokenCredits(this.records, this.reviewBars);
    this.trackerChanges     = new TrackerChanges(this.records, this.dispatchQueries);
    this.epicRules          = new Epics(this.records, this.displayQueries);
    this.draftRules         = new Drafts(this.records);
    this.draftContents      = new DraftContents(this.records, this.draftRules);
    this.jobRules           = new Jobs(this.records);
    this.mergeQueueMarks    = new MergeQueueMarks(this.records);
    this.mergeSlotClaims    = new MergeSlotClaims(this.records, this.jobRules);
    this.decisionRules      = new Decisions(this.records);
    this.incidentRules      = new Incidents(this.records, this.decisionRules);
    this.agentQuestions     = new AgentQuestions(this.records, this.jobRules, this.decisionRules, this.ticketSettings, this.ticketEdits);
    this.jobControls        = new JobControls(this.records, this.jobRules, this.decisionRules, this.ticketSettings, this.agentQuestions);
    this.incidentMoves      = new IncidentMoves({
      records:        this.records,
      incidentRules:  this.incidentRules,
      decisionRules:  this.decisionRules,
      agentQuestions: this.agentQuestions,
      ticketSettings: this.ticketSettings,
      ticketMoves:    this.ticketMoves,
      jobRules:       this.jobRules,
      endJob:         (jobId, ending, at) => this.endJob(jobId, ending, at),
      requestFresh:   (jobId, at) => this.jobControls.requestJobStop(jobId, 'fresh', at),
    });
  }

  /** Refuses `unknown-incident` or `incident-closed`. */
  requireOpenIncident(incidentId: string): Readonly<Incident> {
    return this.incidentRules.requireOpenIncident(incidentId);
  }

  /** Records a finding under an open incident, which stays open. */
  noteIncident(incidentId: string, text: string, at: string): Logged {
    return this.incidentMoves.noteIncident(incidentId, text, at);
  }

  /** Answers a `system-question` or `malformed-ticket`: its waiting job takes the answer, and a malformed ticket's goes under `## Questions`. */
  answerIncident(incidentId: string, text: string, at: string): Logged {
    return this.incidentMoves.answerIncident(incidentId, text, at);
  }

  /** `merge abort`: the incident handled and its tickets parked under its kind, so the Airlock aborts their merge. */
  abortMerge(incidentId: string, at: string): Logged {
    return this.incidentMoves.abortMerge(incidentId, at);
  }

  /** Holds `parked:<kind>`, stops the incident's waiting job and opens a `parked` decision to User, carrying the agent's questions. */
  parkTicket(ticketId: string, reason: string, incidentId: string | null, at: string): Logged {
    return this.incidentMoves.parkTicket(ticketId, reason, incidentId, at);
  }

  /** Readies listed findings: a draft through the completeness check, a v16 leftover by lifting its `first-run review` hold. */
  readyFindings(ticketIds: readonly string[], readinessGapsOf: (body: string) => readonly ReadinessGap[], at: string): TicketsReadied {
    return this.incidentMoves.readyFindings(ticketIds, readinessGapsOf, at);
  }

  /** User's stop, wind-down or fresh agent; `stop` and `wind-down` hold the job's ticket in this hold. */
  requestJobStop(jobId: string, mode: JobStopMode, at: string): JobChanged {
    return this.jobControls.requestJobStop(jobId, mode, at);
  }

  /** Pauses the board, then stops or winds down every live build, review and product-owner job. */
  stopAllJobs(mode: Exclude<JobStopMode, 'fresh'>, at: string): Logged {
    const pause = (): readonly LogRecord[] => (this.dispatcherState() === 'stopped' ? [] : this.setDispatcherState('stopped', at).logged);
    return this.jobControls.stopAllJobs(mode, pause, at);
  }

  messageJob(jobId: string, text: string, at: string): JobChanged {
    return this.jobControls.messageJob(jobId, text, at);
  }

  startIntake(text: string, at: string): JobChanged {
    return this.jobControls.startIntake(text, at);
  }

  closeIntake(jobId: string, proposedDraftSets: readonly (readonly string[])[], at: string): JobChanged {
    return this.jobControls.closeIntake(jobId, proposedDraftSets, at);
  }

  /** The drafts a product owner and every session it took over from filed, still drafts. */
  draftsFiledByIntakeOf(jobId: string): readonly Readonly<Ticket>[] {
    const job = this.jobRules.jobById(jobId);
    if (job === undefined) return [];
    const filingJobIds = this.jobControls.intakeChainOf(job);
    return this.tickets().filter(({ frontmatter }) => frontmatter.status === 'draft' && frontmatter.filedByJob !== undefined
      && filingJobIds.includes(frontmatter.filedByJob));
  }

  /** The runner's end of a closed intake: the job ends `closed` and a `ready-drafts` decision lists its drafts, worded by the caller. */
  endIntakeJob(
    jobId: string,
    readinessGapsOf: (body: string) => readonly ReadinessGap[],
    decisionWordingOf: (draft: DecisionDraft) => DecisionWording,
    at: string,
  ): Logged {
    const job   = this.jobRules.requireJob(jobId);
    const draft = this.jobControls.readyDraftsDraftOf(job, readinessGapsOf);
    const ended = this.endJob(jobId, { outcome: 'closed' }, at);
    if (draft === null) return { logged: ended.logged };
    const opened = this.openDecision({
      ...draft, askedBy: 'runner', requestId: null, ...decisionWordingOf(draft)
    }, at);
    return { logged: [...ended.logged, ...opened.logged] };
  }

  startOnboarder(at: string): JobChanged {
    return this.jobControls.startOnboarder(at);
  }

  launchJob(launch: JobLaunch, at: string): JobChanged {
    return this.jobRules.launchJob(launch, at);
  }

  moveJob(jobId: string, targetState: SteppedJobState, at: string): JobChanged {
    return this.jobRules.moveJob(jobId, targetState, at);
  }

  interruptJob(jobId: string, cause: InterruptionCause, at: string): JobChanged {
    return this.jobRules.interruptJob(jobId, cause, at);
  }

  /** A ticket job ended `replaced` or `stopped` leaves its open questions on its ticket, held until User answers them. */
  endJob(jobId: string, ending: JobEnding, at: string): JobChanged {
    const ended = this.jobRules.endJob(jobId, ending, at);
    return { job: ended.job, logged: [...ended.logged, ...this.agentQuestions.rebindQuestionsOfEndedJob(ended.job, at)] };
  }

  setJobEventCursor(jobId: string, cursor: JobEventCursor): Readonly<Job> {
    return this.jobRules.setJobEventCursor(jobId, cursor);
  }

  addAnsweredRequestId(jobId: string, requestId: string): Readonly<Job> {
    return this.jobRules.addAnsweredRequestId(jobId, requestId);
  }

  setJobSlot(jobId: string, slot: MergeSlot | null): Readonly<Job> {
    return this.jobRules.setJobSlot(jobId, slot);
  }

  recordRunnerStarted(versions: { codeVersion: string; installVersion: number }, at: string): Logged {
    return this.jobRules.recordRunnerStarted(versions, at);
  }

  recordRunnerStopped(reason: RunnerStopReason, at: string): Logged {
    return this.jobRules.recordRunnerStopped(reason, at);
  }

  recordRunnerHandoverFailed(failure: { successorCodeVersion: string; step: string; error: string }, at: string): Logged {
    return this.jobRules.recordRunnerHandoverFailed(failure, at);
  }

  recordUsageLimitHit(jobId: string, limit: { window: string; resetsAt: string }, at: string): Logged {
    return this.jobRules.recordUsageLimitHit(jobId, limit, at);
  }

  recordRelayApplied(jobId: string, applied: { requestId: string; commandKind: string; outcome: string }, at: string): Logged {
    return this.jobRules.recordRelayApplied(jobId, applied, at);
  }

  relayRequestIsApplied(requestId: string): boolean {
    return this.jobRules.relayRequestIsApplied(requestId);
  }

  setTicketMergeQueued(ticketId: string, queued: boolean, at: string): Readonly<Task> | null {
    return this.mergeQueueMarks.setTicketMergeQueued(ticketId, queued, at);
  }

  queueTicketForMerge(ticketId: string, target: string, at: string): Logged {
    return this.mergeQueueMarks.queueTicketForMerge(ticketId, target, at);
  }

  ticketIsMergeQueued(ticketId: string): boolean {
    return this.mergeQueueMarks.ticketIsMergeQueued(ticketId);
  }

  mergeSlotHolderOf(target: string): Readonly<Job> | undefined {
    return this.mergeSlotClaims.slotHolderOf(target);
  }

  mergeCandidatesOf(target: string, targetOf: MergeTargetOf): MergeCandidate[] {
    return this.mergeSlotClaims.mergeCandidatesOf(target, targetOf);
  }

  claimMergeSlot(claim: MergeSlotClaim, targetOf: MergeTargetOf, at: string): JobChanged {
    return this.mergeSlotClaims.claimMergeSlot(claim, targetOf, at);
  }

  claimRefreshSlot(claim: RefreshSlotClaim, at: string): JobChanged {
    return this.mergeSlotClaims.claimRefreshSlot(claim, at);
  }

  /** The group's release ticket id while it is queued to merge or holds the main line's slot. */
  groupReleaseQueuedOrSlotted(group: string): string | null {
    return this.mergeSlotClaims.releaseIsQueuedOrSlotted(group);
  }

  /** The tickets the group's release delivers, walked through `dependsOn` from its open release ticket. */
  releaseBundleTicketIdsOf(group: string): string[] {
    return this.mergeSlotClaims.releaseBundleOf(group).map((ticket) => ticket.frontmatter.id);
  }

  recordMergeLanded(jobId: string, landing: MergeLanding, at: string): Logged {
    return this.mergeSlotClaims.recordMergeLanded(jobId, landing, at);
  }

  recordedLandingsOn(target: string): string[] {
    return this.mergeSlotClaims.recordedLandingsOn(target);
  }

  /** The unsettled jobs, in launch order. */
  jobs(): readonly Readonly<Job>[] {
    return this.jobRules.jobs();
  }

  jobById(jobId: string): Readonly<Job> | undefined {
    return this.jobRules.jobById(jobId);
  }

  openDecision(opening: DecisionOpening, at: string): DecisionOpened {
    return this.decisionRules.openDecision(opening, at);
  }

  /** The first answer wins; the answered request joins its live job's `answeredRequestIds`, so a replay of it opens nothing. */
  answerDecision(decisionId: string, answers: readonly string[], at: string): DecisionAnswered {
    const answered                    = this.decisionRules.answerDecision(decisionId, answers, at);
    const { jobId, requestId }        = answered.decision;
    if (jobId !== null && requestId !== null && this.jobRules.jobById(jobId) !== undefined) this.jobRules.addAnsweredRequestId(jobId, requestId);
    return { ...answered, logged: [...answered.logged, ...this.agentQuestions.afterAnswer(answered.decision, answered.answer, at)] };
  }

  /** `decide`'s forms: option letters per question, multi-select letters joined, or one free text for a one-question decision. */
  answerDecisionInForm(decisionId: string, form: DecisionAnswerForm, at: string): DecisionAnswered {
    return this.answerDecision(decisionId, this.agentQuestions.answersOf(decisionId, form), at);
  }

  /** Puts a question incident's own questions to User as an `agent-question`, with no word of the orchestrator's. */
  escalateQuestionIncident(incidentId: string, at: string): IncidentEscalated {
    const incident   = this.incidentRules.incidentById(incidentId);
    const escalation = incident === undefined ? null : this.agentQuestions.escalationOf(incident);
    if (incident === undefined) throw new BoardRefusal({ reason: 'unknown-incident', incidentId });
    if (escalation === null) throw new BoardRefusal({ reason: 'decision-without-questions' });
    return this.incidentRules.escalateIncident(incidentId, escalation, at);
  }

  /** The runner's first start holds the v16 low `pending` tickets `first-run review` and lists them in one `findings-delivered` incident. */
  holdFirstRunLeftovers(at: string): Logged {
    const held = this.agentQuestions.holdFirstRunLeftovers(at);
    if (held.ticketIds.length === 0) return { logged: held.logged };
    const opened = this.incidentRules.openIncident({
      kind: 'findings-delivered', ticketIds: held.ticketIds, jobId: null, facts: {}, defaultMove: 'ticket-triage'
    }, at);
    return { logged: [...held.logged, ...opened.logged] };
  }

  withdrawDecision(decisionId: string, reason: string, at: string): DecisionClosed {
    return this.decisionRules.withdrawDecision(decisionId, reason, at);
  }

  /** The open decisions for the user, in opening order. */
  decisions(): readonly Readonly<Decision>[] {
    return this.decisionRules.decisions();
  }

  decisionById(decisionId: string): Readonly<Decision> | undefined {
    return this.decisionRules.decisionById(decisionId);
  }

  openIncident(opening: IncidentOpening, at: string): IncidentOpened {
    return this.incidentRules.openIncident(opening, at);
  }

  markIncidentDelivered(incidentId: string, turn: IncidentDeliveryTurn): Readonly<Incident> {
    return this.incidentRules.markIncidentDelivered(incidentId, turn);
  }

  withdrawIncidentDelivery(incidentId: string): Readonly<Incident> {
    return this.incidentRules.withdrawIncidentDelivery(incidentId);
  }

  handleIncident(incidentId: string, move: IncidentMove, at: string): IncidentClosed {
    return this.incidentRules.handleIncident(incidentId, move, at);
  }

  defaultIncident(incidentId: string, cause: IncidentDefaultCause, at: string): IncidentClosed {
    return this.incidentRules.defaultIncident(incidentId, cause, at);
  }

  escalateIncident(incidentId: string, escalation: IncidentEscalation, at: string): IncidentEscalated {
    return this.incidentRules.escalateIncident(incidentId, escalation, at);
  }

  /** The open incidents for the runner's orchestrator, in opening order. */
  incidents(): readonly Readonly<Incident>[] {
    return this.incidentRules.incidents();
  }

  /**
   * Applies every step the lifecycle policy derives from this board, in order, each record stamped `limits.now`. A decision the policy
   * opens is worded by `decisionWordingOf`, since the policy holds no words.
   */
  advanceLifecycle(limits: LifecycleLimits, observations: LifecycleObservations, decisionWordingOf: (draft: DecisionDraft) => DecisionWording): LifecycleAdvanced {
    const steps = LifecyclePolicy.nextStepsOf(this.lifecycleFactsOf(observations), limits);
    const logged = steps.flatMap((step) => this.applyLifecycleStep(step, decisionWordingOf, limits.now));
    return { steps, logged };
  }

  private lifecycleFactsOf(observations: LifecycleObservations): LifecycleFacts {
    return {
      tickets:                     this.records.ticketRecords.map((ticket) => ({ ...ticket.frontmatter, mergeQueued: this.ticketIsMergeQueued(ticket.frontmatter.id) })),
      jobs:                        this.jobs(),
      decisions:                   this.decisions(),
      incidents:                   this.incidents(),
      logRecords:                  [...this.records.storedLogRecords, ...this.records.loggedRecords],
      readinessPositionByTicketId: this.dispatchQueries.readinessPositionByTicketId(),
      concurrencyLimit:            this.concurrency().limit,
      dispatcherState:             this.dispatcherState(),
      pipelineIsSet:               this.records.pipeline !== null,
      reviewIsSet:                 this.records.pipeline?.review !== undefined,
      observations,
    };
  }

  private applyLifecycleStep(step: LifecycleStep, decisionWordingOf: (draft: DecisionDraft) => DecisionWording, at: string): readonly LogRecord[] {
    const openDecision = (draft: DecisionDraft): readonly LogRecord[] => this.openDecision({
      ...draft, askedBy: 'runner', requestId: null, ...decisionWordingOf(draft)
    }, at).logged;
    switch (step.kind) {
      case 'launch-build':
        return this.launchJob({
          kind: 'build', role: 'builder', ticketIds: [step.ticketId], parentJobId: null, attempt: step.attempt, target: step.base
        }, at).logged;
      case 'launch-review':
        return this.launchJob({
          kind: 'review', role: 'reviewer', ticketIds: [step.ticketId], parentJobId: null, attempt: step.round, target: step.target
        }, at).logged;
      case 'queue-merge':
        return this.queueTicketForMerge(step.ticketId, step.target, at).logged;
      case 'boot-orchestrator':
        return this.launchJob({
          kind: 'orchestrator', role: 'orchestrator', ticketIds: [], parentJobId: null, attempt: 1, target: null
        }, at).logged;
      case 'launch-onboarder':
        return this.jobControls.startOnboarder(at).logged;
      case 'resume-job':
        return this.moveJob(step.jobId, 'running', at).logged;
      case 'replace-job':
        return this.endJob(step.jobId, { outcome: 'replaced' }, at).logged;
      case 'await-answer':
        return this.moveJob(step.jobId, 'awaiting-answer', at).logged;
      case 'refresh-intake':
        return this.jobControls.refreshIntake(step.jobId, at).logged;
      case 'park':
        return [
          ...step.jobId === undefined ? [] : this.endJob(step.jobId, { outcome: 'failed', cause: step.cause }, at).logged,
          ...this.holdTicket(step.ticketId, `${PARKED_HOLD_PREFIX}${step.cause}`, at).logged,
          ...openDecision({ kind: 'parked', ticketIds: [step.ticketId], jobId: null }),
        ];
      case 'open-decision':
        return openDecision(step.decision);
      case 'open-incident':
        return this.openIncident(step.incident, at).logged;
      case 'default-incident':
        return this.incidentMoves.defaultIncident(step.incidentId, step.cause, decisionWordingOf, at);
      case 'stop-dispatching':
        return this.setDispatcherState('stopped', at).logged;
    }
  }

  incidentById(incidentId: string): Readonly<Incident> | undefined {
    return this.incidentRules.incidentById(incidentId);
  }

  /** Puts findings before the user's low-priority triage (`findingRoute: user`), striking them off any incident listing them. */
  triageTickets(ticketIds: readonly string[], at: string): Logged {
    return this.incidentMoves.triageFindings(ticketIds, at);
  }

  setChartRange(view: ViewRange, at: string): Logged {
    return this.trackerChanges.setChartRange(view, at);
  }

  setConcurrencyLimit(limit: number, at: string): ConcurrencyLimitSet {
    return this.trackerChanges.setConcurrencyLimit(limit, at);
  }

  setDispatcherState(state: DispatcherState, at: string): DispatcherStateSet {
    return this.trackerChanges.setDispatcherState(state, at);
  }

  setPrepareStep(step: PipelineStep, at: string): PipelineChanged {
    return this.trackerChanges.setPrepareStep(step, at);
  }

  addGate(gate: PipelineGate, at: string): PipelineChanged {
    return this.trackerChanges.addGate(gate, at);
  }

  setNoGates(at: string): PipelineChanged {
    return this.trackerChanges.setNoGates(at);
  }

  removeGate(name: string, at: string): PipelineChanged {
    return this.trackerChanges.removeGate(name, at);
  }

  recordPipelineJudgedBy(ticketId: string): void {
    this.trackerChanges.recordPipelineJudgedBy(ticketId);
  }

  recordWorktreeRepaired(ticketId: string, fields: LogRecordFieldsOf<'worktree-repaired'>, at: string): Logged {
    return this.trackerChanges.recordWorktreeRepaired(ticketId, fields, at);
  }

  recordGateRan(fields: LogRecordFieldsOf<'gate-ran'>, at: string): Logged {
    return this.trackerChanges.recordGateRan(fields, at);
  }

  recordNote(text: string, at: string): Logged {
    return this.trackerChanges.recordNote(text, at);
  }

  addTask(addition: TaskAddition, at: string): Readonly<Task> {
    return this.taskRows.addTask(addition, at);
  }

  moveTask(taskId: number, status: TaskStatus, request: { movesAnyway: boolean }, at: string): Readonly<Task> {
    return this.taskRows.moveTask(taskId, status, request, at);
  }

  correctTask(taskId: number, correction: TaskCorrection, request: { movesAnyway: boolean }): Readonly<Task> {
    return this.taskRows.correctTask(taskId, correction, request);
  }

  annotateTask(taskId: number, annotation: TaskAnnotation): Readonly<Task> {
    return this.taskRows.annotateTask(taskId, annotation);
  }

  removeTask(taskId: number): Readonly<Task> {
    return this.taskRows.removeTask(taskId);
  }

  recordAgentStop(usage: AgentUsage, credits: readonly TokenCredit[], at: string): AgentStopRecorded {
    return this.tokenCredits.recordAgentStop(usage, credits, at);
  }

  fileTicket(ticket: Ticket, at: string): TicketChanged {
    this.epicRules.refuseUnknownEpicKeys(ticket.frontmatter.epics ?? []);
    this.ticketLinks.refuseUnworkableLinksOfAFiledTicket(ticket.frontmatter);
    return this.ticketMoves.fileTicket(ticket, at);
  }

  /** A `null` cause clears the link. */
  setTicketIntroducedBy(ticketId: string, causeTicketId: string | null, at: string): TicketChanged {
    return this.ticketLinks.setIntroducedBy(ticketId, causeTicketId, at);
  }

  addEpic(addition: EpicAddition, at: string): EpicChanged {
    return this.epicRules.addEpic(addition, at);
  }

  editEpic(epicKey: string, edit: EpicEdit, at: string): EpicEdited {
    return this.epicRules.editEpic(epicKey, edit, at);
  }

  removeEpic(epicKey: string, at: string): EpicChanged {
    return this.epicRules.removeEpic(epicKey, at);
  }

  setTicketEpics(ticketId: string, epicKeys: readonly string[], at: string): TicketEpicsChanged {
    return this.epicRules.setTicketEpics(ticketId, epicKeys, at);
  }

  addTicketEpics(ticketId: string, addedEpicKeys: readonly string[], at: string): TicketEpicsChanged {
    return this.epicRules.addTicketEpics(ticketId, addedEpicKeys, at);
  }

  removeTicketEpics(ticketId: string, removedEpicKeys: readonly string[], at: string): TicketEpicsChanged {
    return this.epicRules.removeTicketEpics(ticketId, removedEpicKeys, at);
  }

  openDraft(opening: DraftOpening, at: string): DraftChanged {
    return this.draftRules.openDraft(opening, at);
  }

  claimDraft(draftId: string, request: { owner: string; forces: boolean }, at: string): DraftClaimChanged {
    return this.draftRules.claimDraft(draftId, request, at);
  }

  releaseDraft(draftId: string, at: string): DraftClaimChanged {
    return this.draftRules.releaseDraft(draftId, at);
  }

  closeDraft(draftId: string, ticketReferences: readonly string[], at: string): DraftChanged {
    return this.draftRules.closeDraft(draftId, ticketReferences, at);
  }

  abandonDraft(draftId: string, reason: string, at: string): DraftChanged {
    return this.draftRules.abandonDraft(draftId, reason, at);
  }

  addDraftNote(draftId: string, addition: DraftNoteAddition, at: string): DraftChanged {
    return this.draftContents.addDraftNote(draftId, addition, at);
  }

  askDraftQuestion(draftId: string, asking: DraftQuestionAsking, at: string): DraftChanged {
    return this.draftContents.askDraftQuestion(draftId, asking, at);
  }

  answerDraftQuestion(draftId: string, questionId: string, answerText: string, at: string): DraftChanged {
    return this.draftContents.answerDraftQuestion(draftId, questionId, answerText, at);
  }

  dropDraftItem(draftId: string, itemId: string, at: string): DraftChanged {
    return this.draftContents.dropDraftItem(draftId, itemId, at);
  }

  /** Delivering or abandoning a ticket opens the `findings-delivered` incident over its jobs' findings in the same hold. */
  moveTicket(ticketId: string, targetStatus: TicketStatus, request: TicketMoveRequest, at: string): TicketMoved {
    const moved = this.ticketMoves.moveTicket(ticketId, targetStatus, request, at);
    if (targetStatus !== 'delivered' && targetStatus !== 'abandoned') return moved;
    return { ...moved, logged: [...moved.logged, ...this.incidentMoves.afterTicketSettled(ticketId, targetStatus === 'abandoned', at)] };
  }

  rereviewTicket(ticketId: string, at: string): TicketChanged {
    return this.ticketMoves.rereviewTicket(ticketId, at);
  }

  /**
   * The caller reads each body for its gaps, since what a complete ticket holds is its document's format, not a Board rule. A readied
   * draft a `findings-delivered` incident lists is struck off it, whoever readied it.
   */
  readyDraftTickets(ticketIds: readonly string[], readinessGapsOf: (body: string) => readonly ReadinessGap[], at: string): TicketsReadied {
    const readied = this.ticketMoves.readyDraftTickets(ticketIds, readinessGapsOf, at);
    return { ...readied, logged: [...readied.logged, ...this.incidentRules.settleListedFindings(ticketIds, 'ticket-ready', at)] };
  }

  startReviewBar(ticketId: string, request: ReviewBarRequest, at: string): ReviewBarStarted {
    return this.reviewBars.startReviewBar(ticketId, request, at);
  }

  recordReview(ticketId: string, recording: ReviewRecording, at: string, bundleBarTaskId: number | null = null): ReviewRecorded {
    return this.reviewBars.recordReview(ticketId, recording, at, bundleBarTaskId);
  }

  setTicketDependencies(ticketId: string, dependsOn: readonly string[], at: string): TicketDependenciesChanged {
    return this.ticketDependencies.setTicketDependencies(ticketId, dependsOn, at);
  }

  addTicketDependencies(ticketId: string, addedTicketIds: readonly string[], at: string): TicketDependenciesChanged {
    return this.ticketDependencies.addTicketDependencies(ticketId, addedTicketIds, at);
  }

  removeTicketDependencies(ticketId: string, removedTicketIds: readonly string[], at: string): TicketDependenciesChanged {
    return this.ticketDependencies.removeTicketDependencies(ticketId, removedTicketIds, at);
  }

  claimTickets(ticketIds: readonly string[], claim: TicketClaim, at: string): TicketsClaimed {
    return this.ticketClaims.claimTickets(ticketIds, claim, at);
  }

  releaseTickets(ticketIds: readonly string[], release: TicketRelease, at: string): TicketsReleased {
    return this.ticketMoves.releaseTickets(ticketIds, release, at);
  }

  linkTicketToTask(ticketId: string, taskId: number, request: { movesTheLink: boolean }): Readonly<Ticket> {
    return this.taskRows.linkTicketToTask(ticketId, taskId, request);
  }

  setTicketPriority(ticketId: string, priority: TicketPriority, at: string): TicketChanged {
    return this.ticketSettings.setTicketPriority(ticketId, priority, at);
  }

  setTicketSize(ticketId: string, size: TicketSize, at: string): TicketChanged {
    return this.ticketSettings.setTicketSize(ticketId, size, at);
  }

  setTicketAgents(ticketId: string, agents: AgentChoice, at: string): TicketChanged {
    return this.ticketSettings.setTicketAgents(ticketId, agents, at);
  }

  setTicketNetwork(ticketId: string, domains: readonly string[], at: string): TicketChanged {
    return this.ticketSettings.setTicketNetwork(ticketId, domains, at);
  }

  holdTicket(ticketId: string, reason: string, at: string): TicketChanged {
    return this.ticketSettings.holdTicket(ticketId, reason, at);
  }

  unholdTicket(ticketId: string, at: string): TicketChanged {
    return this.ticketSettings.unholdTicket(ticketId, at);
  }

  markReleaseTicket(ticketId: string, at: string): TicketChanged {
    return this.groupReleases.markReleaseTicket(ticketId, at);
  }

  clearReleaseTicket(ticketId: string, at: string): TicketChanged {
    return this.groupReleases.clearReleaseTicket(ticketId, at);
  }

  editTicket(ticketId: string, edit: TicketEdit, at: string): TicketEdited {
    return this.ticketEdits.editTicket(ticketId, edit, at);
  }

  clearTracker(request: { ticketsSurvive: boolean }, at: string): TrackerCleared {
    return this.trackerChanges.clearTracker(request, at);
  }

  tasks(): readonly Readonly<Task>[] {
    return this.records.progress.tasks;
  }

  tickets(): readonly Readonly<Ticket>[] {
    return this.records.ticketRecords;
  }

  /** Ordered by key. */
  epics(): readonly Readonly<Epic>[] {
    return this.records.epicRecords;
  }

  epicByKey(epicKey: string): Readonly<Epic> | undefined {
    return this.records.epicRecordByKey(epicKey);
  }

  /** Ordered by id number. */
  drafts(): readonly Readonly<Draft>[] {
    return this.draftRules.draftsInIdOrder();
  }

  /** Every open draft, ordered by id number, as `status --json` and the page's `boardFacts` list them. */
  openDraftSummaries(): DraftSummary[] {
    return this.draftRules.openDraftSummaries();
  }

  /** `waiting` while a question is open, else `researching` while claimed and `resumable` while not. */
  draftStateOf(draft: Readonly<Draft>): DraftState {
    return this.draftRules.draftStateOf(draft);
  }

  /** One per epic, ordered by key. */
  epicRollups(): EpicRollup[] {
    return this.records.epicRecords.map((epic) => this.epicRules.epicRollupOf(epic));
  }

  epicRollupOf(epic: Readonly<Epic>): EpicRollup {
    return this.epicRules.epicRollupOf(epic);
  }

  /** Reads `3`, `#3` and `003` alike, as a typed reference may be any of them. */
  ticketByReference(reference: string): Readonly<Ticket> | undefined {
    return this.records.ticketRecordByReference(reference);
  }

  concurrency(): Concurrency {
    return this.dispatchQueries.concurrency();
  }

  dispatcherState(): DispatcherState {
    return this.dispatchQueries.dispatcherState();
  }

  /** `null` when none is stored, or the stored one could not be read: either way no gate is set. */
  pipeline(): Readonly<Pipeline> | null {
    return this.records.pipeline;
  }

  /** Whether the hold has a changed pipeline to write. */
  pipelineChanged(): boolean {
    return this.records.pipelineChanged;
  }

  /** The stored gates joined in order, the line a landing and a gate run; `null` with no pipeline. */
  checksLine(): string | null {
    return this.records.pipeline === null ? null : PipelineUtil.checksLineOf(this.records.pipeline);
  }

  /** The prepare steps joined in order; `null` with no pipeline or none to run. */
  installLine(): string | null {
    return this.records.pipeline === null ? null : PipelineUtil.installLineOf(this.records.pipeline);
  }

  gateWritablePaths(): readonly string[] {
    return this.records.pipeline === null ? [] : PipelineUtil.writablePathsOf(this.records.pipeline);
  }

  readyTickets(): readonly Readonly<Ticket>[] {
    return this.dispatchQueries.readyTickets();
  }

  readyTicketEntries(): ReadyTicket[] {
    return this.dispatchQueries.readyTicketEntries();
  }

  heldTicketIds(): string[] {
    return this.dispatchQueries.heldTicketIds();
  }

  dispatchCapacity(): DispatchCapacity {
    return this.dispatchQueries.dispatchCapacity();
  }

  unsettledDependenciesOf(ticketId: string): string[] {
    return this.dispatchQueries.unsettledDependenciesOf(ticketId);
  }

  waitingOnOf(ticket: Readonly<Ticket>): string[] {
    return this.dispatchQueries.waitingOnOf(ticket);
  }

  releaseBundleOf(group: string): string[] {
    return this.groupReleases.releaseBundleOf(group);
  }

  pausedBuildRowOf(ticketId: string): Readonly<Task> | null {
    return this.dispatchQueries.pausedBuildRowOf(ticketId);
  }

  pausedBuildTickets(): readonly Readonly<Ticket>[] {
    return this.dispatchQueries.pausedBuildTickets();
  }

  inProgressTicketIds(): string[] {
    return this.dispatchQueries.inProgressTicketIds();
  }

  inProgressReviewOfIds(): string[] {
    return this.dispatchQueries.inProgressReviewOfIds();
  }

  reviewRowsOf(ticketId: string): readonly Readonly<Task>[] {
    return this.displayQueries.reviewRowsOf(ticketId);
  }

  /** The log the Board was opened with, then every record logged since, as the lifecycle policy reads it. */
  logRecordsSoFar(): readonly LogRecord[] {
    return [...this.records.storedLogRecords, ...this.records.loggedRecords];
  }

  /** The log is the caller's to hand in, since the Board holds no log records. */
  reviewStatisticsOf(logRecords: readonly LogRecord[]): ReviewStatisticsReport {
    return this.reviewStatistics.reviewStatisticsOf(logRecords);
  }

  reviewWaitingTickets(): readonly Readonly<Ticket>[] {
    return this.dispatchQueries.reviewWaitingTickets();
  }

  linkedRowOf(ticketId: string): Readonly<Task> | null {
    return this.displayQueries.linkedRowOf(ticketId);
  }

  ticketIsReleasable(ticket: Readonly<Ticket>, releasedTicketIds: readonly string[]): boolean {
    return this.ticketMoves.ticketIsReleasable(ticket, releasedTicketIds);
  }

  taskIsTicketWork(task: Readonly<Task>): boolean {
    return this.displayQueries.taskIsTicketWork(task);
  }

  taskIsSettled(task: Readonly<Task>): boolean {
    return this.displayQueries.taskIsSettled(task);
  }

  ticketIsSettled(ticket: Readonly<Ticket>): boolean {
    return this.displayQueries.ticketIsSettled(ticket);
  }

  /** Over every ticket, settled ones included. */
  ticketCountByStatus(): Record<TicketStatus, number> {
    return this.displayQueries.ticketCountByStatusOf(this.records.ticketRecords);
  }

  reviewBarsOf(ticketId: string): readonly Readonly<Task>[] {
    return this.displayQueries.reviewBarsOf(ticketId);
  }

  ownRowOf(ticketId: string): Readonly<Task> | null {
    return this.displayQueries.ownRowOf(ticketId);
  }

  rowDisplayStateOf(task: Readonly<Task>): DisplayState {
    return this.displayQueries.rowDisplayStateOf(task);
  }

  ticketDisplayStateOf(ticket: Readonly<Ticket>): DisplayState {
    return this.displayQueries.ticketDisplayStateOf(ticket);
  }

  deliveredRowCountsAsReviewed(task: Readonly<Task>): boolean {
    return this.displayQueries.deliveredRowCountsAsReviewed(task);
  }

  changedTickets(): readonly Ticket[] {
    return this.records.changedTicketRecords;
  }

  changedEpics(): readonly Epic[] {
    return this.records.changedEpicRecords;
  }

  removedEpics(): readonly Epic[] {
    return this.records.removedEpicRecords;
  }

  changedDrafts(): readonly Draft[] {
    return this.records.changedDraftRecords;
  }

  removedDrafts(): readonly Draft[] {
    return this.records.removedDraftRecords;
  }
}
