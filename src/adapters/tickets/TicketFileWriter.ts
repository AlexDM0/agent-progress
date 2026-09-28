import { mkdirSync, readFileSync } from 'node:fs';
import { dirname }                 from 'node:path';
import { writeFileAtomically }     from '../../lib/atomic-file/AtomicFile.ts';
import type { Ticket }             from '../../lib/tracker-model/@types/Ticket.ts';
import { TicketDocumentUtil }      from './utils/TicketDocumentUtil.ts';

/** Writes through `src/lib/atomic-file/AtomicFile.ts` and never touches `updated`; only `src/lib/tracker-model/Board.ts` knows that a ticket changed. */
export function createTicketFileWriter(): { write(ticket: Readonly<Ticket>): void } {
  function write(ticket: Readonly<Ticket>): void {
    // The directory is recreated rather than assumed: `clear --all` may have removed it.
    mkdirSync(dirname(ticket.filePath), { recursive: true });
    const storedFrontmatterText = unchangedStoredFrontmatterTextOf(ticket);
    writeFileAtomically(
      ticket.filePath,
      storedFrontmatterText === null
        ? TicketDocumentUtil.ticketDocumentTextOf(ticket.frontmatter, ticket.body, ticket.lineEnding)
        : `${storedFrontmatterText}${ticket.body}`,
    );
  }

  return { write };
}

/**
 * The stored file's text up to its body, byte for byte, when the ticket's frontmatter would be written back as it already reads, so a body
 * edit leaves a hand-written frontmatter alone; null when the frontmatter changed or the stored file is gone or unreadable.
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

  const frontmatterTextOf = (frontmatter: Ticket['frontmatter']): string => TicketDocumentUtil.ticketDocumentTextOf(frontmatter, '', stored.lineEnding);
  if (frontmatterTextOf(stored.frontmatter) !== frontmatterTextOf(ticket.frontmatter)) return null;
  return storedText.slice(0, storedText.length - stored.body.length);
}
