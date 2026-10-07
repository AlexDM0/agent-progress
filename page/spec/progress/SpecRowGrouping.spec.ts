/**
 * The spec page's Progress head rows over the example repository. The cases that matter: every spec is a group keyed and coloured by its
 * folder, its chip opening the spec; the span runs from the first stage's start to the last stage's end, open while a stage is, so a spec
 * without an Implement stage ends where its last stage ends; the done text counts closed stages of three; and drawn on the shared chart,
 * each spec's head sits above its own stages and a folded spec keeps only its head.
 */

import {
  afterAll,
  describe,
  expect,
  test
} from 'bun:test';

import type { SnapshotSpec, StageSpan }                   from '../../../src/lib/spec-snapshot/@types/SpecSnapshot.ts';
import { deriveSpecSnapshot }                             from '../../../src/lib/spec-snapshot/SpecSnapshotDerivation.ts';
import { scannedExampleSpecKitRepository }                from '../../../src/testing/ScannedExampleSpecKitRepository.ts';
import { createScratchDirectory, removeScratchDirectory } from '../../../src/testing/ScratchWorkspace.ts';
import type { TimelineBar }                               from '../../@types/Timeline.ts';
import { taskRowsMarkup }                                 from '../../progress/GanttChartMarkup.ts';
import type { RowGrouping }                               from '../../progress/RowGrouping.ts';
import { EXAMPLE_TIMESTAMP_SLICES }                       from '../../testing/PageLimitsFixture.ts';
import { rowGroupingOfSpecs }                             from './SpecRowGrouping.ts';
import type { SpecStageRow }                              from './SpecStageRows.ts';
import { SpecStageRows }                                  from './SpecStageRows.ts';

const EXAMPLE_NOW = new Date('2026-10-06T12:00:00+02:00');

const scratchDirectory = createScratchDirectory('spec-row-grouping');
const EXAMPLE_SNAPSHOT = deriveSpecSnapshot(scannedExampleSpecKitRepository(scratchDirectory), EXAMPLE_NOW);

afterAll(() => removeScratchDirectory(scratchDirectory));

const PLACED_BAR: TimelineBar = {
  taskId:       0,
  leftPercent:  10,
  widthPercent: 25,
  clippedLeft:  false,
  clippedRight: false,
  visible:      true,
  phases:       [],
};

function specOf(folderPrefix: string): SnapshotSpec {
  const spec = EXAMPLE_SNAPSHOT.specs.find((candidate) => candidate.folderName.startsWith(folderPrefix));
  if (spec === undefined) {
    throw new Error(`the example repository has no spec ${folderPrefix}`);
  }
  return spec;
}

function groupOf(folderPrefix: string) {
  const group = rowGroupingOfSpecs(EXAMPLE_SNAPSHOT.specs).groups.find((candidate) => candidate.key === specOf(folderPrefix).folderName);
  if (group === undefined) {
    throw new Error(`no group for spec ${folderPrefix}`);
  }
  return group;
}

function drawnGroupingOf(foldedGroupKeys: readonly string[]): RowGrouping<SpecStageRow> {
  return {
    ...rowGroupingOfSpecs(EXAMPLE_SNAPSHOT.specs),
    foldedGroupKeys:         new Set(foldedGroupKeys),
    axis:                    { fromEpochMilliseconds: Date.parse('2026-09-09T00:00:00+02:00'), toEpochMilliseconds: EXAMPLE_NOW.getTime() },
    nowEpochMilliseconds:    EXAMPLE_NOW.getTime(),
    minimumSpanWidthPercent: 0.4,
  };
}

/** Each drawn row in order: `head:<spec>` for a head row, `<spec>/<stage>` for a stage row. */
function drawnOrderOf(foldedGroupKeys: readonly string[] = []): string[] {
  const rows   = SpecStageRows.stageRowsOf(EXAMPLE_SNAPSHOT).toReversed();
  const markup = taskRowsMarkup(rows.map((task) => ({
    task, bar: PLACED_BAR, waitingOn: [], trailingNameMarkup: SpecStageRows.trailingNameMarkupOf(task)
  })), {
    slices:             EXAMPLE_TIMESTAMP_SLICES,
    todayCalendarDate:  '2026-10-06',
    reviewRowsAreShown: false,
    rowGrouping:        drawnGroupingOf(foldedGroupKeys),
  });
  return [...markup.matchAll(/<div class="ap-grid-row ap-row[^"]*"[^>]*?(?:data-epic-key="([^"]+)"[^>]*>|>.*?title="([A-Za-z]+)".*?class="ap-spec-progress-spec"[^>]*>([^<]+))/g)]
    .map((match) => (match[1] === undefined ? `${match[3] ?? ''}/${match[2] ?? ''}` : `head:${match[1]}`));
}

