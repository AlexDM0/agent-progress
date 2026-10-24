/**
 * The writer and the reader of the progress island meet only here: the render service writes the Board facts by row position, and the
 * page must accept the island it writes and zip the facts back onto the very rows they describe. The board holds a ticket row in review,
 * a flagged review bar, a delivered row with no review stamp and two tickets, so each kind of fact is read back. Its open drafts read
 * back with their requests, and a damaged draft entry is dropped alone, so one bad draft never blanks the page.
 */

import { describe, expect, test }     from 'bun:test';
import type { Draft }                 from '../src/lib/tracker-model/@types/Draft.ts';
import type { TrackerProgress }       from '../src/lib/tracker-model/@types/TrackerProgress.ts';
import { renderDashboardDocument }    from '../src/services/render/DashboardDocument.ts';
import { createRenderState }          from '../src/services/render/RenderState.ts';
import { taskFixture, ticketFixture } from '../src/testing/BoardFixtures.ts';
import { islandContentsOf }           from '../src/testing/RenderedIslandText.ts';
import type { PageBoard }             from './@types/PageBoard.ts';
import { exampleDraft }               from './testing/DraftFixture.ts';
import { exampleQuestion }            from './testing/DraftFixture.ts';
import { IslandUtil }                 from './utils/IslandUtil.ts';
import { JsonValueUtil }              from './utils/JsonValueUtil.ts';

const GENERATED_AT = new Date('2026-09-18T20:11:03Z');

const renderState = createRenderState();

const EXAMPLE_PROGRESS: TrackerProgress = {
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

async function renderedIslands(): Promise<{ progressIsland: unknown; ticketsIsland: unknown }> {
  const { document } = await renderDashboardDocument({
    progress:    EXAMPLE_PROGRESS,
    tickets:     EXAMPLE_TICKETS,
    epics:       [],
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

async function renderedIslandsWithDrafts(drafts: Draft[]): Promise<{ progressIsland: unknown; ticketsIsland: unknown }> {
  const { document } = await renderDashboardDocument({
    progress:    EXAMPLE_PROGRESS,
    tickets:     EXAMPLE_TICKETS,
    epics:       [],
    drafts,
    logRecords:  [],
    generatedAt: GENERATED_AT,
  }, renderState);
  return { progressIsland: islandContentsOf(document, 'ap-progress-data'), ticketsIsland: islandContentsOf(document, 'ap-tickets-data') };
}

function boardOfIsland(progressIsland: unknown, ticketsIsland: unknown): PageBoard {
  const payload = IslandUtil.pagePayloadFrom(progressIsland);
  if (payload === null) {
    throw new Error('the rendered island was refused');
  }
  return IslandUtil.pageBoardFrom(payload.progress.tasks, payload.boardFacts, IslandUtil.pageTicketsFrom(ticketsIsland), payload.epicDescriptions, payload.draftRequests);
}

const EXAMPLE_DRAFTS = [
  exampleDraft('D2', { request: 'Second request\n  kept <as> written', questions: [exampleQuestion('Q1', { followUps: [exampleQuestion('Q2')] })], nextQuestionNumber: 3 }),
  exampleDraft('D1', { claim: null }),
];

describe('the rendered drafts, read by the page', () => {
  test('a board without an open draft writes no draft requests, so its island stays as it was', async () => {
    const { progressIsland } = await renderedIslands();

    expect(JsonValueUtil.valueIsRecord(progressIsland) && Object.hasOwn(progressIsland, 'draftRequests')).toBe(false);
  });

  test('every open draft reads back in number order with its state, open-question count, question tree and request', async () => {
    const { progressIsland, ticketsIsland } = await renderedIslandsWithDrafts(EXAMPLE_DRAFTS);
    const { drafts } = boardOfIsland(progressIsland, ticketsIsland);

    expect(drafts.map((draft) => [draft.id, draft.state, draft.openQuestionCount, draft.claimOwner])).toEqual([
      ['D1', 'resumable', 0, null],
      ['D2', 'waiting', 2, 'opus'],
    ]);
    expect(drafts[1]?.request).toBe('Second request\n  kept <as> written');
    expect(drafts[1]?.questions[0]?.followUps.map((question) => question.id)).toEqual(['Q2']);
  });

  test('a malformed draft entry is dropped and every other card and draft still reads, the island accepted', async () => {
    const { progressIsland, ticketsIsland } = await renderedIslandsWithDrafts(EXAMPLE_DRAFTS);
    const damaged = structuredClone(progressIsland) as { boardFacts: { drafts: unknown[] } };
    damaged.boardFacts.drafts = [{ id: 'D1', title: 7 }, ...damaged.boardFacts.drafts.slice(1), 'not a draft'];

    const board = boardOfIsland(damaged, ticketsIsland);

    expect(board.drafts.map((draft) => draft.id)).toEqual(['D2']);
    expect(board.tickets.map((ticket) => ticket.id)).toEqual(['003', '004']);
  });

  test('an island whose drafts are not a list still reads, with no draft', async () => {
    const { progressIsland, ticketsIsland } = await renderedIslandsWithDrafts(EXAMPLE_DRAFTS);
    const damaged = structuredClone(progressIsland) as { boardFacts: { drafts: unknown } };
    damaged.boardFacts.drafts = 'broken';

    expect(boardOfIsland(damaged, ticketsIsland).drafts).toEqual([]);
  });
});
