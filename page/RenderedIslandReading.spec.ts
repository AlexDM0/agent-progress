/**
 * The writer and the reader of the progress island meet only here: the render service writes the Board facts by row position, and the
 * page must accept the island it writes and zip the facts back onto the very rows they describe. The board holds a ticket row in review,
 * a flagged review bar, a delivered row with no review stamp and two tickets, so each kind of fact is read back.
 */

import { describe, expect, test }     from 'bun:test';
import type { ProgressFile }          from '../src/lib/tracker-model/@types/ProgressFile.ts';
import { renderProgressPage }         from '../src/services/render/ProgressPage.ts';
import { createRenderState }          from '../src/services/render/RenderState.ts';
import { taskFixture, ticketFixture } from '../src/testing/BoardFixtures.ts';
import { IslandUtil }                 from './utils/IslandUtil.ts';

const GENERATED_AT = new Date('2026-09-18T20:11:03Z');

const renderState = createRenderState();

const EXAMPLE_PROGRESS: ProgressFile = {
  trackerId:  'tracker-for-the-island-reading-spec',
  project:    'Example Agency',
  startedAt:  '2026-09-18T20:00:00+02:00',
  nextTaskId: 4,
  view:       { kind: 'auto' },
  tasks:      [
    taskFixture({
      id:     1,
      name:   'Split the exporter',
      status: 'in-review',
      start:  '2026-09-18T20:05:00+02:00',
      ticket: '003',
    }),
    taskFixture({
      id:             2,
      name:           'Review 1 #003 — Split the exporter',
      status:         'in-progress',
      start:          '2026-09-18T20:40:00+02:00',
      reviewOf:       '003',
      reviewBarRound: 1,
    }),
    taskFixture({
      id:     3,
      name:   'Brighter colours',
      status: 'delivered',
      start:  '2026-09-18T20:06:00+02:00',
      end:    '2026-09-18T20:30:00+02:00',
      ticket: '004',
    }),
  ],
};

const EXAMPLE_TICKETS = [
  ticketFixture({
    id:     '003',
    title:  'Split the exporter',
    status: 'in-review',
    task:   1,
  }),
  ticketFixture({
    id:     '004',
    title:  'Brighter colours',
    status: 'delivered',
    task:   3,
  }),
];

/** `[^<]*` rather than a lazy any: every `<` inside an island is escaped, so the real element holds none. */
function islandContentsOf(document: string, elementId: string): unknown {
  const match = new RegExp(`<script type="application/json" id="${elementId}">([^<]*)</script>`).exec(document);
  return JSON.parse(match?.[1] ?? 'null') as unknown;
}

async function renderedIslands(): Promise<{ progressIsland: unknown; ticketsIsland: unknown }> {
  const { document } = await renderProgressPage({
    progress:    EXAMPLE_PROGRESS,
    tickets:     EXAMPLE_TICKETS,
    logRecords:  [],
    generatedAt: GENERATED_AT,
  }, renderState);
  return { progressIsland: islandContentsOf(document, 'ap-progress-data'), ticketsIsland: islandContentsOf(document, 'ap-tickets-data') };
}

describe('the rendered progress island, read by the page', () => {
  test('passes the page\'s island check', async () => {
    const { progressIsland } = await renderedIslands();

    expect(IslandUtil.pagePayloadFrom(progressIsland)).not.toBeNull();
  });

  test('zips the display states, the reviewed count and the bar\'s own row back onto the rows they describe', async () => {
    const { progressIsland, ticketsIsland } = await renderedIslands();
    const payload = IslandUtil.pagePayloadFrom(progressIsland);
    if (payload === null) {
      throw new Error('the rendered island was refused');
    }

    const { rows, tickets } = IslandUtil.pageBoardFrom(payload.progress.tasks, payload.boardFacts, IslandUtil.pageTicketsFrom(ticketsIsland));
    const [ownRow, bar, deliveredRow] = rows;

    expect(rows.map((row) => [row.id, row.displayState])).toEqual([[1, 'reviewing'], [2, 'in-progress'], [3, 'delivered']]);
    expect(deliveredRow?.deliveredRowCountsAsReviewed).toBe(true);
    expect(bar?.ownRowOfReviewedTicket).toBe(ownRow ?? null);
    expect(ownRow?.ownRowOfReviewedTicket).toBeNull();
    expect(tickets.map((ticket) => [ticket.id, ticket.displayState])).toEqual([['003', 'reviewing'], ['004', 'delivered']]);
    expect(tickets[0]?.ownRow).toBe(ownRow ?? null);
    expect(tickets[0]?.reviewBars).toEqual(rows.slice(1, 2));
    expect(tickets[1]?.ownRow).toBe(deliveredRow ?? null);
  });
});
