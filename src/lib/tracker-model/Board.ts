/**
 * The tracker's aggregate for one invocation and the one domain class callers use: the compound changes to rows and tickets, the queries
 * over them, and which tickets it changed. It does no I/O, logs through the `Logger` and refuses with a `BoardRefusal`; it changes the
 * records it was handed in place. Each rule lives in the module beside it that the method hands it to.
 */
import type {
  AgentChoice,
  AgentStopRecorded,
  CheckCommandSet,
  ConcurrencyLimitSet,
  DispatcherStateSet,
  DraftChanged,
  DraftClaimChanged,
  EpicChanged,
  EpicEdited,
  Logged,
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
import type { Concurrency, DispatchCapacity } from './@types/Concurrency.ts';
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
import type { AgentUsage, LogRecord }          from './@types/LogRecord.ts';
import type { DisplayState, Task, TaskStatus } from './@types/Task.ts';
import type {
  ReadinessGap,
  ReadyTicket,
  Ticket,
  TicketPriority,
  TicketSize,
  TicketStatus
}                                                         from './@types/Ticket.ts';
import type { DispatcherState, TrackerProgress, ViewRange } from './@types/TrackerProgress.ts';
import { BoardRecords }                                     from './BoardRecords.ts';
import { DispatchQueries }                                  from './DispatchQueries.ts';
import { DisplayQueries }                                   from './DisplayQueries.ts';
import { DraftContents }                                    from './DraftContents.ts';
import { Drafts }                                           from './Drafts.ts';
import { Epics }                                            from './Epics.ts';
import { GroupReleases }                                    from './GroupReleases.ts';
import type { Logger }                                      from './Logger.ts';
import { ReviewBars }                                       from './ReviewBars.ts';
import type { ReviewStatisticsReport }                      from './ReviewStatistics.ts';
import { ReviewStatistics }                                 from './ReviewStatistics.ts';
import { TaskRows }                                         from './TaskRows.ts';
import { TicketClaims }                                     from './TicketClaims.ts';
import { TicketDependencies }                               from './TicketDependencies.ts';
import type { TicketEdit, TicketEdited }                    from './TicketEdits.ts';
import { TicketEdits }                                      from './TicketEdits.ts';
import { TicketLinks }                                      from './TicketLinks.ts';
import { TicketMoves }                                      from './TicketMoves.ts';
import { TicketSettings }                                   from './TicketSettings.ts';
import { TokenCredits }                                     from './TokenCredits.ts';
import { TrackerChanges }                                   from './TrackerChanges.ts';

export interface BoardInput {
  progress: TrackerProgress;
  tickets:  Ticket[];
  epics:    Epic[];
  /** Absent for a caller that reads no drafts, which reads as none. */
  drafts?:  Draft[];
  logger:   Logger;
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

  constructor(input: BoardInput) {
    this.records            = new BoardRecords(input.progress, input.tickets, input.epics, input.drafts ?? [], input.logger);
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
  }

  setChartRange(view: ViewRange, at: string): Logged {
    return this.trackerChanges.setChartRange(view, at);
  }

  setConcurrencyLimit(limit: number, at: string): ConcurrencyLimitSet {
    return this.trackerChanges.setConcurrencyLimit(limit, at);
  }

  setDispatcherState(state: DispatcherState, runId: string | null, at: string): DispatcherStateSet {
    return this.trackerChanges.setDispatcherState(state, runId, at);
  }

  setCheckCommand(command: string | null, restamps: boolean, at: string): CheckCommandSet {
    return this.trackerChanges.setCheckCommand(command, restamps, at);
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

  moveTicket(ticketId: string, targetStatus: TicketStatus, request: TicketMoveRequest, at: string): TicketMoved {
    return this.ticketMoves.moveTicket(ticketId, targetStatus, request, at);
  }

  rereviewTicket(ticketId: string, at: string): TicketChanged {
    return this.ticketMoves.rereviewTicket(ticketId, at);
  }

  /** The caller reads each body for its gaps, since what a complete ticket holds is its document's format, not a Board rule. */
  readyDraftTickets(ticketIds: readonly string[], readinessGapsOf: (body: string) => readonly ReadinessGap[], at: string): TicketsReadied {
    return this.ticketMoves.readyDraftTickets(ticketIds, readinessGapsOf, at);
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

  dispatcherRunId(): string | undefined {
    return this.dispatchQueries.dispatcherRunId();
  }

  checkCommand(): string | undefined {
    return this.dispatchQueries.checkCommand();
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

  ticketIdsHoldingBack(ticketId: string): string[] {
    return this.dispatchQueries.ticketIdsHoldingBack(ticketId);
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
