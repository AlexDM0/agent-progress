/** Why the Board refused a change: a reason code and the facts, never a sentence. The caller words it. */
import type { TaskStatus }                              from './@types/Task.ts';
import type { AgentPair, TicketPriority, TicketStatus } from './@types/Ticket.ts';

export type BoardRefusalDetail =
  | { reason: 'unknown-task'; taskId: number }
  | { reason: 'ticket-owned-row'; taskId: number; ticketId: string; targetStatus: Exclude<TaskStatus, 'paused'> }
  | { reason: 'ticket-already-has-row'; ticketId: string; taskId: number; taskName: string }
  | { reason: 'task-belongs-to-another-ticket'; taskId: number; owningTicketId: string; ticketId: string }
  | { reason: 'ticket-already-in-status'; ticketId: string; status: TicketStatus }
  | { reason: 'illegal-ticket-move'; ticketId: string; status: TicketStatus; targetStatus: TicketStatus }
  | { reason: 'abandon-without-reason'; ticketId: string }
  | { reason: 'tokens-without-a-row'; ticketId: string }
  | { reason: 'rereview-outside-review'; ticketId: string; status: TicketStatus }
  | { reason: 'unclaimable-status'; ticketId: string; status: TicketStatus }
  | { reason: 'claim-waits-on-dependencies'; ticketId: string; unsettledTicketIds: readonly string[] }
  | { reason: 'claim-of-a-held-ticket'; ticketId: string }
  | { reason: 'claim-of-held-back-low-ticket'; ticketId: string; holdingBackTicketIds: readonly string[] }
  | { reason: 'claim-under-review'; ticketId: string; reviewBarTaskId: number }
  | { reason: 'concurrency-limit-reached'; ticketIds: readonly string[]; agentsInFlight: number; inProgressRowCount: number; limit: number }
  | { reason: 'unknown-dependency'; missingTicketIds: readonly string[] }
  | { reason: 'dependency-loop'; loopTicketIds: readonly string[] }
  | { reason: 'priority-unchanged'; ticketId: string; status: TicketStatus; priority: TicketPriority }
  | { reason: 'lowering-a-ticket-that-is-not-pending'; ticketId: string; status: TicketStatus }
  | { reason: 'agents-of-a-settled-ticket'; ticketId: string; status: TicketStatus }
  | { reason: 'agents-unchanged'; ticketId: string; status: TicketStatus; agents: AgentPair }
  | { reason: 'hold-of-a-settled-ticket'; ticketId: string; status: TicketStatus; action: 'hold' | 'unhold' }
  | { reason: 'ticket-already-held'; ticketId: string }
  | { reason: 'ticket-not-held'; ticketId: string };

export class BoardRefusal extends Error {
  readonly detail: BoardRefusalDetail;

  constructor(detail: BoardRefusalDetail) {
    super(detail.reason);
    // Extending a built-in leaves `name` as `Error`, and the name is what an unhandled stack trace shows.
    this.name = 'BoardRefusal';
    this.detail = detail;
  }
}

export function refusalIsBoardRefusal(error: unknown): error is BoardRefusal {
  return error instanceof BoardRefusal;
}
