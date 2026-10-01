/**
 * The rows and tickets one Board changes in place, the logger it logs through and which tickets it changed, with the lookups and row
 * filings every rule module of the Board shares.
 */
import type { Epic }                 from './@types/Epic.ts';
import type { Task, TaskStatus }     from './@types/Task.ts';
import type { Ticket, TicketStatus } from './@types/Ticket.ts';
import type { TrackerProgress }      from './@types/TrackerProgress.ts';
import { BoardRefusal }              from './BoardRefusal.ts';
import type { Logger }               from './Logger.ts';
import type { TaskFiling }           from './utils/TaskFilingUtil.ts';
import { TaskFilingUtil }            from './utils/TaskFilingUtil.ts';
import { TaskTransitionUtil }        from './utils/TaskTransitionUtil.ts';
import { TicketChartUtil }           from './utils/TicketChartUtil.ts';
import { TicketIdUtil }              from './utils/TicketIdUtil.ts';

export class BoardRecords {
  /** In the order each ticket was first changed, once each: the order the writer writes them in. */
  readonly changedTicketRecords: Ticket[] = [];

  /** Added or edited epics, in the order each was first changed, once each; a removed one leaves this list for `removedEpicRecords`. */
  readonly changedEpicRecords: Epic[] = [];

  readonly removedEpicRecords: Epic[] = [];

  constructor(
    readonly progress: TrackerProgress,
    readonly ticketRecords: Ticket[],
    readonly epicRecords: Epic[],
    readonly logger: Logger,
  ) {}

  markChanged(ticket: Ticket): void {
    if (!this.changedTicketRecords.includes(ticket)) this.changedTicketRecords.push(ticket);
  }

  markEpicChanged(epic: Epic): void {
    if (!this.changedEpicRecords.includes(epic)) this.changedEpicRecords.push(epic);
  }

  epicRecordByKey(epicKey: string): Epic | undefined {
    return this.epicRecords.find((epic) => epic.frontmatter.key === epicKey);
  }

  taskRecordById(taskId: number): Task | undefined {
    return this.progress.tasks.find((task) => task.id === taskId);
  }

  ticketRecordById(ticketId: string): Ticket | undefined {
    return this.ticketRecords.find((ticket) => ticket.frontmatter.id === ticketId);
  }

  /** The row the ticket's frontmatter `task` names, when the board holds it. */
  linkedTaskRecordOf(ticket: Readonly<Ticket>): Task | undefined {
    const { task } = ticket.frontmatter;
    return task === null ? undefined : this.taskRecordById(task);
  }

  /** Reads `3`, `#3` and `003` alike, as a typed reference may be any of them. */
  ticketRecordByReference(reference: string): Ticket | undefined {
    const ticketId = TicketIdUtil.parseTicketReference(reference);
    if (ticketId === null) return undefined;
    return this.ticketRecordById(ticketId);
  }

  ticketStatusById(): Map<string, TicketStatus> {
    return new Map(this.ticketRecords.map((candidate) => [candidate.frontmatter.id, candidate.frontmatter.status]));
  }

  requireTask(taskId: number): Task {
    const task = this.taskRecordById(taskId);
    if (task === undefined) throw new BoardRefusal({ reason: 'unknown-task', taskId });
    return task;
  }

  /** A caller hands in an id it resolved itself, so a miss here is a programming error rather than a refusal to word. */
  requireTicket(ticketId: string): Ticket {
    const ticket = this.ticketRecordById(ticketId);
    if (ticket === undefined) throw new Error(`The board holds no ticket #${ticketId}.`);
    return ticket;
  }

  fileTask(filing: TaskFiling): Task {
    const task = TaskFilingUtil.filedTaskOf(this.takeNextTaskId(), filing);
    this.progress.tasks.push(task);
    return task;
  }

  removeTaskRecord(task: Task): void {
    this.progress.tasks.splice(this.progress.tasks.indexOf(task), 1);
  }

  /** Callers hold the record across a move, so the moved row is written into the same object; a key it keeps stays where the file stores it. */
  transitionTaskInPlace(task: Task, status: TaskStatus, at: string): void {
    const transitioned = TaskTransitionUtil.transitionedTaskOf(task, status, at);
    for (const key of Object.keys(task)) {
      if (!Object.hasOwn(transitioned, key)) Reflect.deleteProperty(task, key);
    }
    Object.assign(task, transitioned);
  }

  /** An existing row comes back untouched, so a row a forced link deliberately moved is never taken back. */
  ensureTaskForTicket(ticket: Ticket, at: string): Task {
    const linkedTask = this.linkedTaskRecordOf(ticket);
    if (linkedTask !== undefined) return linkedTask;

    const { frontmatter } = ticket;
    const filed           = this.fileTask({
      name:    TicketChartUtil.rowNameOf(frontmatter),
      ticket:  frontmatter.id,
      status:  'pending',
      filedAt: at,
    });
    frontmatter.task = filed.id;
    return filed;
  }

  /** `ensureTaskForTicket`, except that a rowless ticket staying off the chart is given no row and `null` comes back. */
  ensureTaskForTicketOnTheChart(ticket: Ticket, at: string): Task | null {
    if (this.linkedTaskRecordOf(ticket) === undefined && TicketChartUtil.ticketStaysOffTheChart(ticket.frontmatter)) return null;
    return this.ensureTaskForTicket(ticket, at);
  }

  /** A row in the ticket's own status spanning its stamps, filed for a ticket that has none by a clearing and by a raised priority. */
  seedTaskFromTicket(ticket: Ticket): void {
    ticket.frontmatter.task = this.fileTask(TicketChartUtil.seededFilingOf(ticket.frontmatter)).id;
  }

  /** The counter is stored and never wound back, so a row removal or a clearing cannot hand a live row's id to a new one. */
  private takeNextTaskId(): number {
    const highestExistingId  = this.progress.tasks.reduce((highest, task) => Math.max(highest, task.id), 0);
    const allocated          = Math.max(this.progress.nextTaskId, highestExistingId + 1);
    this.progress.nextTaskId = allocated + 1;
    return allocated;
  }
}
