/**
 * That `resources/template.html` filled with a fixed fixture stays byte for byte the page main rendered before the spec view's second
 * edition, both with a page script and with the banner-only fallback. The expected digests were retaken on the commit that streamlined the
 * Kanban lane headers and moved embedded mode's styles and today figures into the template. To retake them, check out the commit to
 * compare against, run this spec, and copy each actual digest its failure prints into `FROZEN_PAGE_DIGESTS`.
 */
import { createHash } from 'node:crypto';

import { describe, expect, test } from 'bun:test';

import type { LogRecord }         from '../../lib/tracker-model/@types/LogRecord.ts';
import type { Ticket }            from '../../lib/tracker-model/@types/Ticket.ts';
import type { TrackerProgress }   from '../../lib/tracker-model/@types/TrackerProgress.ts';
import { createMarkdownRenderer } from './MarkdownRenderer.ts';
import { fillPageTemplate }       from './PageTemplateFill.ts';

const FROZEN_PAGE_DIGESTS = {
  withPageScript: 'e12688197f8d54c9d2f2e3d41a2c8dcf0994e991d910fe3bf53c04509c9dcf0f',
  bannerOnly:     'b2a251484148246219f7e2f75cdadd1f0622e6c556ee32e91b97929da48ce5a7',
} as const;

const FROZEN_PROGRESS: TrackerProgress = {
  trackerId:  'tracker-for-the-frozen-page',
  project:    'Example Agency',
  startedAt:  '2026-09-18T20:00:00+02:00',
  nextTaskId: 2,
  view:       { kind: 'auto' },
  tasks:      [{
    id:     1,
    name:   'Split the exporter into two passes',
    status: 'in-progress',
    start:  '2026-09-18T20:05:00+02:00',
    end:    null,
    owner:  'Alex Example',
    note:   'Started by the frozen fixture',
    ticket: '003',
    tokens: 12_300,
  }],
};

const FROZEN_LOG_RECORDS: readonly LogRecord[] = [{ at: '2026-09-18T20:05:00+02:00', kind: 'note', fields: { text: 'Review pass started' } }];

const FROZEN_TICKET: Ticket = {
  frontmatter: {
    id:          '003',
    title:       'Split the exporter into two passes',
    type:        'ticket',
    status:      'in-progress',
    filed:       '2026-09-18T20:00:00+02:00',
    updated:     '2026-09-18T20:05:00+02:00',
    started:     '2026-09-18T20:05:00+02:00',
    finished:    null,
    delivered:   null,
    abandonedAt: null,
    branch:      'ticket-003',
    task:        1,
    extra:       [],
  },
  body:     '## Report\n\nTwo passes, *one* file.\n\n## Acceptance\nA1. The exporter runs twice.\n',
  filePath: '/example/.agent-progress/tickets/003-exporter.md',
};

function frozenPageWith(pageScript: string | null, pageScriptFailure: string | null): string {
  return fillPageTemplate({
    progress:    FROZEN_PROGRESS,
    logRecords:  FROZEN_LOG_RECORDS,
    tickets:     [FROZEN_TICKET],
    epics:       [],
    pageScript,
    pageScriptFailure,
    generatedAt: new Date('2026-09-18T20:11:03Z'),
    concurrency: { limit: 2, agentsInFlight: 1 },
    boardFacts:  {
      rows: [], tickets: [], epics: [], readyTickets: []
    },
    renderMarkdown: createMarkdownRenderer().renderMarkdown,
  });
}

function digestOf(document: string): string {
  return createHash('sha256').update(document).digest('hex');
}

describe('the tracker page filled from a fixed fixture', () => {
  test('is the very page main rendered, with a stub page script', () => {
    expect(digestOf(frozenPageWith('window.frozenStubPageScript = 1;', null))).toBe(FROZEN_PAGE_DIGESTS.withPageScript);
  });

  test('is the very page main rendered, with the banner-only fallback', () => {
    expect(digestOf(frozenPageWith(null, 'the frozen bundle failed'))).toBe(FROZEN_PAGE_DIGESTS.bannerOnly);
  });
});
