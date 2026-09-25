/**
 * The tracker's aggregate for one invocation: the compound changes to rows and tickets, the queries over them, and which tickets it
 * changed. It does no I/O, logs through the `Logger` and refuses with a `BoardRefusal`; it changes the records it was handed in place.
 */
import type {
  ConcurrencyLimitSet,
  DispatcherStateSet,
  Logged,
  TaskAddition,
  TaskAnnotation,
  TaskCorrection
}                                                        from './@types/BoardChanges.ts';
import type { Concurrency }                              from './@types/Concurrency.ts';
import type { DispatcherState, ProgressFile, ViewRange } from './@types/ProgressFile.ts';
import type { Task, TaskStatus }                         from './@types/Task.ts';
import type { Ticket }                                   from './@types/Ticket.ts';
import { BoardRefusal }                                  from './BoardRefusal.ts';
import type { Logger }                                   from './Logger.ts';
import { DEFAULT_DISPATCHER_STATE }                      from './constants/DispatcherStates.ts';
import { ConcurrencyUtil }                               from './utils/ConcurrencyUtil.ts';
import type { TaskFiling }                               from './utils/TaskFilingUtil.ts';
import { TaskFilingUtil }                                from './utils/TaskFilingUtil.ts';
import { TaskTransitionUtil }                            from './utils/TaskTransitionUtil.ts';
import { TicketIdUtil }                                  from './utils/TicketIdUtil.ts';

export interface BoardInput {
  progress: ProgressFile;
  tickets:  Ticket[];
  logger:   Logger;
}

export class Board {
  private readonly progress: ProgressFile;

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
      ...(addition.reviewOf === undefined ? {} : { reviewOf: addition.reviewOf }),
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

  /** A correction moves no timestamp and files no phase, which is what separates it from `moveTask`. */
  correctTask(taskId: number, correction: TaskCorrection, request: { movesAnyway: boolean }): Readonly<Task> {
    const task = this.requireTask(taskId);
    if (correction.status !== undefined) refuseATicketOwnedMove(task, correction.status, request.movesAnyway);
    if (correction.name !== undefined) task.name = correction.name;
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

  tasks(): readonly Readonly<Task>[] {
    return this.progress.tasks;
  }

  tickets(): readonly Readonly<Ticket>[] {
    return this.ticketRecords;
  }

  taskById(taskId: number): Readonly<Task> | undefined {
    return this.taskRecordById(taskId);
  }

  /** Reads `3`, `#3` and `003` alike, as a reference typed on the command line may be any of them. */
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

  changedTickets(): readonly Ticket[] {
    return this.changedTicketRecords;
  }

  private markChanged(ticket: Ticket): void {
    if (!this.changedTicketRecords.includes(ticket)) this.changedTicketRecords.push(ticket);
  }

  private taskRecordById(taskId: number): Task | undefined {
    return this.progress.tasks.find((task) => task.id === taskId);
  }

  private ticketRecordByReference(reference: string): Ticket | undefined {
    const ticketId = TicketIdUtil.parseTicketReference(reference);
    if (ticketId === null) return undefined;
    return this.ticketRecords.find((ticket) => ticket.frontmatter.id === ticketId);
  }

  private requireTask(taskId: number): Task {
    const task = this.taskRecordById(taskId);
    if (task === undefined) throw new BoardRefusal({ reason: 'unknown-task', taskId });
    return task;
  }

  /** A caller hands in an id it resolved itself, so a miss here is a programming error rather than a refusal to word. */
  private requireTicket(ticketId: string): Ticket {
    const ticket = this.ticketRecords.find((candidate) => candidate.frontmatter.id === ticketId);
    if (ticket === undefined) throw new Error(`The board holds no ticket #${ticketId}.`);
    return ticket;
  }

  /** The counter is stored and never wound back, so `task remove` and `clear` cannot hand a live row's id to a new one. */
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
