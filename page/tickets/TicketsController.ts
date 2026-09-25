/** The Tickets tab: the table and the cards of the visible tickets, and the count of all of them. */

import type { PageTicket }                                           from '../../src/shared/@types/PagePayload.ts';
import { DomUtil }                                                   from '../utils/DomUtil.ts';
import type { TimestampSlices }                                      from '../utils/TimeUtil.ts';
import { ticketCardsMarkup, ticketCountText, ticketTableRowsMarkup } from './TicketsMarkup.ts';

interface TicketsControllerSources {
  allTickets:    readonly PageTicket[];
  waitingOnById: ReadonlyMap<string, readonly string[]>;
  slices:        TimestampSlices;
}

export function createTicketsController(sources: TicketsControllerSources): { show(visibleTickets: readonly PageTicket[], todayCalendarDate: string): void } {
  const { allTickets, waitingOnById, slices } = sources;
  return {
    show: (visibleTickets, todayCalendarDate) => {
      DomUtil.setMarkup('ap-ticket-rows', ticketTableRowsMarkup(visibleTickets, waitingOnById));
      DomUtil.setMarkup('ap-ticket-cards', ticketCardsMarkup(visibleTickets, waitingOnById, slices, todayCalendarDate));
      DomUtil.setText('ap-ticket-count', ticketCountText(allTickets));
      DomUtil.templateBehaviour()?.restoreTicketOpenState();
    },
  };
}
