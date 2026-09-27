/**
 * The tracker's aggregate for one invocation: the compound changes to rows and tickets, the queries over them, and which tickets it
 * changed. It does no I/O, logs through the `Logger` and refuses with a `BoardRefusal`; it changes the records it was handed in place.
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
  TicketMoved,
  TicketMoveRequest,
  TicketRelease,
  TicketsClaimed,
  TicketsReleased,
  TokenCredit,
  TokenCreditOutcome,
  TrackerCleared
}                                                        from './@types/BoardChanges.ts';
import type { Concurrency, DispatchCapacity }  from './@types/Concurrency.ts';
import type { AgentUsage, LogRecord }          from './@types/LogRecord.ts';
import type { DisplayState, Task, TaskStatus } from './@types/Task.ts';
import type {
  AgentPair,
  ReadyTicket,
  Ticket,
  TicketFrontmatter,
  TicketPriority,
  TicketStatus
}                                                        from './@types/Ticket.ts';
import type { DispatcherState, TrackerProgress, ViewRange } from './@types/TrackerProgress.ts';
import { BoardRefusal }                                     from './BoardRefusal.ts';
import type { Logger }                                      from './Logger.ts';
import { DEFAULT_DISPATCHER_STATE }                         from './constants/DispatcherStates.ts';
import { FIRST_REPEAT_REVIEW_ROUND }                        from './constants/ReviewRounds.ts';
import { SETTLED_TASK_STATUSES, SETTLED_TICKET_STATUSES }   from './constants/Statuses.ts';
import { ConcurrencyUtil }                                  from './utils/ConcurrencyUtil.ts';
import type { TaskFiling }                                  from './utils/TaskFilingUtil.ts';
import { TaskFilingUtil }                                   from './utils/TaskFilingUtil.ts';
import { TaskTransitionUtil }                               from './utils/TaskTransitionUtil.ts';
import { TicketChartUtil }                                  from './utils/TicketChartUtil.ts';
import { TicketDefaultsUtil }                               from './utils/TicketDefaultsUtil.ts';
import { TicketDependencyUtil }                             from './utils/TicketDependencyUtil.ts';
import { TicketIdUtil }                                     from './utils/TicketIdUtil.ts';
import { TicketMoveUtil }                                   from './utils/TicketMoveUtil.ts';
import { TicketStampUtil }                                  from './utils/TicketStampUtil.ts';

type TicketMoveFields = Pick<TicketMoveRequest, 'branch' | 'commit' | 'reason'>;

const BUNDLE_AGENT_KEY_SEPARATOR = ',';

type ReviewBar = Task & { reviewOf: string };

interface ReviewBarsClosed {
  bars:   ReviewBar[];
  logged: LogRecord[];
}

export interface BoardInput {
  progress: TrackerProgress;
  tickets:  Ticket[];
  logger:   Logger;
}

export class Board {
  private readonly progress: TrackerProgress;

  private readonly ticketRecords: Ticket[];

  private readonly logger: Logger;

  /** In the order each ticket was first changed, once each: the order the writer writes them in. */
  private readonly changedTicketRecords: Ticket[] = [];

  constructor(input: BoardInput) {
    this.progress      = input.progress;
    this.ticketRecords = input.tickets;
    this.logger        = input.logger;
  }

  setChartRange(view: ViewRange, at: string): Logged {
    this.progress.view = view;
    return { logged: [this.logger.chartRangeSet(view, at)] };
  }

  setConcurrencyLimit(limit: number, at: string): ConcurrencyLimitSet {
    const previousLimit           = this.concurrency().limit;
    this.progress.concurrencyLimit = limit;
    const logged                  = [this.logger.concurrencyLimitSet(limit, at)];
    return { logged, previousLimit, concurrency: this.concurrency() };
  }

  /** A `null` run id deletes the stored one, since an older id would be resumed wrongly. */
  setDispatcherState(state: DispatcherState, runId: string | null, at: string): DispatcherStateSet {
    const previousState           = this.dispatcherState();
    this.progress.dispatcherState = state;
    if (runId === null) delete this.progress.dispatcherRunId;
    else this.progress.dispatcherRunId = runId;
    return { logged: [this.logger.dispatcherSet(state, runId, at)], previousState };
  }

  recordNote(text: string, at: string): Logged {
    return { logged: [this.logger.note(text, at)] };
  }

  /** Moving the link off the ticket's existing row leaves that row free-standing rather than deleting it. */
  addTask(addition: TaskAddition, at: string): Readonly<Task> {
    const ticket = addition.ticketId === undefined ? null : this.requireTicket(addition.ticketId);
    if (ticket !== null && ticket.frontmatter.task !== null) {
      const alreadyLinked = this.taskRecordById(ticket.frontmatter.task);
      if (alreadyLinked !== undefined) {
        if (!addition.movesTheLink) {
          throw new BoardRefusal({
            reason:   'ticket-already-has-row',
            ticketId: ticket.frontmatter.id,
            taskId:   alreadyLinked.id,
            taskName: alreadyLinked.name,
          });
        }
        alreadyLinked.ticket = null;
      }
    }

    const filed = this.fileTask({
      name:    addition.name,
      filedAt: at,
      ...(addition.owner === undefined ? {} : { owner: addition.owner }),
      ...(addition.note === undefined ? {} : { note: addition.note }),
      ...(addition.tokens === undefined ? {} : { tokens: addition.tokens }),
      ...(ticket === null ? {} : { ticket: ticket.frontmatter.id }),
      ...(addition.reviewOf === undefined ? {} : { reviewOf: addition.reviewOf.ticketId, reviewBarRound: addition.reviewOf.round }),
    });
    if (addition.startsNow) this.transitionTaskInPlace(filed, 'in-progress', at);

    if (ticket !== null) {
      ticket.frontmatter.task = filed.id;
      this.markChanged(ticket);
    }
    return filed;
  }

  moveTask(taskId: number, status: TaskStatus, request: { movesAnyway: boolean }, at: string): Readonly<Task> {
    const task = this.requireTask(taskId);
    refuseATicketOwnedMove(task, status, request.movesAnyway);
    this.transitionTaskInPlace(task, status, at);
    return task;
  }

  /** A correction moves no timestamp and files no phase, unlike `moveTask`; its `reviewOf` links only a free-standing row with no link yet. */
  correctTask(taskId: number, correction: TaskCorrection, request: { movesAnyway: boolean }): Readonly<Task> {
    const task = this.requireTask(taskId);
    if (correction.status !== undefined) refuseATicketOwnedMove(task, correction.status, request.movesAnyway);
    if (correction.name !== undefined) task.name = correction.name;
    if (correction.reviewOf !== undefined && task.ticket === null && task.reviewOf === undefined) {
      task.reviewOf       = correction.reviewOf.ticketId;
      task.reviewBarRound = correction.reviewOf.round;
    }
    if (correction.status !== undefined) task.status = correction.status;
    return task;
  }

  annotateTask(taskId: number, annotation: TaskAnnotation): Readonly<Task> {
    const task = this.requireTask(taskId);
    if (annotation.owner !== undefined) task.owner = annotation.owner;
    if (annotation.note !== undefined) task.note = annotation.note;
    if (annotation.tokens !== undefined) task.tokens = annotation.tokens;
    return task;
  }

  /** The ticket is unlinked in the same change, so the two files never disagree about a row that is gone. */
  removeTask(taskId: number): Readonly<Task> {
    const task = this.requireTask(taskId);
    this.progress.tasks.splice(this.progress.tasks.indexOf(task), 1);

    const ticket = task.ticket === null ? undefined : this.ticketRecordByReference(task.ticket);
    if (ticket !== undefined && ticket.frontmatter.task === taskId) {
      ticket.frontmatter.task = null;
      this.markChanged(ticket);
    }
    return task;
  }

  /** A credit that cannot land is a verdict beside the others, never a refusal, as the agent has already finished; the usage is logged after them. */
  recordAgentStop(usage: AgentUsage, credits: readonly TokenCredit[], at: string): AgentStopRecorded {
    const outcomes = credits.map((credit) => this.creditTokens(credit));
    return { logged: [this.logger.agentStopped(usage, at)], outcomes };
  }

  /** Judged against the tickets already on the board, before the new one joins, so a ticket naming its own id names no ticket. */
  fileTicket(ticket: Ticket, at: string): TicketChanged {
    const { frontmatter } = ticket;
    this.refuseAnUnworkableDependencyList(frontmatter.id, frontmatter.dependsOn ?? []);
    this.ticketRecords.push(ticket);
    this.ensureTaskForTicketOnTheChart(ticket, at);
    this.markChanged(ticket);
    return { logged: [this.logger.ticketFiled(frontmatter.id, frontmatter.title, at)], ticket };
  }

  /**
   * `checksLegality` false is the deliberate override of the legality table. The tokens are judged after the move, which files a
   * low ticket's row when it starts; a refused invocation writes nothing, so the move before the refusal is never seen.
   */
  moveTicket(ticketId: string, targetStatus: TicketStatus, request: TicketMoveRequest, at: string): TicketMoved {
    const ticket     = this.requireTicket(ticketId);
    const { status } = ticket.frontmatter;
    if (status === targetStatus) throw new BoardRefusal({ reason: 'ticket-already-in-status', ticketId, status });
    if (request.checksLegality && !TicketMoveUtil.ticketMoveIsLegal(status, targetStatus)) {
      throw new BoardRefusal({
        reason: 'illegal-ticket-move',
        ticketId,
        status,
        targetStatus,
      });
    }
    if (targetStatus === 'abandoned' && (request.reason === undefined || request.reason.trim() === '')) {
      throw new BoardRefusal({ reason: 'abandon-without-reason', ticketId });
    }

    const moveRecord = this.applyTicketMove(ticket, targetStatus, request, at);
    if (request.tokens !== undefined) {
      if (ticket.frontmatter.task === null) throw new BoardRefusal({ reason: 'tokens-without-a-row', ticketId });
      const row = this.taskRecordById(ticket.frontmatter.task);
      if (row !== undefined) row.tokens = request.tokens;
    }
    // A reviewer is at work only while the ticket is in review, so every move out of it ends the bar, as a release does.
    const closed: ReviewBarsClosed = targetStatus === 'in-review' ? { bars: [], logged: [] } : this.closeInProgressReviewBars([ticketId], at);
    return { logged: [moveRecord, ...closed.logged], ticket, closedReviewBars: closed.bars };
  }

  /** The one move that leaves a ticket in its status: a further review pass is still review, so only `updated` moves and the row counts the round. */
  rereviewTicket(ticketId: string, at: string): TicketChanged {
    const ticket          = this.requireTicket(ticketId);
    const { frontmatter } = ticket;
    if (frontmatter.status !== 'in-review') throw new BoardRefusal({ reason: 'rereview-outside-review', ticketId, status: frontmatter.status });

    frontmatter.updated = at;
    const task          = this.ensureTaskForTicket(ticket, at);
    this.transitionTaskInPlace(task, 're-review', at);
    this.markChanged(ticket);
    return { logged: [this.logger.ticketRereviewed(ticketId, task.reviewRound ?? FIRST_REPEAT_REVIEW_ROUND, at)], ticket };
  }

  /**
   * Closes the ticket's in-progress review bars and starts the next one in the same change, so the ticket's slot is never free between
   * two agents. The round is the caller's to count from the ticket's body, so the Board reads no markdown; it names the bar and is stored on it.
   */
  startReviewBar(ticketId: string, request: ReviewBarRequest, at: string): ReviewBarStarted {
    const ticket = this.requireTicket(ticketId);
    const closed = this.closeInProgressReviewBars([ticketId], at);
    const bar    = this.fileTask({
      name:           TicketChartUtil.reviewBarNameOf(request.round, ticket.frontmatter),
      filedAt:        at,
      reviewOf:       ticketId,
      reviewBarRound: request.round,
      ...(request.owner === undefined ? {} : { owner: request.owner }),
      ...(request.note === undefined ? {} : { note: request.note }),
    });
    this.transitionTaskInPlace(bar, 'in-progress', at);
    const bundleAgentKey = this.agentKeyOfABundleStillInProgress(ticket);
    if (bundleAgentKey !== null) bar.agent = bundleAgentKey;
    const started = this.logger.reviewBarStarted({ taskId: bar.id, ticketId, name: bar.name }, at);
    return { logged: [...closed.logged, started], bar, closedBars: closed.bars };
  }

  setTicketDependencies(ticketId: string, dependsOn: readonly string[], at: string): TicketChanged {
    const ticket = this.requireTicket(ticketId);
    this.refuseAnUnworkableDependencyList(ticketId, dependsOn);
    if (dependsOn.length === 0) delete ticket.frontmatter.dependsOn;
    else ticket.frontmatter.dependsOn = [...dependsOn];
    this.markChanged(ticket);
    return { logged: [this.logger.ticketDependenciesSet(ticketId, dependsOn, at)], ticket };
  }

  /**
   * A start plus the row's agent key, owner and note for every ticket named, as one agent, refused rather than warned: the claim
   * is all or nothing, so two claims racing for the last slot cannot both pass the count.
   */
  claimTickets(ticketIds: readonly string[], assignment: AgentAssignment, at: string): TicketsClaimed {
    const claimedTicketIds = [...new Set(ticketIds)].sort((a, b) => a.localeCompare(b));
    const claimedTickets   = claimedTicketIds.map((ticketId) => this.requireTicket(ticketId));
    for (const ticket of claimedTickets) this.refuseAnUnclaimableTicket(ticket, claimedTicketIds);
    for (const ticketId of claimedTicketIds) this.refuseATicketUnderReview(ticketId);
    const { agentsInFlight, limit } = this.concurrency();
    if (agentsInFlight >= limit) {
      throw new BoardRefusal({
        reason:             'concurrency-limit-reached',
        ticketIds:          claimedTicketIds,
        agentsInFlight,
        inProgressRowCount: this.progress.tasks.filter((task) => task.status === 'in-progress').length,
        limit,
      });
    }

    // Every id of the claim, not the lowest alone: a bundle ticket reopened and claimed on its own must not share a key with the rest
    // still in progress.
    const agentKey = claimedTicketIds.join(BUNDLE_AGENT_KEY_SEPARATOR);
    const logged   = claimedTickets.map((ticket) => {
      const moveRecord = this.applyTicketMove(ticket, 'in-progress', {}, at);
      const row        = ticket.frontmatter.task === null ? undefined : this.taskRecordById(ticket.frontmatter.task);
      if (row !== undefined) {
        row.agent = agentKey;
        if (assignment.owner !== undefined) row.owner = assignment.owner;
        if (assignment.note !== undefined) row.note = assignment.note;
      }
      return moveRecord;
    });
    return { logged, tickets: claimedTickets, concurrency: this.concurrency() };
  }

  /** Each ticket is reviewed and then delivered, in the order given, and every in-progress review bar of them is closed after the moves. */
  releaseTickets(ticketIds: readonly string[], release: TicketRelease, at: string): TicketsReleased {
    const releasedTickets = [...new Set(ticketIds)].map((ticketId) => this.requireTicket(ticketId));
    const unreleasable    = releasedTickets.find((ticket) => !this.ticketIsReleasable(ticket));
    if (unreleasable !== undefined) {
      throw new Error(`Ticket #${unreleasable.frontmatter.id} is ${unreleasable.frontmatter.status}; a caller refuses such a release before asking for it.`);
    }

    const logged: LogRecord[] = [];
    for (const ticket of releasedTickets) {
      logged.push(this.applyTicketMove(ticket, 'reviewed', {}, at));
      logged.push(this.applyTicketMove(ticket, 'delivered', release, at));
    }
    // The reviewer releases as the last step of its pass, so its bar is closed here rather than left in progress until the verdict is read.
    const closed = this.closeInProgressReviewBars(releasedTickets.map((ticket) => ticket.frontmatter.id), at);
    return { logged: [...logged, ...closed.logged], tickets: releasedTickets, closedReviewBars: closed.bars };
  }

  /**
   * A row another ticket owns moves only with `movesTheLink`, and that ticket lets go of it when it named the row; the row the ticket
   * leaves stays as a free-standing row. Nothing is logged, as a link says which row draws the ticket rather than what the work did.
   */
  linkTicketToTask(ticketId: string, taskId: number, request: { movesTheLink: boolean }): Readonly<Ticket> {
    const ticket = this.requireTicket(ticketId);
    const task   = this.requireTask(taskId);
    if (task.ticket !== null && task.ticket !== ticketId) {
      if (!request.movesTheLink) {
        throw new BoardRefusal({
          reason:         'task-belongs-to-another-ticket',
          taskId,
          owningTicketId: task.ticket,
          ticketId,
        });
      }
      const previousOwner = this.ticketRecordByReference(task.ticket);
      if (previousOwner !== undefined && previousOwner.frontmatter.task === taskId) {
        previousOwner.frontmatter.task = null;
        this.markChanged(previousOwner);
      }
    }

    const { frontmatter } = ticket;
    if (frontmatter.task !== null && frontmatter.task !== taskId) {
      const rowLeftBehind = this.taskRecordById(frontmatter.task);
      if (rowLeftBehind !== undefined) rowLeftBehind.ticket = null;
    }
    task.ticket      = ticketId;
    frontmatter.task = taskId;
    this.markChanged(ticket);
    return ticket;
  }

  /**
   * Lowering to low is refused unless the ticket is pending, and removes its row; raising a low ticket gives it a row at once, seeded from
   * its stamps when it is no longer pending, the way a clearing would, so an abandoned ticket does not come back as a pending bar.
   */
  setTicketPriority(ticketId: string, priority: TicketPriority, at: string): TicketChanged {
    const ticket          = this.requireTicket(ticketId);
    const { frontmatter } = ticket;
    const { status }      = frontmatter;
    const currentPriority = TicketDefaultsUtil.ticketPriorityOf(frontmatter);
    if (currentPriority === priority) {
      throw new BoardRefusal({
        reason: 'priority-unchanged',
        ticketId,
        status,
        priority,
      });
    }
    if (priority === 'low' && status !== 'pending') throw new BoardRefusal({ reason: 'lowering-a-ticket-that-is-not-pending', ticketId, status });

    frontmatter.priority = priority;
    const linkedTask     = frontmatter.task === null ? undefined : this.taskRecordById(frontmatter.task);
    if (priority === 'low') {
      if (linkedTask !== undefined) this.progress.tasks.splice(this.progress.tasks.indexOf(linkedTask), 1);
      frontmatter.task = null;
    } else if (linkedTask === undefined && status === 'pending') {
      this.ensureTaskForTicket(ticket, at);
    } else if (linkedTask === undefined) {
      this.seedTaskFromTicket(ticket);
    }
    this.markChanged(ticket);
    return { logged: [this.logger.ticketPriorityChanged(ticketId, { from: currentPriority, to: priority }, at)], ticket };
  }

  /** Judged on the resolved pair, so naming the default a ticket already runs on is refused as no change. */
  setTicketAgents(ticketId: string, agents: AgentChoice, at: string): TicketChanged {
    const ticket          = this.requireTicket(ticketId);
    const { frontmatter } = ticket;
    const { status }      = frontmatter;
    if (SETTLED_TICKET_STATUSES.includes(status)) throw new BoardRefusal({ reason: 'agents-of-a-settled-ticket', ticketId, status });
    const currentAgents: AgentPair   = { model: TicketDefaultsUtil.agentModelOf(frontmatter), effort: TicketDefaultsUtil.agentEffortOf(frontmatter) };
    const requestedAgents: AgentPair = { model: agents.model ?? currentAgents.model, effort: agents.effort ?? currentAgents.effort };
    if (currentAgents.model === requestedAgents.model && currentAgents.effort === requestedAgents.effort) {
      throw new BoardRefusal({
        reason: 'agents-unchanged',
        ticketId,
        status,
        agents: currentAgents,
      });
    }

    if (agents.model !== undefined) frontmatter.model = agents.model;
    if (agents.effort !== undefined) frontmatter.effort = agents.effort;
    this.markChanged(ticket);
    return { logged: [this.logger.ticketAgentsChanged(ticketId, { from: currentAgents, to: requestedAgents }, at)], ticket };
  }

  /** An empty reason still holds: the hold is the key's presence, not its text. */
  holdTicket(ticketId: string, reason: string, at: string): TicketChanged {
    const ticket = this.requireTicket(ticketId);
    refuseAHoldChangeOfASettledTicket(ticket, 'hold');
    if (ticket.frontmatter.hold !== undefined) throw new BoardRefusal({ reason: 'ticket-already-held', ticketId });
    ticket.frontmatter.hold = reason;
    this.markChanged(ticket);
    return { logged: [this.logger.ticketHeld(ticketId, reason, at)], ticket };
  }

  unholdTicket(ticketId: string, at: string): TicketChanged {
    const ticket = this.requireTicket(ticketId);
    refuseAHoldChangeOfASettledTicket(ticket, 'unhold');
    if (ticket.frontmatter.hold === undefined) throw new BoardRefusal({ reason: 'ticket-not-held', ticketId });
    delete ticket.frontmatter.hold;
    this.markChanged(ticket);
    return { logged: [this.logger.ticketUnheld(ticketId, at)], ticket };
  }

  /**
   * Empties the rows in place rather than replacing the progress, so the tracker id readers key their choices by and the id counter survive.
   * A surviving ticket is re-seeded from its own stamps, except a low ticket with no row; what becomes of the log is the sink's to decide.
   */
  clearTracker(request: { ticketsSurvive: boolean }, at: string): TrackerCleared {
    const removedTaskCount     = this.progress.tasks.length;
    this.progress.startedAt    = at;
    this.progress.view         = { kind: 'auto' };
    this.progress.tasks.length = 0;
    const logged               = [this.logger.trackerCleared(at)];

    if (!request.ticketsSurvive) {
      this.ticketRecords.length = 0;
      return { logged, removedTaskCount, survivingTicketCount: 0 };
    }
    for (const ticket of this.ticketRecords) {
      // A reopen clears `started`, so the row the ticket held before the clear is what says it was worked.
      const ticketHadNoRowToLose = ticket.frontmatter.task === null && TicketChartUtil.ticketStaysOffTheChart(ticket.frontmatter);
      if (!ticketHadNoRowToLose) this.seedTaskFromTicket(ticket);
      this.markChanged(ticket);
    }
    return { logged, removedTaskCount, survivingTicketCount: this.ticketRecords.length };
  }

  tasks(): readonly Readonly<Task>[] {
    return this.progress.tasks;
  }

  tickets(): readonly Readonly<Ticket>[] {
    return this.ticketRecords;
  }

  /** Reads `3`, `#3` and `003` alike, as a typed reference may be any of them. */
  ticketByReference(reference: string): Readonly<Ticket> | undefined {
    return this.ticketRecordByReference(reference);
  }

  concurrency(): Concurrency {
    return ConcurrencyUtil.concurrencyOf(this.progress.tasks, this.progress.concurrencyLimit);
  }

  dispatcherState(): DispatcherState {
    return this.progress.dispatcherState ?? DEFAULT_DISPATCHER_STATE;
  }

  dispatcherRunId(): string | undefined {
    return this.progress.dispatcherRunId;
  }

  /** In the order to take them: high first, then by id, with low tickets held back while normal or high work is still owed. */
  readyTickets(): readonly Readonly<Ticket>[] {
    const readyTicketIds = TicketDependencyUtil.readyTicketIdsOf(this.ticketRecords.map((ticket) => ticket.frontmatter));
    return readyTicketIds.flatMap((ticketId) => this.ticketRecordById(ticketId) ?? []);
  }

  /** Read from the ready tickets, as `readyTicketIds` is, so the two lists cannot disagree on a member or the order; defaults resolved here. */
  readyTicketEntries(): ReadyTicket[] {
    return this.readyTickets().map(({ frontmatter }) => ({
      id:       frontmatter.id,
      priority: TicketDefaultsUtil.ticketPriorityOf(frontmatter),
      model:    TicketDefaultsUtil.agentModelOf(frontmatter),
      effort:   TicketDefaultsUtil.agentEffortOf(frontmatter),
      ...(frontmatter.hold === undefined ? {} : { held: true as const }),
    }));
  }

  /** Every held ticket a dispatcher could still start a step of, in progress or in review as much as ready. */
  heldTicketIds(): string[] {
    return this.ticketRecords
      .filter((ticket) => ticket.frontmatter.hold !== undefined && !SETTLED_TICKET_STATUSES.includes(ticket.frontmatter.status))
      .map((ticket) => ticket.frontmatter.id);
  }

  /**
   * What a dispatcher needs to start the next agent: the limit, the agents in flight against it, what is left, and the tickets that could take it —
   * in the order to take them, high first, with low tickets held back while normal or high work is still owed — and where the user left the dispatcher.
   */
  dispatchCapacity(): DispatchCapacity {
    return {
      ...this.concurrency(),
      readyTicketIds:  this.readyTickets().map((ticket) => ticket.frontmatter.id),
      dispatcherState: this.dispatcherState(),
      heldTicketIds:   this.heldTicketIds(),
    };
  }

  /** A dependency missing from the board counts as unsettled: a ticket nobody can see is not finished work. */
  unsettledDependenciesOf(ticketId: string): string[] {
    const ticket     = this.requireTicket(ticketId);
    const statusById = new Map(this.ticketRecords.map((candidate) => [candidate.frontmatter.id, candidate.frontmatter.status]));
    return TicketDependencyUtil.unsettledDependenciesOf(ticket.frontmatter.dependsOn ?? [], statusById);
  }

  /** Judges the record handed in, so a ticket file a hand edit gave another's id answers for itself. */
  waitingOnOf(ticket: Readonly<Ticket>): string[] {
    const statusById = new Map(this.ticketRecords.map((candidate) => [candidate.frontmatter.id, candidate.frontmatter.status]));
    return TicketDependencyUtil.waitingOnOf(ticket.frontmatter, statusById);
  }

  /** The normal and high tickets a low ticket waits behind; empty for a ticket that is not low, and once none is owed. */
  ticketIdsHoldingBack(ticketId: string): string[] {
    const ticket = this.requireTicket(ticketId);
    if (TicketDefaultsUtil.ticketPriorityOf(ticket.frontmatter) !== 'low') return [];
    return TicketDependencyUtil.ticketsHoldingBackLowPriorityWork(this.ticketRecords.map((candidate) => candidate.frontmatter));
  }

  /** Only an in-progress ticket has a build to resume; a ticket that moved on took its row along. */
  pausedBuildRowOf(ticketId: string): Readonly<Task> | null {
    if (this.requireTicket(ticketId).frontmatter.status !== 'in-progress') return null;
    const row = this.linkedRowOf(ticketId);
    return row?.status === 'paused' ? row : null;
  }

  /** In row order, once each. */
  inProgressTicketIds(): string[] {
    return [...new Set(this.progress.tasks.flatMap((task) => (task.status === 'in-progress' && task.ticket !== null ? [task.ticket] : [])))];
  }

  /** Matches `reviewOf` on any row, as a claim and the moves out of review do, so a ticket-owned row storing it counts; in row order, once each. */
  inProgressReviewOfIds(): string[] {
    return [...new Set(this.progress.tasks.flatMap((task) => (task.status === 'in-progress' && task.reviewOf !== undefined ? [task.reviewOf] : [])))];
  }

  /** Every row whose `reviewOf` is the ticket, a ticket-owned one included, as `inProgressReviewOfIds` reads them; oldest filed first. */
  reviewRowsOf(ticketId: string): readonly Readonly<Task>[] {
    return this.progress.tasks.filter((task) => task.reviewOf === ticketId).toSorted((a, b) => a.id - b.id);
  }

  /** The in-review tickets no reviewer is at work on, held ones included: a caller reads the holds from `heldTicketIds`. */
  reviewWaitingTickets(): readonly Readonly<Ticket>[] {
    const ticketIdsUnderReview = this.inProgressReviewOfIds();
    return this.ticketRecords.filter((ticket) => ticket.frontmatter.status === 'in-review' && !ticketIdsUnderReview.includes(ticket.frontmatter.id));
  }

  /** The row the ticket's frontmatter `task` names, which the ticket verbs move; `ownRowOf` is the first row naming the ticket, which a reader draws. */
  linkedRowOf(ticketId: string): Readonly<Task> | null {
    const { task } = this.requireTicket(ticketId).frontmatter;
    if (task === null) return null;
    return this.taskRecordById(task) ?? null;
  }

  /** A release reviews the ticket on its way to delivering it, so it takes the tickets a move to `reviewed` is legal from. */
  ticketIsReleasable(ticket: Readonly<Ticket>): boolean {
    return TicketMoveUtil.ticketMoveIsLegal(ticket.frontmatter.status, 'reviewed');
  }

  /** Read on the record handed in rather than looked up by id, so a hand-duplicated id cannot borrow another row's verdict. */
  taskIsSettled(task: Readonly<Task>): boolean {
    return SETTLED_TASK_STATUSES.includes(task.status);
  }

  ticketIsSettled(ticket: Readonly<Ticket>): boolean {
    return SETTLED_TICKET_STATUSES.includes(ticket.frontmatter.status);
  }

  /** Oldest filed first; free-standing rows only, since a ticket's own row is never a review bar; a bar naming a missing ticket is still returned. */
  reviewBarsOf(ticketId: string): readonly Readonly<Task>[] {
    return this.reviewBarRecordsOf(ticketId);
  }

  /** The first row whose `ticket` is the id, which may differ from the row the ticket's frontmatter `task` points at. */
  ownRowOf(ticketId: string): Readonly<Task> | null {
    return this.progress.tasks.find((task) => task.ticket === ticketId) ?? null;
  }

  /** Read on the record handed in, like `taskIsSettled`. */
  rowDisplayStateOf(task: Readonly<Task>): DisplayState {
    return displayStateFor(task.status, this.ticketStatusOfRow(task));
  }

  /** Read on the record handed in, like `rowDisplayStateOf`; a ticket without a row shows what a row in its own status would. */
  ticketDisplayStateOf(ticket: Readonly<Ticket>): DisplayState {
    const { id, status } = ticket.frontmatter;
    return displayStateFor(this.ownRowOf(id)?.status ?? status, status);
  }

  deliveredRowCountsAsReviewed(task: Readonly<Task>): boolean {
    // A delivered ticket passed `reviewed`, so its row counts without a stamp; this stays a query because ingestion would have to invent
    // the stamp and read the ticket files.
    return task.status === 'delivered' && (task.reviewed !== undefined || this.ticketStatusOfRow(task) === 'delivered');
  }

  changedTickets(): readonly Ticket[] {
    return this.changedTicketRecords;
  }

  private markChanged(ticket: Ticket): void {
    if (!this.changedTicketRecords.includes(ticket)) this.changedTicketRecords.push(ticket);
  }

  private taskRecordById(taskId: number): Task | undefined {
    return this.progress.tasks.find((task) => task.id === taskId);
  }

  private ticketRecordById(ticketId: string): Ticket | undefined {
    return this.ticketRecords.find((ticket) => ticket.frontmatter.id === ticketId);
  }

  private ticketStatusOfRow(task: Readonly<Task>): TicketStatus | null {
    if (task.ticket === null) return null;
    return this.ticketRecordById(task.ticket)?.frontmatter.status ?? null;
  }

  private reviewBarRecordsOf(ticketId: string): ReviewBar[] {
    return this.progress.tasks
      .filter((task): task is ReviewBar => task.ticket === null && task.reviewOf === ticketId)
      .toSorted((a, b) => a.id - b.id);
  }

  private ticketRecordByReference(reference: string): Ticket | undefined {
    const ticketId = TicketIdUtil.parseTicketReference(reference);
    if (ticketId === null) return undefined;
    return this.ticketRecordById(ticketId);
  }

  private requireTask(taskId: number): Task {
    const task = this.taskRecordById(taskId);
    if (task === undefined) throw new BoardRefusal({ reason: 'unknown-task', taskId });
    return task;
  }

  /** A caller hands in an id it resolved itself, so a miss here is a programming error rather than a refusal to word. */
  private requireTicket(ticketId: string): Ticket {
    const ticket = this.ticketRecordById(ticketId);
    if (ticket === undefined) throw new Error(`The board holds no ticket #${ticketId}.`);
    return ticket;
  }

  /** The counter is stored and never wound back, so a row removal or a clearing cannot hand a live row's id to a new one. */
  private takeNextTaskId(): number {
    const highestExistingId  = this.progress.tasks.reduce((highest, task) => Math.max(highest, task.id), 0);
    const allocated          = Math.max(this.progress.nextTaskId, highestExistingId + 1);
    this.progress.nextTaskId = allocated + 1;
    return allocated;
  }

  private fileTask(filing: TaskFiling): Task {
    const task = TaskFilingUtil.filedTaskOf(this.takeNextTaskId(), filing);
    this.progress.tasks.push(task);
    return task;
  }

  /** Callers hold the record across a move, so the moved row is written into the same object; a key it keeps stays where the file stores it. */
  private transitionTaskInPlace(task: Task, status: TaskStatus, at: string): void {
    const transitioned = TaskTransitionUtil.transitionedTaskOf(task, status, at);
    for (const key of Object.keys(task)) {
      if (!Object.hasOwn(transitioned, key)) Reflect.deleteProperty(task, key);
    }
    Object.assign(task, transitioned);
  }

  /** An existing row comes back untouched, so a row a forced link deliberately moved is never taken back. */
  private ensureTaskForTicket(ticket: Ticket, at: string): Task {
    const { frontmatter } = ticket;
    const linkedTask      = frontmatter.task === null ? undefined : this.taskRecordById(frontmatter.task);
    if (linkedTask !== undefined) return linkedTask;

    const filed = this.fileTask({
      name:    TicketChartUtil.rowNameOf(frontmatter),
      ticket:  frontmatter.id,
      status:  'pending',
      filedAt: at,
    });
    frontmatter.task = filed.id;
    return filed;
  }

  /** `ensureTaskForTicket`, except that a rowless ticket staying off the chart is given no row and `null` comes back. */
  private ensureTaskForTicketOnTheChart(ticket: Ticket, at: string): Task | null {
    const { frontmatter } = ticket;
    const linkedTask      = frontmatter.task === null ? undefined : this.taskRecordById(frontmatter.task);
    if (linkedTask === undefined && TicketChartUtil.ticketStaysOffTheChart(frontmatter)) return null;
    return this.ensureTaskForTicket(ticket, at);
  }

  /** A row in the ticket's own status spanning its stamps, filed for a ticket that has none by a clearing and by a raised priority. */
  private seedTaskFromTicket(ticket: Ticket): void {
    ticket.frontmatter.task = this.fileTask(TicketChartUtil.seededFilingOf(ticket.frontmatter)).id;
  }

  /** The move itself, unchecked: the status, its stamps and the fields given, and the row taking the same status. */
  private applyTicketMove(ticket: Ticket, targetStatus: TicketStatus, fields: TicketMoveFields, at: string): LogRecord {
    const { frontmatter } = ticket;
    frontmatter.status      = targetStatus;
    frontmatter.updated     = at;
    const stamps            = TicketStampUtil.stampsAfterMoveOf(frontmatter, targetStatus, at);
    frontmatter.started     = stamps.started;
    frontmatter.finished    = stamps.finished;
    frontmatter.delivered   = stamps.delivered;
    frontmatter.abandonedAt = stamps.abandonedAt;
    if (stamps.clearsReason) delete frontmatter.reason;
    if (fields.branch !== undefined) frontmatter.branch = fields.branch;
    if (fields.commit !== undefined) frontmatter.commit = fields.commit;
    if (fields.reason !== undefined) frontmatter.reason = fields.reason;

    const task = this.ensureTaskForTicketOnTheChart(ticket, at);
    if (task !== null) this.transitionTaskInPlace(task, targetStatus, at);
    this.markChanged(ticket);
    return this.logTicketMove(frontmatter, targetStatus, at);
  }

  /** `pending` is logged as a reopen: a ticket's first `pending` is its filing, which `fileTicket` logs. */
  private logTicketMove(frontmatter: Readonly<TicketFrontmatter>, targetStatus: TicketStatus, at: string): LogRecord {
    const { id } = frontmatter;
    switch (targetStatus) {
      case 'pending':
        return this.logger.ticketReopened(id, at);
      case 'in-progress':
        return this.logger.ticketStarted(id, at);
      case 'in-review':
        return this.logger.ticketFinished(id, at);
      case 'reviewed':
        return this.logger.ticketApproved(id, at);
      case 'delivered':
        return this.logger.ticketDelivered(id, at);
      case 'abandoned':
        return this.logger.ticketAbandoned(id, frontmatter.reason ?? '', at);
    }
  }

  /** Matches `reviewOf` on any row, unlike `reviewBarsOf`, so a ticket-owned row storing `reviewOf` is closed and blocks a claim too; in file order. */
  private inProgressReviewBarsOf(ticketIds: readonly string[]): ReviewBar[] {
    return this.progress.tasks.filter((task): task is ReviewBar => task.status === 'in-progress' && task.reviewOf !== undefined && ticketIds.includes(task.reviewOf));
  }

  /** Finishes and delivers every in-progress review bar of the tickets, one record each, for every move that ends their review. */
  private closeInProgressReviewBars(ticketIds: readonly string[], at: string): ReviewBarsClosed {
    const bars                = this.inProgressReviewBarsOf(ticketIds);
    const logged: LogRecord[] = [];
    for (const bar of bars) {
      this.transitionTaskInPlace(bar, 'in-review', at);
      this.transitionTaskInPlace(bar, 'delivered', at);
      logged.push(this.logger.reviewBarClosed({ taskId: bar.id, ticketId: bar.reviewOf, name: bar.name }, at));
    }
    return { bars, logged };
  }

  /** A bundle is one agent, so its reviewer takes no second slot while the builder still holds the claim's slot for the bundle's other tickets. */
  private agentKeyOfABundleStillInProgress(ticket: Readonly<Ticket>): string | null {
    const { task }      = ticket.frontmatter;
    const claimAgentKey = task === null ? undefined : this.taskRecordById(task)?.agent;
    if (claimAgentKey === undefined) return null;
    return this.progress.tasks.some((row) => row.status === 'in-progress' && row.agent === claimAgentKey) ? claimAgentKey : null;
  }

  /** A dependency on another ticket in the same claim is settled: one agent works a bundle in dependency order. */
  private refuseAnUnclaimableTicket(ticket: Readonly<Ticket>, claimedTicketIds: readonly string[]): void {
    const { id: ticketId, status } = ticket.frontmatter;
    if (!TicketMoveUtil.ticketMoveIsLegal(status, 'in-progress')) throw new BoardRefusal({ reason: 'unclaimable-status', ticketId, status });
    const unsettledTicketIds = this.unsettledDependenciesOf(ticketId).filter((dependencyId) => !claimedTicketIds.includes(dependencyId));
    if (unsettledTicketIds.length > 0) throw new BoardRefusal({ reason: 'claim-waits-on-dependencies', ticketId, unsettledTicketIds });
    if (ticket.frontmatter.hold !== undefined) throw new BoardRefusal({ reason: 'claim-of-a-held-ticket', ticketId });
    const holdingBackTicketIds = this.ticketIdsHoldingBack(ticketId);
    if (holdingBackTicketIds.length > 0) throw new BoardRefusal({ reason: 'claim-of-held-back-low-ticket', ticketId, holdingBackTicketIds });
  }

  // An in-progress review bar is a reviewer at work, so a builder claiming the ticket, a second dispatcher run's among them, would rebuild it in review.
  private refuseATicketUnderReview(ticketId: string): void {
    const [inProgressBar] = this.inProgressReviewBarsOf([ticketId]);
    if (inProgressBar !== undefined) throw new BoardRefusal({ reason: 'claim-under-review', ticketId, reviewBarTaskId: inProgressBar.id });
  }

  private refuseAnUnworkableDependencyList(ticketId: string, dependsOn: readonly string[]): void {
    const missingTicketIds = dependsOn.filter((dependencyId) => this.ticketRecordById(dependencyId) === undefined);
    if (missingTicketIds.length > 0) throw new BoardRefusal({ reason: 'unknown-dependency', missingTicketIds });
    const dependsOnById = new Map(this.ticketRecords.map((candidate) => [candidate.frontmatter.id, candidate.frontmatter.dependsOn ?? []]));
    const loopTicketIds = TicketDependencyUtil.dependencyLoopFrom(ticketId, dependsOn, dependsOnById);
    if (loopTicketIds !== null) throw new BoardRefusal({ reason: 'dependency-loop', loopTicketIds });
  }

  /** A ticket's share lands on the row the ticket has now, which may have been filed after the brief that named the ticket. */
  private creditTokens(credit: TokenCredit): TokenCreditOutcome {
    if (credit.target === 'row') {
      const task = this.taskRecordById(credit.taskId);
      if (task === undefined) return { verdict: 'unknown-row', taskId: credit.taskId };
      return creditTokensTo(task, credit.tokens);
    }

    // The bar's status is not consulted: release has already delivered it by the time its reviewer stops.
    if (credit.target === 'review') {
      // On a hand-duplicated id the first bar in the file wins.
      const newestBar = this.reviewBarRecordsOf(credit.ticketId)
        .reduce<ReviewBar | undefined>((newest, bar) => (newest === undefined || bar.id > newest.id ? bar : newest), undefined);
      if (newestBar === undefined) return { verdict: 'ticket-without-review-bar', ticketId: credit.ticketId };
      // Credited by id like a row share, so a hand-repeated id lands on the first row holding it.
      return creditTokensTo(this.taskRecordById(newestBar.id) ?? newestBar, credit.tokens);
    }

    const ticket = this.ticketRecordById(credit.ticketId);
    if (ticket === undefined) return { verdict: 'unknown-ticket', ticketId: credit.ticketId };
    const taskId = ticket.frontmatter.task;
    if (taskId === null) return { verdict: 'ticket-without-row', ticketId: credit.ticketId };
    const task = this.taskRecordById(taskId);
    if (task === undefined) return { verdict: 'ticket-row-missing', ticketId: credit.ticketId, taskId };
    return creditTokensTo(task, credit.tokens);
  }
}

