/**
 * A ticket id is the padded string everywhere it is stored — `id: "003"` in frontmatter, `ticket:
 * "003"` on a task — never a number, so a comparison is a string comparison. Whether a ticket with
 * that id exists is `lib/tickets/TicketStore.ts`'s question.
 */
import { TICKET_ID_DIGITS } from '../constants/Limits';

const TICKET_REFERENCE_PATTERN = /^#?(\d+)$/;

/** Ids past the padding width grow a digit rather than truncating, which would file ticket 1003 over ticket 003. */
function padTicketId(ticketNumber: number): string {
  return String(ticketNumber).padStart(TICKET_ID_DIGITS, '0');
}

/** Accepts `3`, `003`, `#3` and `#003`; zero is refused rather than normalised, since ids start at 001 and `000` would fail a lookup later. */
function parseTicketReference(text: string): string | null {
  const match = TICKET_REFERENCE_PATTERN.exec(text.trim());
  if (match === null) return null;
  const ticketNumber = Number(match[1]);
  if (!Number.isSafeInteger(ticketNumber) || ticketNumber < 1) return null;
  return padTicketId(ticketNumber);
}

export const TicketIdUtil = {
  padTicketId,
  parseTicketReference,
} as const;
