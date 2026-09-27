/**
 * A ticket stored in any current status, quoted or bare, reads as exactly that status; a status word an earlier release wrote is refused
 * with the advice to rewrite the file with that release's `update`.
 */
import { describe, expect, test } from 'bun:test';

import { TICKET_STATUSES }    from '../../../lib/tracker-model/constants/Statuses.ts';
import { TicketDocumentUtil } from './TicketDocumentUtil.ts';

function ticketDocumentIn(storedStatus: string): string {
  return [
    '---',
    'id: "003"',
    'title: "Fix: the export dialog forgets the folder"',
    'type: "bug"',
    `status: ${storedStatus}`,
    'filed: "2026-09-18T20:11:03+02:00"',
    'updated: "2026-09-18T20:40:00+02:00"',
    'started: null',
    'finished: null',
    'delivered: null',
    'abandonedAt: null',
    'task: null',
    '---',
    '# 003 — Fix: the export dialog forgets the folder',
    '',
  ].join('\n');
}

describe('a ticket document in a current status', () => {
  test('parses to that status, quoted or bare', () => {
    for (const status of TICKET_STATUSES) {
      for (const storedStatus of [`"${status}"`, status]) {
        const parsed = TicketDocumentUtil.parsedTicketDocumentOf(ticketDocumentIn(storedStatus));

        expect(parsed.verdict, storedStatus).toBe('parsed');
        expect(parsed.verdict === 'parsed' && parsed.frontmatter.status, storedStatus).toBe(status);
      }
    }
  });
});

describe('a ticket document in a status word an earlier release wrote', () => {
  test('is malformed on its status line, and the reason says to run update with a release that still reads it', () => {
    for (const retiredStatus of ['"open"', 'done']) {
      const parsed = TicketDocumentUtil.parsedTicketDocumentOf(ticketDocumentIn(retiredStatus));

      expect(parsed.verdict, retiredStatus).toBe('malformed');
      expect(parsed.verdict === 'malformed' ? parsed.line : 0, retiredStatus).toBe(5);
      expect(parsed.verdict === 'malformed' ? parsed.reason : '', retiredStatus).toContain('run `agent-progress update` with a release that still reads it');
    }
  });
});
