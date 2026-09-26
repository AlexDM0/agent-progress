import { mkdirSync }           from 'node:fs';
import { dirname }             from 'node:path';
import { writeFileAtomically } from '../../lib/atomic-file/AtomicFile.ts';
import type { Ticket }         from '../../lib/tracker-model/@types/Ticket.ts';
import { TicketDocumentUtil }  from './utils/TicketDocumentUtil.ts';

/** Writes through `src/lib/atomic-file/AtomicFile.ts` and never touches `updated`; only `src/lib/tracker-model/Board.ts` knows that a ticket changed. */
export function createTicketFileWriter(): { write(ticket: Readonly<Ticket>): void } {
  function write(ticket: Readonly<Ticket>): void {
    // The directory is recreated rather than assumed: `clear --all` may have removed it.
    mkdirSync(dirname(ticket.filePath), { recursive: true });
    writeFileAtomically(ticket.filePath, TicketDocumentUtil.serializeTicketDocument(ticket.frontmatter, ticket.body, ticket.lineEnding));
  }

  return { write };
}
