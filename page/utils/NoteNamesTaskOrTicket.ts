/**
 * Claims a log note, which carries no ids, for a panel or a log filter by the #numbers its sentence names, and finds the ticket
 * references a log line's link markup turns into links. It covers notes written with `agent-progress log` and those carried over
 * from a version 1 log.
 */

const TICKET_LINE_START = /^Ticket #/;

/** A ticket is `#003` anywhere except in the row forms (`Task #N`, `row #N`), which from #100 up could be a row of the same number. */
const TICKET_REFERENCE_PREFIX = String.raw`(?<!\b(?:task|row) )#`;

export interface TicketReference {
  ticketId: string;
  start:    number;
  end:      number;
}

/**
 * From ticket #100 up a ticket's `#120` is spelled as task 120's, so a row is named only in the forms the CLI writes for rows (`Task #N`,
 * `row #N`, `Review row #N`), and a line beginning `Ticket #` names no row. The lookahead keeps task 1 from claiming task 13.
 */
function textNamesTask(text: string, taskId: number): boolean {
  return !TICKET_LINE_START.test(text) && new RegExp(`\\b(?:task|row) #${taskId}(?![0-9])`, 'i').test(text);
}

function textNamesTicket(text: string, ticketId: string): boolean {
  return new RegExp(`${TICKET_REFERENCE_PREFIX}${ticketId}(?![0-9])`, 'i').test(text);
}

export function noteNamesTaskOrTicket(text: string, taskId: number | null, ticketId: string | null): boolean {
  return (taskId !== null && textNamesTask(text, taskId)) || (ticketId !== null && textNamesTicket(text, ticketId));
}

/** Every whole `#N` token the ticket rule reads as a ticket, in the order the text holds them. */
export function ticketReferencesIn(text: string): TicketReference[] {
  return [...text.matchAll(new RegExp(`${TICKET_REFERENCE_PREFIX}([0-9]+)(?![0-9])`, 'gi'))].map((match) => ({
    ticketId: match[1] ?? '',
    start:    match.index,
    end:      match.index + match[0].length,
  }));
}
