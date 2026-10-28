/** What a ticket is set to run with, outside its moves: its priority, which gives or takes its row, its agent pair, and its hold. */
import type { AgentChoice, TicketChanged } from './@types/BoardChanges.ts';
import type {
  AgentPair,
  Ticket,
  TicketPriority,
  TicketSize
} from './@types/Ticket.ts';
import type { BoardRecords }       from './BoardRecords.ts';
import { BoardRefusal }            from './BoardRefusal.ts';
import { SETTLED_TICKET_STATUSES } from './constants/Statuses.ts';
import { NetworkDomainUtil }       from './utils/NetworkDomainUtil.ts';
import { TicketDefaultsUtil }      from './utils/TicketDefaultsUtil.ts';

export class TicketSettings {
  constructor(private readonly records: BoardRecords) {}

  /**
   * Lowering to low is refused unless the ticket is draft or pending, and keeps its row, since priority only orders the queue; raising a low
   * ticket with no row, filed before every ready ticket had one, gives it a row at once, seeded from its stamps when it is no longer pending,
   * the way a clearing would, so an abandoned ticket does not come back as a pending bar.
   */
  setTicketPriority(ticketId: string, priority: TicketPriority, at: string): TicketChanged {
    const ticket          = this.records.requireTicket(ticketId);
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
    if (priority === 'low' && status !== 'pending' && status !== 'draft') throw new BoardRefusal({ reason: 'lowering-a-ticket-that-is-not-pending', ticketId, status });

    frontmatter.priority = priority;
    const linkedTask     = this.records.linkedTaskRecordOf(ticket);
    // A draft has no row at any priority, since `ticket ready` files it.
    const raisingFilesARow = status !== 'draft' && priority !== 'low' && linkedTask === undefined;
    if (raisingFilesARow && status === 'pending') this.records.ensureTaskForTicket(ticket, at);
    else if (raisingFilesARow) this.records.seedTaskFromTicket(ticket);
    this.records.markChanged(ticket);
    return { logged: [this.records.logger.log({ kind: 'ticket-priority-changed', ticketId, fields: { from: currentPriority, to: priority } }, at)], ticket };
  }

  /** Allowed in every status, since a settled ticket's size still feeds the statistics. */
  setTicketSize(ticketId: string, size: TicketSize, at: string): TicketChanged {
    const ticket          = this.records.requireTicket(ticketId);
    const { frontmatter } = ticket;
    const currentSize     = frontmatter.size;
    if (currentSize === size) throw new BoardRefusal({
      reason: 'size-unchanged', ticketId, status: frontmatter.status, size
    });

    frontmatter.size = size;
    this.records.markChanged(ticket);
    const fields = currentSize === undefined ? { to: size } : { from: currentSize, to: size };
    return { logged: [this.records.logger.log({ kind: 'ticket-size-changed', ticketId, fields }, at)], ticket };
  }

  /** Judged on the resolved pair, so naming the default a ticket already runs on is refused as no change. */
  setTicketAgents(ticketId: string, agents: AgentChoice, at: string): TicketChanged {
    const ticket          = this.records.requireTicket(ticketId);
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
    this.records.markChanged(ticket);
    return { logged: [this.records.logger.log({ kind: 'ticket-agents-changed', ticketId, fields: { from: currentAgents, to: requestedAgents } }, at)], ticket };
  }

  /**
   * Set only while the ticket is draft or pending, so no agent already at work gains a grant; an empty list clears the line. Every domain
   * must be public, judged after lower-casing, and the line is written only once it names one.
   */
  setTicketNetwork(ticketId: string, domains: readonly string[], at: string): TicketChanged {
    const ticket          = this.records.requireTicket(ticketId);
    const { frontmatter } = ticket;
    const { status }      = frontmatter;
    if (status !== 'draft' && status !== 'pending') throw new BoardRefusal({ reason: 'network-of-a-ticket-past-pending', ticketId, status });
    const requestedDomains = NetworkDomainUtil.normalisedDomainListOf(domains);
    const nonPublicDomains = requestedDomains.filter((domain) => !NetworkDomainUtil.domainIsPublic(domain));
    if (nonPublicDomains.length > 0) throw new BoardRefusal({ reason: 'network-domain-not-public', ticketId, domains: nonPublicDomains });
    const currentDomains = frontmatter.network ?? [];
    if (requestedDomains.join(',') === currentDomains.join(',')) throw new BoardRefusal({ reason: 'network-unchanged', ticketId, domains: currentDomains });

    if (requestedDomains.length === 0) delete frontmatter.network;
    else frontmatter.network = requestedDomains;
    this.records.markChanged(ticket);
    return { logged: [this.records.logger.log({ kind: 'ticket-network-set', ticketId, fields: { domains: requestedDomains } }, at)], ticket };
  }

  /** An empty reason still holds: the hold is the key's presence, not its text. */
  holdTicket(ticketId: string, reason: string, at: string): TicketChanged {
    const ticket = this.records.requireTicket(ticketId);
    refuseAHoldChangeOfASettledTicket(ticket, 'hold');
    if (ticket.frontmatter.hold !== undefined) throw new BoardRefusal({ reason: 'ticket-already-held', ticketId });
    ticket.frontmatter.hold = reason;
    this.records.markChanged(ticket);
    return { logged: [this.records.logger.log({ kind: 'ticket-held', ticketId, fields: { reason } }, at)], ticket };
  }

  unholdTicket(ticketId: string, at: string): TicketChanged {
    const ticket = this.records.requireTicket(ticketId);
    refuseAHoldChangeOfASettledTicket(ticket, 'unhold');
    if (ticket.frontmatter.hold === undefined) throw new BoardRefusal({ reason: 'ticket-not-held', ticketId });
    delete ticket.frontmatter.hold;
    this.records.markChanged(ticket);
    return { logged: [this.records.logger.log({ kind: 'ticket-unheld', ticketId, fields: {} }, at)], ticket };
  }
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
