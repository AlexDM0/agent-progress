/**
 * The verdicts one ticket file reads as: parsed with the line its `id` sits on, malformed at line 0 when the file cannot be read at
 * all, and marked as in an older format exactly when it holds a retired status word. A read never writes, so a retired word stays on
 * disk until the next write.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join }                                   from 'node:path';
import {
  afterEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { createScratchDirectory, removeScratchDirectory } from '../../testing/ScratchWorkspace.ts';
import { TicketFileIngestion }                            from './TicketFileIngestion.ts';

const TICKET_WITH_A_COMMENT_ABOVE_ITS_ID = [
  '---',
  '# filed while pairing',
  'id: "004"',
  'title: "Fix the export dialog"',
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
  '# 004 — Fix the export dialog',
  '',
].join('\n');

const scratchDirectories: string[] = [];

function ticketFileHolding(text: string): string {
  const scratchDirectory = createScratchDirectory('ticket-ingestion');
  scratchDirectories.push(scratchDirectory);

  const ticketPath = join(scratchDirectory, '004-fix-the-export-dialog.md');
  writeFileSync(ticketPath, text);
  return ticketPath;
}

afterEach(() => {
  for (const scratchDirectory of scratchDirectories) {
    removeScratchDirectory(scratchDirectory);
  }
  scratchDirectories.length = 0;
});

describe('TicketFileIngestion', () => {
  test('a ticket file parses into the ticket at its path, with the line its id sits on', () => {
    const ticketPath = ticketFileHolding(TICKET_WITH_A_COMMENT_ABOVE_ITS_ID);

    const reading = new TicketFileIngestion(ticketPath).read();

    expect(reading.verdict === 'parsed' ? reading.ticket.frontmatter.id : null).toBe('004');
    expect(reading.verdict === 'parsed' ? reading.ticket.filePath : null).toBe(ticketPath);
    expect(reading.verdict === 'parsed' ? reading.identifierLine : null).toBe(3);
  });

  test('a path that cannot be read as a file is malformed at line 0 with the reason it could not be read', () => {
    const scratchDirectory = createScratchDirectory('ticket-ingestion');
    scratchDirectories.push(scratchDirectory);
    const directoryPath = join(scratchDirectory, '004-a-directory.md');
    mkdirSync(directoryPath);

    const reading = new TicketFileIngestion(directoryPath).read();

    expect(reading.verdict).toBe('malformed');
    expect(reading.verdict === 'malformed' ? reading.line : null).toBe(0);
    expect(reading.verdict === 'malformed' ? reading.reason : '').toStartWith('the file could not be read: ');
  });

  test('a file holding a retired status word is in an older format, and one holding a current word is not', () => {
    const retiredPath = ticketFileHolding(TICKET_WITH_A_COMMENT_ABOVE_ITS_ID.replace('status: "pending"', 'status: open'));
    const currentPath = ticketFileHolding(TICKET_WITH_A_COMMENT_ABOVE_ITS_ID);

    const retiredReading = new TicketFileIngestion(retiredPath).read();
    const currentReading = new TicketFileIngestion(currentPath).read();

    expect(retiredReading.verdict === 'parsed' ? retiredReading.fileIsInAnOlderFormat : null).toBe(true);
    expect(retiredReading.verdict === 'parsed' ? retiredReading.ticket.frontmatter.status : null).toBe('pending');
    expect(currentReading.verdict === 'parsed' ? currentReading.fileIsInAnOlderFormat : null).toBe(false);
  });

  test('reading a file leaves it byte for byte, a retired word included', () => {
    const storedText = TICKET_WITH_A_COMMENT_ABOVE_ITS_ID.replace('status: "pending"', 'status: open');
    const ticketPath = ticketFileHolding(storedText);

    new TicketFileIngestion(ticketPath).read();

    expect(readFileSync(ticketPath, 'utf8')).toBe(storedText);
  });
});
