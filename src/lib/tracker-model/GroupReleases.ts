/** A ticket group's release ticket, marked and cleared, and the release bundle it closes over: what reaches the main line as one release. */
import type { TicketChanged }      from './@types/BoardChanges.ts';
import type { Ticket }             from './@types/Ticket.ts';
import type { BoardRecords }       from './BoardRecords.ts';
import { BoardRefusal }            from './BoardRefusal.ts';
import { SETTLED_TICKET_STATUSES } from './constants/Statuses.ts';

export class GroupReleases {
  constructor(private readonly records: BoardRecords) {}

  markReleaseTicket(ticketId: string, at: string): TicketChanged {
    const ticket = this.records.requireTicket(ticketId);
    refuseAReleaseMarkOfASettledTicket(ticket, 'mark');
    const { group } = ticket.frontmatter;
    if (group === undefined) throw new BoardRefusal({ reason: 'release-mark-of-an-ungrouped-ticket', ticketId });
    const currentReleaseTicket = this.releaseTicketsOf(group)[0];
    if (currentReleaseTicket !== undefined) {
      throw new BoardRefusal({
        reason:          'group-already-has-a-release-ticket',
        ticketId,
        group,
        releaseTicketId: currentReleaseTicket.frontmatter.id,
      });
    }
    ticket.frontmatter.releasesGroup = true;
    this.records.markChanged(ticket);
    return { logged: [this.records.logger.log({ kind: 'ticket-release-marked', ticketId, fields: { group } }, at)], ticket };
  }

  clearReleaseTicket(ticketId: string, at: string): TicketChanged {
    const ticket = this.records.requireTicket(ticketId);
    refuseAReleaseMarkOfASettledTicket(ticket, 'clear');
    if (ticket.frontmatter.releasesGroup !== true) throw new BoardRefusal({ reason: 'ticket-is-not-a-release-ticket', ticketId });
    delete ticket.frontmatter.releasesGroup;
    this.records.markChanged(ticket);
    return { logged: [this.records.logger.log({ kind: 'ticket-release-cleared', ticketId, fields: {} }, at)], ticket };
  }

  /**
   * The group's release ticket and every ticket of the same group it depends on, transitively, in id order; empty when the group has no
   * release ticket. A dependency outside the group is not followed, so an in-group ticket reached only through it is not in the bundle.
   */
  releaseBundleOf(group: string): string[] {
    const bundleTicketIds = new Set<string>();
    const pendingTicketIds = this.releaseTicketsOf(group).map((ticket) => ticket.frontmatter.id);

    while (pendingTicketIds.length > 0) {
      const ticketId = pendingTicketIds.pop() ?? '';
      const ticket   = this.records.ticketRecordById(ticketId);
      if (ticket === undefined || ticket.frontmatter.group !== group || bundleTicketIds.has(ticketId)) continue;
      bundleTicketIds.add(ticketId);
      pendingTicketIds.push(...(ticket.frontmatter.dependsOn ?? []));
    }
    return [...bundleTicketIds].sort((a, b) => Number(a) - Number(b));
  }

  private releaseTicketsOf(group: string): Ticket[] {
    return this.records.ticketRecords.filter((ticket) => ticket.frontmatter.group === group && ticket.frontmatter.releasesGroup === true);
  }
}

function refuseAReleaseMarkOfASettledTicket(ticket: Readonly<Ticket>, action: 'mark' | 'clear'): void {
  const { id: ticketId, status } = ticket.frontmatter;
  if (!SETTLED_TICKET_STATUSES.includes(status)) return;
  throw new BoardRefusal({
    reason: 'release-mark-of-a-settled-ticket',
    ticketId,
    status,
    action,
  });
}
