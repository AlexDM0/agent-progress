/** Whether a ticket may move between two statuses, and the stamps it carries after the move. */
import type { TicketFrontmatter, TicketStatus }    from '../@types/Ticket.ts';
import { LEGAL_SOURCE_STATUSES_FOR_TICKET_STATUS } from '../constants/TicketMoveLegality.ts';

export type TicketStamps = Pick<TicketFrontmatter, 'started' | 'finished' | 'delivered' | 'abandonedAt'>;

export interface TicketStampsAfterMove extends TicketStamps {
  clearsReason: boolean;
}

function ticketMoveIsLegal(currentStatus: TicketStatus, targetStatus: TicketStatus): boolean {
  return LEGAL_SOURCE_STATUSES_FOR_TICKET_STATUS[targetStatus].includes(currentStatus);
}

/**
 * `started`, `finished` and `delivered` are set only when still null, while `abandonedAt` is always set: abandoning twice is deciding twice.
 * A reopen clears all four and the reason, since the work starts over.
 */
function stampsAfterMoveOf(frontmatter: Readonly<TicketStamps>, targetStatus: TicketStatus, at: string): TicketStampsAfterMove {
  const {
    started,
    finished,
    delivered,
    abandonedAt,
  } = frontmatter;
  switch (targetStatus) {
    case 'draft':
    case 'pending':
      return {
        started:      null,
        finished:     null,
        delivered:    null,
        abandonedAt:  null,
        clearsReason: true,
      };
    case 'in-progress':
      return {
        started:      started ?? at,
        finished,
        delivered,
        abandonedAt,
        clearsReason: false,
      };
    case 'in-review':
    case 'reviewed':
      return {
        started,
        finished:     finished ?? at,
        delivered,
        abandonedAt,
        clearsReason: false,
      };
    case 'delivered':
      return {
        started,
        finished,
        delivered:    delivered ?? at,
        abandonedAt,
        clearsReason: false,
      };
    case 'abandoned':
      return {
        started,
        finished,
        delivered,
        abandonedAt:  at,
        clearsReason: false,
      };
  }
}

export const TicketMoveUtil = { ticketMoveIsLegal, stampsAfterMoveOf } as const;
