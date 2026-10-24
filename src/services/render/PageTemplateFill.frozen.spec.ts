/**
 * That `resources/template.html` filled with a fixed fixture stays byte for byte the page main rendered before the spec view's second
 * edition, both with a page script and with the banner-only fallback. The expected digests were retaken on the commit that folded the range bar into
 * the chart head. To retake them, check out the commit to
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
  withPageScript: 'f58e9531c21b1e710671eb975050797d4616343d44e1d546aff7db069076cb19',
  bannerOnly:     'ec886cfd1b37c5e8b97d27d938d3ab62fe4b591608e9e6f47b6836f91669cc11',
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
