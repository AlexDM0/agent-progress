/**
 * The writer and the reader of the progress island meet only here: the render service writes the Board facts by row position, and the
 * page must accept the island it writes and zip the facts back onto the very rows they describe. The board holds a ticket row in review,
 * a flagged review bar, a delivered row with no review stamp and two tickets, so each kind of fact is read back. The spec page's island
 * meets its reader the same way: it must carry the snapshot's specs and the limits, under the id the bundled spec entry names, and a
 * bundle naming another island must fail.
 */

import { describe, expect, test }          from 'bun:test';
import { deriveSpecSnapshot }              from '../src/lib/spec-snapshot/SpecSnapshotDerivation.ts';
import type { TrackerProgress }            from '../src/lib/tracker-model/@types/TrackerProgress.ts';
import { renderDashboardDocument }         from '../src/services/render/DashboardDocument.ts';
import { createPageBundler }               from '../src/services/render/PageBundler.ts';
import { createRenderState }               from '../src/services/render/RenderState.ts';
import { fillSpecPageTemplate }            from '../src/services/render/SpecPageTemplateFill.ts';
import { PAGE_ENTRY_POINTS }               from '../src/services/render/constants/PageEntryPoints.ts';
import { taskFixture, ticketFixture }      from '../src/testing/BoardFixtures.ts';
import { islandContentsOf }                from '../src/testing/RenderedIslandText.ts';
import { sourceFeature, sourceRepository } from '../src/testing/SpecSnapshotSourceFixtures.ts';
import { IslandUtil }                      from './utils/IslandUtil.ts';

const GENERATED_AT = new Date('2026-09-18T20:11:03Z');

const SPEC_ISLAND_ELEMENT_ID = 'ap-spec-data';

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

/** Whether the bundled entry names the island as a string, which is how `PageShell.islandContentsOf` is handed an id. */
function bundleNamesIsland(script: string, islandId: string): boolean {
  return [`'${islandId}'`, `"${islandId}"`, `\`${islandId}\``].some((quotedId) => script.includes(quotedId));
}

describe('the rendered spec island, read by the spec page', () => {
  const features     = [sourceFeature({ folderName: '001-example-feature' }), sourceFeature({ folderName: '002-second-feature' })];
  const snapshot     = deriveSpecSnapshot(sourceRepository(features), GENERATED_AT);
  const specDocument = fillSpecPageTemplate({ snapshot, pageScript: null, pageScriptFailure: null });

  test('carries the snapshot\'s specs and the limits where the spec entry reads them', () => {
    const specIsland = islandContentsOf(specDocument, SPEC_ISLAND_ELEMENT_ID) as { snapshot?: { specs?: unknown }, limits?: unknown } | null;

    expect(Array.isArray(specIsland?.snapshot?.specs) ? specIsland.snapshot.specs.length : null).toBe(snapshot.specs.length);
    expect(snapshot.specs.length).toBe(2);
    expect(specIsland?.limits).toBeDefined();
  });

  test('is the island the bundled spec entry reads, and a bundle naming another island fails', async () => {
    const outcome = await createPageBundler(PAGE_ENTRY_POINTS.SPEC).bundlePageScript();
    const script  = outcome.verdict === 'built' ? outcome.script : '';

    expect(bundleNamesIsland(script, SPEC_ISLAND_ELEMENT_ID)).toBe(true);
    expect(bundleNamesIsland(script.replaceAll(SPEC_ISLAND_ELEMENT_ID, 'ap-planted-data'), SPEC_ISLAND_ELEMENT_ID)).toBe(false);
  });
});
