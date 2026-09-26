/**
 * The ticket parse's seam to the retired status words, seen from the current side: a ticket stored in any current status, quoted or bare, reads
 * as exactly that status and is never counted as an older format, so it is not rewritten. It imports nothing from `src/shared/legacy/`, so it
 * still holds once that folder and its seam line are dropped.
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
  test('parses to that status, quoted or bare, with no older format read', () => {
    for (const status of TICKET_STATUSES) {
      for (const storedStatus of [`"${status}"`, status]) {
        const parsed = TicketDocumentUtil.parseTicketDocument(ticketDocumentIn(storedStatus));

        expect(parsed.verdict, storedStatus).toBe('parsed');
        expect(parsed.verdict === 'parsed' && parsed.frontmatter.status, storedStatus).toBe(status);
        expect(parsed.verdict === 'parsed' && parsed.olderFormatWasRead, storedStatus).toBe(false);
      }
    }
  });
});
