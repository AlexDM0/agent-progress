/**
 * What `renderProgressPage` adds to the template: the concurrency figures `status --json` prints, so the page and the command cannot
 * disagree on a count, and the tickets in the order it was handed them. The islands are read back from the document the way the page reads them.
 */
import { describe, expect, test } from 'bun:test';

import type { ProgressFile }  from '../../lib/tracker-model/@types/ProgressFile.ts';
import type { Task }          from '../../lib/tracker-model/@types/Task.ts';
import { ConcurrencyUtil }    from '../../lib/tracker-model/utils/ConcurrencyUtil.ts';
import { ticketFixture }      from '../../testing/BoardFixtures.ts';
import { renderProgressPage } from './ProgressPage.ts';

const GENERATED_AT = new Date('2026-09-18T20:11:03Z');

function exampleTask(id: number, changes: Partial<Task> = {}): Task {
  return {
    id,
    name:   `Example task ${id}`,
    status: 'in-progress',
    start:  '2026-09-18T20:05:00+02:00',
    end:    null,
    owner:  'Alex Example',
    note:   '',
    ticket: null,
    tokens: null,
    ...changes,
  };
}

const EXAMPLE_PROGRESS: ProgressFile = {
  trackerId:        'tracker-for-the-progress-page-spec',
  project:          'Example Agency',
  startedAt:        '2026-09-18T20:00:00+02:00',
  nextTaskId:       5,
  view:             { kind: 'auto' },
  concurrencyLimit: 3,
  tasks:            [
    exampleTask(1, { agent: '003,004' }),
    exampleTask(2, { agent: '003,004' }),
    exampleTask(3),
    exampleTask(4, { status: 'pending', start: null }),
  ],
};

/** `[^<]*` rather than a lazy any: every `<` inside an island is escaped, so the real element holds none. */
function islandContentsOf(document: string, elementId: string): unknown {
  const match = new RegExp(`<script type="application/json" id="${elementId}">([^<]*)</script>`).exec(document);
  return JSON.parse(match?.[1] ?? 'null') as unknown;
}

describe('renderProgressPage', () => {
  test('writes the limit and the agents in flight that concurrencyOf gives for the rows', async () => {
    const { document } = await renderProgressPage({
      progress: EXAMPLE_PROGRESS, tickets: [], logRecords: [], generatedAt: GENERATED_AT 
    });
    const expected     = ConcurrencyUtil.concurrencyOf(EXAMPLE_PROGRESS.tasks, EXAMPLE_PROGRESS.concurrencyLimit);

    const payload = islandContentsOf(document, 'ap-progress-data') as { concurrency: unknown };
    expect(payload.concurrency).toEqual({ limit: expected.limit, agentsInFlight: expected.agentsInFlight });
    expect(payload.concurrency).toEqual({ limit: 3, agentsInFlight: 2 });
  });

  test('writes the tickets island in the order the tickets were handed in', async () => {
    const tickets = ['005', '002', '003'].map((id) => ticketFixture({ id, title: `Example ticket ${id}` }));

    const { document } = await renderProgressPage({
      progress: EXAMPLE_PROGRESS, tickets, logRecords: [], generatedAt: GENERATED_AT 
    });

    const ticketIsland = islandContentsOf(document, 'ap-tickets-data') as Array<{ id: string }>;
    expect(ticketIsland.map((ticket) => ticket.id)).toEqual(['005', '002', '003']);
  });

  test('a page script that builds leaves no failure and goes into the document', async () => {
    const rendering = await renderProgressPage({
      progress: EXAMPLE_PROGRESS, tickets: [], logRecords: [], generatedAt: GENERATED_AT 
    });

    expect(rendering.pageScriptFailure).toBeNull();
    expect(rendering.document.startsWith('<!doctype html>')).toBe(true);
    expect(rendering.document).toContain('ap-progress-data');
  });
});
