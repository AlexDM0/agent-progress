/**
 * A ticket document in a retired status word, parsed and written by `TicketDocumentUtil`: it reads as the word that replaced it, reports that
 * an older word was read, and is written with the new word. It reads the older input `src/shared/legacy/` exists for, and is deleted with that
 * folder and `src/adapters/legacy/`.
 */

import { describe, expect, test }             from 'bun:test';
import type { LineEnding, TicketFrontmatter } from '../../lib/tracker-model/@types/Ticket.ts';
import { TicketDocumentUtil }                 from '../tickets/utils/TicketDocumentUtil.ts';

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

function parsedDocument(text: string): { frontmatter: TicketFrontmatter; body: string; lineEnding: LineEnding } {
  const parsed = TicketDocumentUtil.parsedTicketDocumentOf(text);
  if (parsed.verdict !== 'parsed') {
    throw new Error(`expected a parsed ticket document, got "${parsed.reason}" at line ${parsed.line}`);
  }
  return parsed;
}

// These keep the retired words as input on purpose: a ticket file written before the rename must still read, and move on when written.
describe('retired status words', () => {
  test('a ticket stored as open or done reads as pending or reviewed, quoted or bare', () => {
    expect(parsedDocument(FULL_TICKET.replace('status: "in-progress"', 'status: open')).frontmatter.status).toBe('pending');
    expect(parsedDocument(FULL_TICKET.replace('status: "in-progress"', 'status: "done"')).frontmatter.status).toBe('reviewed');
  });

  test('reading open or done, quoted or bare, reports that a retired word was read', () => {
    for (const storedStatus of ['open', '"open"', 'done', '"done"']) {
      const parsed = TicketDocumentUtil.parsedTicketDocumentOf(FULL_TICKET.replace('status: "in-progress"', `status: ${storedStatus}`));

      expect(parsed.verdict === 'parsed' && parsed.olderFormatWasRead).toBe(true);
    }
  });

  test('writing a ticket read with a retired word stores the word that replaced it', () => {
    const { frontmatter, body } = parsedDocument(FULL_TICKET.replace('status: "in-progress"', 'status: "open"'));

    const written = TicketDocumentUtil.ticketDocumentTextOf(frontmatter, body);

    expect(written).toContain('status: "pending"');
    expect(written).not.toContain('status: "open"');
  });
});
