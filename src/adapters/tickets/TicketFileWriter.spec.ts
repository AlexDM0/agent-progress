/**
 * The writer puts back exactly the ticket it is handed: the line ending it was read with, the fields a caller changed and never a
 * fresh `updated`, into a tickets directory it recreates when `clear --all` removed it. A frontmatter it would write back as it already
 * reads keeps its stored bytes, so a body edit leaves a hand-written layout alone.
 */

import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  afterEach,
  describe,
  expect,
  test,
} from 'bun:test';
import type { Ticket }                                    from '../../lib/tracker-model/@types/Ticket.ts';
import { createScratchDirectory, removeScratchDirectory } from '../../testing/ScratchWorkspace.ts';
import { TicketFileIngestion }                            from './TicketFileIngestion.ts';
import { createTicketFileWriter }                         from './TicketFileWriter.ts';

const FILED_AT    = '2026-09-18T09:00:00+02:00';
const TICKET_BODY = '# Example\n\n## Report\n\nReported by Alex Example.\n';

const scratchDirectories: string[] = [];

function scratchTicketsDirectory(): string {
  const scratchDirectory = createScratchDirectory('ticket-writer');
  const ticketsDirectory = join(scratchDirectory, 'tickets');

  mkdirSync(ticketsDirectory, { recursive: true });
  scratchDirectories.push(scratchDirectory);
  return ticketsDirectory;
}

function pendingTicketAt(filePath: string): Ticket {
  return {
    frontmatter: {
      id:          '001',
      title:       'Fix the export dialog',
      type:        'bug',
      status:      'pending',
      filed:       FILED_AT,
      updated:     FILED_AT,
      started:     null,
      finished:    null,
      delivered:   null,
      abandonedAt: null,
      task:        null,
      extra:       [],
    },
    body: TICKET_BODY,
    filePath,
  };
}

function ticketReadFrom(filePath: string): Ticket {
  const reading = new TicketFileIngestion(filePath).read();
  if (reading.verdict !== 'parsed') throw new Error(`expected the ticket at ${filePath} to parse, got "${reading.reason}"`);
  return reading.ticket;
}

afterEach(() => {
  for (const scratchDirectory of scratchDirectories) {
    removeScratchDirectory(scratchDirectory);
  }
  scratchDirectories.length = 0;
});

describe('createTicketFileWriter', () => {
  test('a CRLF ticket with an empty body is written back with CRLF', () => {
    const ticketPath    = join(scratchTicketsDirectory(), '001-windows.md');
    const windowsTicket = [
      '---',
      'id: "001"',
      'title: "Windows"',
      'type: "bug"',
      'status: "pending"',
      'filed: "2026-09-18T09:00:00+02:00"',
      'updated: "2026-09-18T09:00:00+02:00"',
      'started: null',
      'finished: null',
      'delivered: null',
      'abandonedAt: null',
      'task: null',
      '---',
      '',
    ].join('\r\n');
    writeFileSync(ticketPath, windowsTicket);

    createTicketFileWriter().write(ticketReadFrom(ticketPath));

    expect(readFileSync(ticketPath, 'utf8')).toBe(windowsTicket);
  });

  test('writes exactly the ticket it is given, leaving updated for the transition that owns it', () => {
    const ticketFileWriter = createTicketFileWriter();
    const filed            = pendingTicketAt(join(scratchTicketsDirectory(), '001-fix-the-export-dialog.md'));
    ticketFileWriter.write(filed);

    filed.frontmatter.branch = 'ticket/export-dialog';
    filed.body               = `${TICKET_BODY}\n## Acceptance\n\nThe folder is remembered.\n`;
    ticketFileWriter.write(filed);

    const reread = ticketReadFrom(filed.filePath);

    expect(reread.frontmatter.branch).toBe('ticket/export-dialog');
    expect(reread.frontmatter.updated).toBe(FILED_AT);
    expect(reread.body).toBe(filed.body);
  });

  test('a frontmatter the ticket leaves as it reads keeps its stored bytes, and a changed one is written in the CLI\'s own layout', () => {
    const ticketPath        = join(scratchTicketsDirectory(), '001-hand-written.md');
    const handWrittenLayout = [
      '---',
      'id: "001"',
      'status: pending',
      'title: "Hand written"',
      'type: bug',
      '# kept by hand',
      'owner: Alex Example',
      'filed: "2026-09-18T09:00:00+02:00"',
      'updated: "2026-09-18T09:00:00+02:00"',
      'started: null',
      'finished: null',
      'delivered: null',
      'abandonedAt: null',
      'task: null',
      '---',
      '',
    ].join('\n');
    writeFileSync(ticketPath, `${handWrittenLayout}Old body.\n`);

    const ticket = ticketReadFrom(ticketPath);
    ticket.body  = 'New body.\n';
    createTicketFileWriter().write(ticket);
    expect(readFileSync(ticketPath, 'utf8')).toBe(`${handWrittenLayout}New body.\n`);

    ticket.frontmatter.branch = 'ticket/hand-written';
    createTicketFileWriter().write(ticket);
    const rewritten = readFileSync(ticketPath, 'utf8');
    expect(rewritten).toContain('\nstatus: "pending"\n');
    expect(rewritten).toContain('\nbranch: "ticket/hand-written"\n');
    expect(rewritten.endsWith('---\nNew body.\n')).toBe(true);
  });

  test('recreates a tickets directory that `clear --all` removed', () => {
    const ticketsDirectory = scratchTicketsDirectory();
    rmSync(ticketsDirectory, { recursive: true, force: true });

    createTicketFileWriter().write(pendingTicketAt(join(ticketsDirectory, '001-fix-the-export-dialog.md')));

    expect(ticketReadFrom(join(ticketsDirectory, '001-fix-the-export-dialog.md')).frontmatter.title).toBe('Fix the export dialog');
  });
});
