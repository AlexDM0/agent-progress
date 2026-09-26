/**
 * A ticket file in a retired status word, read through `TicketDocumentUtil` and `TicketFileIngestion`: it reads as the word that replaced
 * it, is marked as in an older format, keeps its bytes on the read and stores the new word on the next write.
 * It reads the older input `src/shared/legacy/` exists for, and is deleted with that folder and `src/adapters/legacy/`.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join }                        from 'node:path';
import {
  afterEach,
  describe,
  expect,
  test,
} from 'bun:test';
import type { TicketFrontmatter }                         from '../../lib/tracker-model/@types/Ticket.ts';
import { createScratchDirectory, removeScratchDirectory } from '../../testing/ScratchWorkspace.ts';
import { TicketFileIngestion }                            from '../tickets/TicketFileIngestion.ts';
import { TicketDocumentUtil }                             from '../tickets/utils/TicketDocumentUtil.ts';

const FULL_TICKET = [
  '---',
  'id: "003"',
  'title: "Fix: the export dialog forgets the folder"',
  'type: "bug"',
  'status: "in-progress"',
  'filed: "2026-09-18T20:11:03+02:00"',
  'updated: "2026-09-18T20:40:00+02:00"',
  'started: "2026-09-18T20:40:00+02:00"',
  'finished: null',
  'delivered: null',
  'abandonedAt: null',
  'group: "export-dialog"',
  'branch: "ticket/export-dialog"',
  'task: 17',
  '---',
  '# 003 — Fix: the export dialog forgets the folder',
  '',
  '## Report',
  '',
  '> Reported by Alex Example.',
  '',
].join('\n');

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

function parsedDocument(text: string): { frontmatter: TicketFrontmatter; body: string; lineEnding: '\n' | '\r\n' } {
  const parsed = TicketDocumentUtil.parseTicketDocument(text);
  if (parsed.verdict !== 'parsed') {
    throw new Error(`expected a parsed ticket document, got "${parsed.reason}" at line ${parsed.line}`);
  }
  return parsed;
}

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

// These keep the retired words as input on purpose: a ticket file written before the rename must still read, and move on when written.
describe('retired status words', () => {
  test('a ticket stored as open or done reads as pending or reviewed, quoted or bare', () => {
    expect(parsedDocument(FULL_TICKET.replace('status: "in-progress"', 'status: open')).frontmatter.status).toBe('pending');
    expect(parsedDocument(FULL_TICKET.replace('status: "in-progress"', 'status: "done"')).frontmatter.status).toBe('reviewed');
  });

  test('reading open or done, quoted or bare, reports that a retired word was read', () => {
    for (const storedStatus of ['open', '"open"', 'done', '"done"']) {
      const parsed = TicketDocumentUtil.parseTicketDocument(FULL_TICKET.replace('status: "in-progress"', `status: ${storedStatus}`));

      expect(parsed.verdict === 'parsed' && parsed.olderFormatWasRead).toBe(true);
    }
  });

  test('writing a ticket read with a retired word stores the word that replaced it', () => {
    const { frontmatter, body } = parsedDocument(FULL_TICKET.replace('status: "in-progress"', 'status: "open"'));

    const written = TicketDocumentUtil.serializeTicketDocument(frontmatter, body);

    expect(written).toContain('status: "pending"');
    expect(written).not.toContain('status: "open"');
  });
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