/** Accumulates rather than sets, so an agent's tokens reach a row other agents have already worked on; an unset count counts as 0. */
function creditTokensTo(task: Task, tokens: number): TokenCreditOutcome {
  task.tokens = (task.tokens ?? 0) + tokens;
  return { verdict: 'credited', taskId: task.id };
}

function displayStateFor(status: TaskStatus, ticketStatus: TicketStatus | null): DisplayState {
  return status === 'in-review' && ticketStatus === 'in-review' ? 'reviewing' : status;
}

/** A row a ticket owns moves through the ticket so the two files cannot disagree; a pause and its resume are exempt, as no ticket status says either. */
function refuseATicketOwnedMove(task: Readonly<Task>, targetStatus: TaskStatus, movesAnyway: boolean): void {
  if (task.ticket === null || movesAnyway) return;
  if (targetStatus === 'paused') return;
  if (targetStatus === 'in-progress' && task.status === 'paused') return;
  throw new BoardRefusal({
    reason:   'ticket-owned-row',
    taskId:   task.id,
    ticketId: task.ticket,
    targetStatus,
  });
}

function refuseAHoldChangeOfASettledTicket(ticket: Readonly<Ticket>, action: 'hold' | 'unhold'): void {
  const { id: ticketId, status } = ticket.frontmatter;
  if (!SETTLED_TICKET_STATUSES.includes(status)) return;
  throw new BoardRefusal({
    reason: 'hold-of-a-settled-ticket',
    ticketId,
    status,
    action,
  });
}
