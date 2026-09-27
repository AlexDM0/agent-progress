/**
 * What `renderProgressPage` adds to the template: the concurrency figures `status --json` prints, so the page and the command cannot
 * disagree on a count, the tickets in the order it was handed them, and the Board facts, one row fact per stored row at the same index even
 * where a hand edit duplicated an id, since the page will zip them onto its tasks. The islands are read back the way the page reads them.
 */
import { describe, expect, test } from 'bun:test';

import type { ProgressFile }   from '../../lib/tracker-model/@types/ProgressFile.ts';
import type { Task }           from '../../lib/tracker-model/@types/Task.ts';
import { Board }               from '../../lib/tracker-model/Board.ts';
import { createLogger }        from '../../lib/tracker-model/Logger.ts';
import { ConcurrencyUtil }     from '../../lib/tracker-model/utils/ConcurrencyUtil.ts';
import type { PageBoardFacts } from '../../shared/@types/PagePayload.ts';
import { ticketFixture }       from '../../testing/BoardFixtures.ts';
import { islandContentsOf }    from '../../testing/RenderedIslandText.ts';
import { renderProgressPage }  from './ProgressPage.ts';
import { createRenderState }   from './RenderState.ts';
import { BoardFactsUtil }      from './utils/BoardFactsUtil.ts';

const GENERATED_AT = new Date('2026-09-18T20:11:03Z');

const renderState = createRenderState();

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

describe('renderProgressPage', () => {
  test('writes the limit and the agents in flight that concurrencyOf gives for the rows', async () => {
    const { document } = await renderProgressPage({
      progress: EXAMPLE_PROGRESS, tickets: [], logRecords: [], generatedAt: GENERATED_AT 
    }, renderState);
    const expected     = ConcurrencyUtil.concurrencyOf(EXAMPLE_PROGRESS.tasks, EXAMPLE_PROGRESS.concurrencyLimit);

    const payload = islandContentsOf(document, 'ap-progress-data') as { concurrency: unknown };
    expect(payload.concurrency).toEqual({ limit: expected.limit, agentsInFlight: expected.agentsInFlight });
    expect(payload.concurrency).toEqual({ limit: 3, agentsInFlight: 2 });
  });

  test('writes the tickets island in the order the tickets were handed in', async () => {
    const tickets = ['005', '002', '003'].map((id) => ticketFixture({ id, title: `Example ticket ${id}` }));

    const { document } = await renderProgressPage({
      progress: EXAMPLE_PROGRESS, tickets, logRecords: [], generatedAt: GENERATED_AT 
    }, renderState);

    const ticketIsland = islandContentsOf(document, 'ap-tickets-data') as Array<{ id: string }>;
    expect(ticketIsland.map((ticket) => ticket.id)).toEqual(['005', '002', '003']);
  });

  test('a page script that builds leaves no failure and goes into the document', async () => {
    const rendering = await renderProgressPage({
      progress: EXAMPLE_PROGRESS, tickets: [], logRecords: [], generatedAt: GENERATED_AT 
    }, renderState);

    expect(rendering.pageScriptFailure).toBeNull();
    expect(rendering.document.startsWith('<!doctype html>')).toBe(true);
    expect(rendering.document).toContain('ap-progress-data');
  });

  test('writes one row fact per stored row, in order, keeping two rows that share a hand-duplicated id apart', async () => {
    const progress: ProgressFile = {
      ...EXAMPLE_PROGRESS,
      tasks: [
        exampleTask(1, { ticket: '003', status: 'in-review' }),
        exampleTask(2, { status: 'delivered', reviewed: '2026-09-18T21:10:00+02:00' }),
        exampleTask(2, { status: 'delivered' }),
        exampleTask(3, { reviewOf: '003', status: 'in-progress' }),
      ],
    };

    const { document } = await renderProgressPage({
      progress,
      tickets:     [ticketFixture({ id: '003', status: 'in-review', task: 1 })],
      logRecords:  [],
      generatedAt: GENERATED_AT,
    }, renderState);

    const { boardFacts } = islandContentsOf(document, 'ap-progress-data') as { boardFacts: PageBoardFacts };
    expect(boardFacts.rows.map((row) => row.displayState)).toEqual(['reviewing', 'delivered', 'delivered', 'in-progress']);
    expect(boardFacts.rows.map((row) => row.deliveredRowCountsAsReviewed)).toEqual([false, true, false, false]);
    expect(boardFacts.rows.map((row) => row.ownRowPositionOfReviewedTicket)).toEqual([null, null, null, 0]);
  });

  test('writes the facts boardFactsOf gives for a Board over the same progress and tickets', async () => {
    const tickets = [ticketFixture({ id: '003', status: 'in-progress', task: 1 }), ticketFixture({ id: '004' })];
    const progress: ProgressFile = {
      ...EXAMPLE_PROGRESS,
      tasks: [
        exampleTask(1, { ticket: '003' }),
        exampleTask(2, { reviewOf: '003', status: 'delivered' }),
        exampleTask(3, { reviewOf: '004' }),
      ],
    };

    const { document } = await renderProgressPage({
      progress,
      tickets,
      logRecords:  [],
      generatedAt: GENERATED_AT,
    }, renderState);

    const expected       = BoardFactsUtil.boardFactsOf(new Board({ progress, tickets, logger: createLogger(() => undefined) }));
    const { boardFacts } = islandContentsOf(document, 'ap-progress-data') as { boardFacts: PageBoardFacts };
    expect(boardFacts).toEqual(expected);
    expect(boardFacts.tickets.map((ticket) => ticket.ticketId)).toEqual(['003', '004']);
  });
});
