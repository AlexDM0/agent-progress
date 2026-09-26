/**
 * Claims a log note, which carries no ids, for a panel by the #numbers its sentence names. It covers notes written with
 * `agent-progress log` and those carried over from a version 1 log.
 */

const TICKET_LINE_START = /^Ticket #/;

/**
 * Only for a line without ids: a note, or a line from before the log was structured.
 * From ticket #100 up a ticket's `#120` is spelled as task 120's, so a row is named only as `Task #N` or `row #N` — `Review row #N`
 * and `the review row #N`, the forms the CLI writes for rows — and a line beginning `Ticket #` names no row. The lookahead keeps
 * task 1 from claiming task 13.
 */
function textNamesTask(text: string, taskId: number): boolean {
  return !TICKET_LINE_START.test(text) && new RegExp(`\\b(?:task|row) #${taskId}(?![0-9])`, 'i').test(text);
}

/**
 * Only for a line without ids, like `textNamesTask`. A ticket is `#003` anywhere except in the row forms above, which from #100 up
 * could be a row of the same number.
 */
function textNamesTicket(text: string, ticketId: string): boolean {
  return new RegExp(`(?<!\\b(?:task|row) )#${ticketId}(?![0-9])`, 'i').test(text);
}

function noteNamesTaskOrTicket(text: string, taskId: number | null, ticketId: string | null): boolean {
  return (taskId !== null && textNamesTask(text, taskId)) || (ticketId !== null && textNamesTicket(text, ticketId));
}

export const NoteSentenceMatchUtil = { noteNamesTaskOrTicket } as const;
