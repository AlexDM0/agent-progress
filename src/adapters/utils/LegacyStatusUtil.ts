/** The status words a stored file may still hold from before they were renamed, each mapped to the word that replaced it. */
import type { TicketStatus } from '../../lib/tracker-model/@types/Ticket.ts';

const CURRENT_TICKET_STATUS_FOR_RETIRED_WORD: Record<string, TicketStatus> = {
  open: 'pending',
  done: 'reviewed',
};

/** `null` for anything that is not a retired ticket word, current words included, so the caller keeps the text it read. */
function currentTicketStatusFor(storedWord: string): TicketStatus | null {
  // A stored file can spell `constructor`, which a bare lookup would find on the prototype.
  return Object.hasOwn(CURRENT_TICKET_STATUS_FOR_RETIRED_WORD, storedWord) ? CURRENT_TICKET_STATUS_FOR_RETIRED_WORD[storedWord] ?? null : null;
}

export const LegacyStatusUtil = { currentTicketStatusFor } as const;
