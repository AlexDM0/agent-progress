/**
 * A ticket file in a retired status word, read by `TicketFileIngestion`: it is marked as in an older format, reads as the word that replaced
 * it, and keeps its bytes on the read. It reads the older input `src/shared/legacy/` exists for, and is deleted with that folder and
 * `src/adapters/legacy/`.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join }                        from 'node:path';
import {
  afterEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { createScratchDirectory, removeScratchDirectory } from '../../testing/ScratchWorkspace.ts';
import { TicketFileIngestion }                            from '../tickets/TicketFileIngestion.ts';

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
  test('a file holding a retired status word is in an older format', () => {
    const retiredPath = ticketFileHolding(TICKET_WITH_A_COMMENT_ABOVE_ITS_ID.replace('status: "pending"', 'status: open'));

    const retiredReading = new TicketFileIngestion(retiredPath).read();

    expect(retiredReading.verdict === 'parsed' ? retiredReading.fileIsInAnOlderFormat : null).toBe(true);
    expect(retiredReading.verdict === 'parsed' ? retiredReading.ticket.frontmatter.status : null).toBe('pending');
  });

  test('reading a file leaves it byte for byte, a retired word included', () => {
    const storedText = TICKET_WITH_A_COMMENT_ABOVE_ITS_ID.replace('status: "pending"', 'status: open');
    const ticketPath = ticketFileHolding(storedText);

    new TicketFileIngestion(ticketPath).read();

    expect(readFileSync(ticketPath, 'utf8')).toBe(storedText);
  });
});
