/**
 * The tracker's aggregate for one invocation and the one domain class callers use: the compound changes to rows and tickets, the queries
 * over them, and which tickets it changed. It does no I/O, logs through the `Logger` and refuses with a `BoardRefusal`; it changes the
 * records it was handed in place. Each rule lives in the module beside it that the method hands it to.
 */
import type {
  AgentAssignment,
  AgentChoice,
  AgentStopRecorded,
  ConcurrencyLimitSet,
  DispatcherStateSet,
  Logged,
  ReviewBarRequest,
  ReviewBarStarted,
  TaskAddition,
  TaskAnnotation,
  TaskCorrection,
  TicketChanged,
  TicketDependenciesChanged,
  TicketMoved,
  TicketMoveRequest,
  TicketRelease,
  TicketsClaimed,
  TicketsReleased,
  TokenCredit,
  TrackerCleared
}                                                           from './@types/BoardChanges.ts';
import type { Concurrency, DispatchCapacity }  from './@types/Concurrency.ts';
import type { AgentUsage }                     from './@types/LogRecord.ts';
import type { DisplayState, Task, TaskStatus } from './@types/Task.ts';
import type {
  ReadyTicket,
  Ticket,
  TicketPriority,
  TicketStatus
}                                                           from './@types/Ticket.ts';
import type { DispatcherState, TrackerProgress, ViewRange } from './@types/TrackerProgress.ts';
import { BoardRecords }                                     from './BoardRecords.ts';
import { DispatchQueries }                                  from './DispatchQueries.ts';
import { DisplayQueries }                                   from './DisplayQueries.ts';
import type { Logger }                                      from './Logger.ts';
import { ReviewBars }                                       from './ReviewBars.ts';
import { TaskRows }                                         from './TaskRows.ts';
import { TicketClaims }                                     from './TicketClaims.ts';
import { TicketDependencies }                               from './TicketDependencies.ts';
import { TicketMoves }                                      from './TicketMoves.ts';
import { TicketSettings }                                   from './TicketSettings.ts';
import { TokenCredits }                                     from './TokenCredits.ts';
import { TrackerChanges }                                   from './TrackerChanges.ts';

export interface BoardInput {
  progress: TrackerProgress;
  tickets:  Ticket[];
  logger:   Logger;
}

export class Board {
  private readonly records: BoardRecords;

  private readonly trackerChanges: TrackerChanges;

  private readonly taskRows: TaskRows;

  private readonly tokenCredits: TokenCredits;

  private readonly ticketMoves: TicketMoves;

  private readonly ticketDependencies: TicketDependencies;

  private readonly ticketSettings: TicketSettings;

  private readonly ticketClaims: TicketClaims;

  private readonly reviewBars: ReviewBars;

  private readonly dispatchQueries: DispatchQueries;

  private readonly displayQueries: DisplayQueries;

  constructor(input: BoardInput) {
    this.records            = new BoardRecords(input.progress, input.tickets, input.logger);
    this.reviewBars         = new ReviewBars(this.records);
    this.dispatchQueries    = new DispatchQueries(this.records);
    this.displayQueries     = new DisplayQueries(this.records, this.reviewBars);
    this.ticketDependencies = new TicketDependencies(this.records);
    this.ticketMoves        = new TicketMoves(this.records, this.reviewBars, this.ticketDependencies);
    this.ticketClaims       = new TicketClaims(this.records, this.ticketMoves, this.reviewBars, this.dispatchQueries);
    this.ticketSettings     = new TicketSettings(this.records);
    this.taskRows           = new TaskRows(this.records);
    this.tokenCredits       = new TokenCredits(this.records, this.reviewBars);
    this.trackerChanges     = new TrackerChanges(this.records, this.dispatchQueries);
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
    return this.ticketMoves.fileTicket(ticket, at);
  }

  moveTicket(ticketId: string, targetStatus: TicketStatus, request: TicketMoveRequest, at: string): TicketMoved {
    return this.ticketMoves.moveTicket(ticketId, targetStatus, request, at);
  }

  rereviewTicket(ticketId: string, at: string): TicketChanged {
    return this.ticketMoves.rereviewTicket(ticketId, at);
  }

  startReviewBar(ticketId: string, request: ReviewBarRequest, at: string): ReviewBarStarted {
    return this.reviewBars.startReviewBar(ticketId, request, at);
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

  claimTickets(ticketIds: readonly string[], assignment: AgentAssignment, at: string): TicketsClaimed {
    return this.ticketClaims.claimTickets(ticketIds, assignment, at);
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

  setTicketAgents(ticketId: string, agents: AgentChoice, at: string): TicketChanged {
    return this.ticketSettings.setTicketAgents(ticketId, agents, at);
  }

  holdTicket(ticketId: string, reason: string, at: string): TicketChanged {
    return this.ticketSettings.holdTicket(ticketId, reason, at);
  }

  unholdTicket(ticketId: string, at: string): TicketChanged {
    return this.ticketSettings.unholdTicket(ticketId, at);
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

  pausedBuildRowOf(ticketId: string): Readonly<Task> | null {
    return this.dispatchQueries.pausedBuildRowOf(ticketId);
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

  reviewWaitingTickets(): readonly Readonly<Ticket>[] {
    return this.dispatchQueries.reviewWaitingTickets();
  }

  linkedRowOf(ticketId: string): Readonly<Task> | null {
    return this.displayQueries.linkedRowOf(ticketId);
  }

  ticketIsReleasable(ticket: Readonly<Ticket>): boolean {
    return this.ticketMoves.ticketIsReleasable(ticket);
  }

  taskIsSettled(task: Readonly<Task>): boolean {
    return this.displayQueries.taskIsSettled(task);
  }

  ticketIsSettled(ticket: Readonly<Ticket>): boolean {
    return this.displayQueries.ticketIsSettled(ticket);
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
}
