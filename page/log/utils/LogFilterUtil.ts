/**
 * Which log entries the log card's filter keeps: a case-insensitive substring of the sentence, except that a query of exactly `#N` asks
 * for ticket N by the claim rule the detail panel uses, so `#455` never keeps an entry about #4555.
 */

import type { IdentifiedLogEntry } from '../../../src/shared/@types/WordedLogEntry.ts';
import { noteNamesTaskOrTicket }   from '../../utils/NoteNamesTaskOrTicket.ts';

const TICKET_QUERY = /^#([0-9]+)$/;

/** A record belongs to a ticket by its ids alone; a note, which carries none, by its sentence. */
function entryConcernsTicket(entry: IdentifiedLogEntry, ticketId: string): boolean {
  return entry.ticketIds === undefined ? noteNamesTaskOrTicket(entry.text, null, ticketId) : entry.ticketIds.includes(ticketId);
}

function entryMatchesQuery(entry: IdentifiedLogEntry, query: string): boolean {
  const trimmedQuery  = query.trim();
  const queriedTicket = TICKET_QUERY.exec(trimmedQuery)?.[1];
  if (queriedTicket !== undefined) {
    return entryConcernsTicket(entry, queriedTicket);
  }
  return entry.text.toLowerCase().includes(trimmedQuery.toLowerCase());
}

function entriesMatchingQuery(entries: readonly IdentifiedLogEntry[], query: string): IdentifiedLogEntry[] {
  return query.trim() === '' ? [...entries] : entries.filter((entry) => entryMatchesQuery(entry, query));
}

export const LogFilterUtil = {
  entryMatchesQuery,
  entriesMatchingQuery,
} as const;