describe('rowGroupingOfSpecs over the example repository', () => {
  test('gives every spec a group keyed and coloured by its folder, its chip opening the spec, and no shared members', () => {
    const { groups } = rowGroupingOfSpecs(EXAMPLE_SNAPSHOT.specs);

    expect(groups.map((group) => [group.key, group.slot])).toEqual(EXAMPLE_SNAPSHOT.specs.map((spec) => [spec.folderName, spec.colourSlot]));
    expect(groups.every((group) => group.chipMarkup.includes(`data-spec="${group.key}"`) && group.sharedMemberCount === 0)).toBe(true);
  });

  test('spans a closed spec from its first start to its last end, marked settled, with all three stages done', () => {
    const spec = specOf('001');

    expect(groupOf('001')).toMatchObject({
      span:     { start: spec.stageSpans[0]?.start.date?.at, end: spec.stageSpans.at(-1)?.end?.date?.at },
      isOpen:   false,
      doneText: '3 of 3 stages',
    });
  });

  test('leaves a spec without an Implement stage open to now while its last stage is open', () => {
    expect(groupOf('005')).toMatchObject({ span: { start: specOf('005').stageSpans[0]?.start.date?.at, end: null }, isOpen: true, doneText: '1 of 3 stages' });
    expect(groupOf('008')).toMatchObject({ span: { end: null }, doneText: '0 of 3 stages' });
  });

  test('ends a spec without an Implement stage at its last stage\'s end once every stage is closed', () => {
    const spec       = specOf('005');
    const planEnd    = '2026-09-24T11:59:46+02:00';
    const closedEnd  = (stageSpan: StageSpan): StageSpan => ({ ...stageSpan, isOpen: false, end: { ...stageSpan.start, date: { at: planEnd, source: 'creation-time' } } });
    const closedSpec: SnapshotSpec = { ...spec, stageSpans: spec.stageSpans.map((stageSpan) => (stageSpan.isOpen ? closedEnd(stageSpan) : stageSpan)) };

    expect(rowGroupingOfSpecs([closedSpec]).groups[0]).toMatchObject({ span: { end: planEnd }, doneText: '2 of 3 stages' });
  });

  test('keys every stage row by its spec\'s folder', () => {
    const grouping = rowGroupingOfSpecs(EXAMPLE_SNAPSHOT.specs);

    expect(SpecStageRows.stageRowsOf(EXAMPLE_SNAPSHOT).every((row) => grouping.groupKeyOfRow(row) === row.specFolderName)).toBe(true);
    expect(grouping.ungroupedHead).toBeNull();
  });
});

describe('the spec head rows on the shared chart', () => {
  test('draws each spec\'s head above its own stages, in folder order', () => {
    const order = drawnOrderOf();

    expect(order.slice(0, 8)).toEqual([
      `head:${specOf('001').folderName}`,
      `${specOf('001').folderName}/Specify`,
      `${specOf('001').folderName}/Plan`,
      `${specOf('001').folderName}/Implement`,
      `head:${specOf('002').folderName}`,
      `${specOf('002').folderName}/Specify`,
      `${specOf('002').folderName}/Plan`,
      `${specOf('002').folderName}/Implement`,
    ]);
    expect(order.filter((entry) => entry.startsWith('head:'))).toEqual(EXAMPLE_SNAPSHOT.specs.map((spec) => `head:${spec.folderName}`));
  });

  test('keeps only the head of a folded spec', () => {
    const folded = specOf('002').folderName;
    const order  = drawnOrderOf([folded]);

    expect(order).toContain(`head:${folded}`);
    expect(order.filter((entry) => entry.startsWith(`${folded}/`))).toEqual([]);
    expect(order).toContain(`${specOf('003').folderName}/Implement`);
  });
});
