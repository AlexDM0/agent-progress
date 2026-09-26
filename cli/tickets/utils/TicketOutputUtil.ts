import { LogUtil }        from '../../../src/adapters/utils/LogUtil';
import { TicketJsonUtil } from '../../../src/adapters/utils/TicketJsonUtil';
import type { LogRecord } from '../../../src/lib/tracker-model/@types/LogRecord';
import type { Ticket }    from '../../../src/lib/tracker-model/@types/Ticket';

/** The priority is always spelled out, so a script never has to know that an absent key means normal. */
function ticketAsJson(ticket: Ticket): Record<string, unknown> {
  return { ...TicketJsonUtil.ticketDocumentOf(ticket), body: ticket.body };
}

function loggedSentencesOf(logged: readonly LogRecord[]): string {
  return logged.map(LogUtil.sentenceOf).join('\n');
}

export const TicketOutputUtil = { ticketAsJson, loggedSentencesOf } as const;
