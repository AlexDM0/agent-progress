/**
 * The Board's rows as rows: filed, moved, corrected, annotated and removed directly, and linked to the ticket they draw, with the ticket
 * side of every link kept in step so the two files never disagree.
 */
import type { TaskAddition, TaskAnnotation, TaskCorrection } from './@types/BoardChanges.ts';
import type { Task, TaskStatus }                             from './@types/Task.ts';
import type { Ticket }                                       from './@types/Ticket.ts';
import type { BoardRecords }                                 from './BoardRecords.ts';
import { BoardRefusal }                                      from './BoardRefusal.ts';

export class TaskRows {
  constructor(private readonly records: BoardRecords) {}

  /** Moving the link off the ticket's existing row leaves that row free-standing rather than deleting it. */
  addTask(addition: TaskAddition, at: string): Readonly<Task> {
    const ticket = addition.ticketId === undefined ? null : this.records.requireTicket(addition.ticketId);
    if (ticket !== null && ticket.frontmatter.task !== null) {
      const alreadyLinked = this.records.taskRecordById(ticket.frontmatter.task);
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

    const filed = this.records.fileTask({
      name:    addition.name,
      filedAt: at,
      ...(addition.owner === undefined ? {} : { owner: addition.owner }),
      ...(addition.note === undefined ? {} : { note: addition.note }),
      ...(addition.tokens === undefined ? {} : { tokens: addition.tokens }),
      ...(ticket === null ? {} : { ticket: ticket.frontmatter.id }),
      ...(addition.reviewOf === undefined ? {} : { reviewOf: addition.reviewOf.ticketId, reviewBarRound: addition.reviewOf.round }),
    });
    if (addition.startsNow) this.records.transitionTaskInPlace(filed, 'in-progress', at);

    if (ticket !== null) {
      ticket.frontmatter.task = filed.id;
      this.records.markChanged(ticket);
    }
    return filed;
  }

  moveTask(taskId: number, status: TaskStatus, request: { movesAnyway: boolean }, at: string): Readonly<Task> {
    const task = this.records.requireTask(taskId);
    refuseATicketOwnedMove(task, status, request.movesAnyway);
    this.records.transitionTaskInPlace(task, status, at);
    return task;
  }

  /** A correction moves no timestamp and files no phase, unlike `moveTask`. */
  correctTask(taskId: number, correction: TaskCorrection, request: { movesAnyway: boolean }): Readonly<Task> {
    const task = this.records.requireTask(taskId);
    if (correction.status !== undefined) refuseATicketOwnedMove(task, correction.status, request.movesAnyway);
    if (correction.name !== undefined) task.name = correction.name;
    if (correction.status !== undefined) task.status = correction.status;
    return task;
  }

  annotateTask(taskId: number, annotation: TaskAnnotation): Readonly<Task> {
    const task = this.records.requireTask(taskId);
    if (annotation.owner !== undefined) task.owner = annotation.owner;
    if (annotation.note !== undefined) task.note = annotation.note;
    if (annotation.tokens !== undefined) task.tokens = annotation.tokens;
    return task;
  }

  /** The ticket is unlinked in the same change, so the two files never disagree about a row that is gone. */
  removeTask(taskId: number): Readonly<Task> {
    const task = this.records.requireTask(taskId);
    this.records.removeTaskRecord(task);

    const ticket = task.ticket === null ? undefined : this.records.ticketRecordByReference(task.ticket);
    if (ticket !== undefined && ticket.frontmatter.task === taskId) {
      ticket.frontmatter.task = null;
      this.records.markChanged(ticket);
    }
    return task;
  }

  /**
   * A row another ticket owns moves only with `movesTheLink`, and that ticket lets go of it when it named the row; the row the ticket
   * leaves stays as a free-standing row. Nothing is logged, as a link says which row draws the ticket rather than what the work did.
   */
  linkTicketToTask(ticketId: string, taskId: number, request: { movesTheLink: boolean }): Readonly<Ticket> {
    const ticket = this.records.requireTicket(ticketId);
    const task   = this.records.requireTask(taskId);
    if (task.ticket !== null && task.ticket !== ticketId) {
      if (!request.movesTheLink) {
        throw new BoardRefusal({
          reason:         'task-belongs-to-another-ticket',
          taskId,
          owningTicketId: task.ticket,
          ticketId,
        });
      }
      const previousOwner = this.records.ticketRecordByReference(task.ticket);
      if (previousOwner !== undefined && previousOwner.frontmatter.task === taskId) {
        previousOwner.frontmatter.task = null;
        this.records.markChanged(previousOwner);
      }
    }

    const { frontmatter } = ticket;
    if (frontmatter.task !== null && frontmatter.task !== taskId) {
      const rowLeftBehind = this.records.taskRecordById(frontmatter.task);
      if (rowLeftBehind !== undefined) rowLeftBehind.ticket = null;
    }
    task.ticket      = ticketId;
    frontmatter.task = taskId;
    this.records.markChanged(ticket);
    return ticket;
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
