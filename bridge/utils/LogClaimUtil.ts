/**
 * Which log lines the detail panel claims for a row and its ticket. A line worded from a record carries the ids it concerns and is claimed
 * by those alone, never by a number its sentence names; a note carries none and is claimed by the #numbers its sentence names.
 */
import type { TicketsLogEntry } from '../@types/TicketsBoardState.ts';

const TICKET_LINE_START = /^Ticket #/;

/** A ticket is `#003` anywhere except in the row forms (`Task #N`, `row #N`), which from #100 up could be a row of the same number. */
const TICKET_REFERENCE_PREFIX = String.raw`(?<!\b(?:task|row) )#`;

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

function noteNamesTaskOrTicket(text: string, taskId: number | null, ticketId: string | null): boolean {
  return (taskId !== null && textNamesTask(text, taskId)) || (ticketId !== null && textNamesTicket(text, ticketId));
}

function entryIsAbout(entry: TicketsLogEntry, taskId: number | null, ticketId: string | null): boolean {
  if (entry.taskIds === undefined || entry.ticketIds === undefined) return noteNamesTaskOrTicket(entry.text, taskId, ticketId);
  return (taskId !== null && entry.taskIds.includes(taskId)) || (ticketId !== null && entry.ticketIds.includes(ticketId));
}

export const LogClaimUtil = Object.freeze({ noteNamesTaskOrTicket, entryIsAbout });
