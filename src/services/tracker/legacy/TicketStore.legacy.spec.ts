/**
 * `listTickets` and `readTicket` on a ticket stored in a retired status word: it lists and reads as current without its file changing, and
 * `ticketsInAnOlderFormat` names exactly such tickets. It reads the older input `src/adapters/legacy/` and `src/shared/legacy/` exist for, and is
 * deleted with them.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { createTicketFileWriter }                         from '../../../adapters/tickets/TicketFileWriter.ts';
import type { Ticket, TicketType }                        from '../../../lib/tracker-model/@types/Ticket.ts';
import { createScratchDirectory, removeScratchDirectory } from '../../../testing/ScratchWorkspace.ts';
import { createTicket, listTickets, readTicket }          from '../TicketStore.ts';
import { workspacePathsFor, type Workspace }              from '../Workspace.ts';

const FILED_AT = '2026-09-18T09:00:00+02:00';

const TICKET_BODY = '# Example\n\n## Report\n\nReported by Alex Example.\n';

let workspace: Workspace;

function fileTicket(title: string, type: TicketType): Ticket {
  const ticket = createTicket(workspace, {
    title,
    type,
    bodyFor: () => TICKET_BODY,
    at:      FILED_AT,
  });
  createTicketFileWriter().write(ticket);
  return ticket;
}

function storeWithTheRetiredWord(ticketPath: string): void {
  writeFileSync(ticketPath, readFileSync(ticketPath, 'utf8').replace('status: "pending"', 'status: open'));
}

beforeEach(() => {
  workspace = workspacePathsFor(createScratchDirectory('ticket-store-legacy'));
  mkdirSync(workspace.ticketsDirectory, { recursive: true });
});

afterEach(() => {
  removeScratchDirectory(workspace.rootDirectory);
});

describe('listTickets and readTicket', () => {
  // Keeps the retired word as input on purpose: only the next write may move a stored ticket to the new word, never a read.
  test('listing or reading a ticket stored as open reads it as pending and leaves the file byte for byte', () => {
    const ticketPath = fileTicket('Fix the export dialog', 'bug').filePath;
    storeWithTheRetiredWord(ticketPath);
    const storedBytes = readFileSync(ticketPath, 'utf8');

    expect(listTickets(workspace).tickets.map((listed) => listed.frontmatter.status)).toEqual(['pending']);
    expect(readTicket(workspace, '1')?.frontmatter.status).toBe('pending');
    expect(readFileSync(ticketPath, 'utf8')).toBe(storedBytes);
    expect(storedBytes).toContain('status: open');
  });

  test('ticketsInAnOlderFormat lists exactly the tickets stored with a retired word', () => {
    fileTicket('Fix the export dialog', 'bug');
    const ticketPath = fileTicket('Add a keyboard shortcut', 'feature').filePath;
    storeWithTheRetiredWord(ticketPath);

    const listing = listTickets(workspace);

    expect(listing.tickets.map((listed) => listed.frontmatter.id)).toEqual(['001', '002']);
    expect(listing.ticketsInAnOlderFormat.map((listed) => listed.filePath)).toEqual([ticketPath]);
  });
});
