import { mkdirSync, readFileSync } from 'node:fs';
import { dirname }                 from 'node:path';
import { writeFileAtomically }     from '../../lib/atomic-file/AtomicFile.ts';
import type { Ticket }             from '../../lib/tracker-model/@types/Ticket.ts';
import { TicketDocumentUtil }      from './utils/TicketDocumentUtil.ts';

/** Writes through `src/lib/atomic-file/AtomicFile.ts` and never touches `updated`; only `src/lib/tracker-model/Board.ts` knows that a ticket changed. */
export function createTicketFileWriter(): { write(ticket: Readonly<Ticket>): void; contentsOf(ticket: Readonly<Ticket>): string } {
  /** Reads the stored file, so it is taken before anything replaces it. */
  function contentsOf(ticket: Readonly<Ticket>): string {
    const storedFrontmatterText = unchangedStoredFrontmatterTextOf(ticket);
    return storedFrontmatterText === null
      ? TicketDocumentUtil.ticketDocumentTextOf(ticket.frontmatter, ticket.body, ticket.lineEnding, ticket.storedType)
      : `${storedFrontmatterText}${ticket.body}`;
  }

  function write(ticket: Readonly<Ticket>): void {
    // The directory is recreated rather than assumed: `clear --all` may have removed it.
    mkdirSync(dirname(ticket.filePath), { recursive: true });
    writeFileAtomically(ticket.filePath, contentsOf(ticket));
  }

  return { write, contentsOf };
}

/**
 * The stored file's text up to its body, byte for byte, when the ticket's frontmatter would be written back as it already reads or differs
 * only in its title and stored `claimedBodyHash`, whose lines alone are then rewritten, so a body edit or a rename leaves a hand-written
 * frontmatter alone; null when
 * anything else changed or the stored file is gone or unreadable.
 */
function unchangedStoredFrontmatterTextOf(ticket: Readonly<Ticket>): string | null {
  let storedText: string;
  try {
    storedText = readFileSync(ticket.filePath, 'utf8');
  } catch {
    return null;
  }
  const stored = TicketDocumentUtil.parsedTicketDocumentOf(storedText);
  if (stored.verdict !== 'parsed') return null;

  const frontmatterTextOf = (frontmatter: Ticket['frontmatter']): string => TicketDocumentUtil.ticketDocumentTextOf(frontmatter, '', stored.lineEnding, stored.storedType);
  const storedFrontmatterText = storedText.slice(0, storedText.length - stored.body.length);
  const { title, claimedBodyHash } = ticket.frontmatter;
  const splicesClaimedBodyHash = stored.frontmatter.claimedBodyHash !== undefined && claimedBodyHash !== undefined;
  const spliced = { ...stored.frontmatter, title, ...(splicesClaimedBodyHash ? { claimedBodyHash } : {}) };
  if (frontmatterTextOf(spliced) !== frontmatterTextOf(ticket.frontmatter)) return null;
  let frontmatterText = storedFrontmatterText;
  if (title !== stored.frontmatter.title) {
    frontmatterText = TicketDocumentUtil.frontmatterTextWithTextValueOf(frontmatterText, 'title', title);
  }
  if (splicesClaimedBodyHash && claimedBodyHash !== stored.frontmatter.claimedBodyHash) {
    frontmatterText = TicketDocumentUtil.frontmatterTextWithTextValueOf(frontmatterText, 'claimedBodyHash', claimedBodyHash);
  }
  return frontmatterText;
}
