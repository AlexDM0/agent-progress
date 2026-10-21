/**
 * The spec Kanban's two bands over the shared example repository. The cases that matter: each spec sits in the lane of its phase, in folder
 * order, with the lane counts to match; an implementing spec reads its ticked of total with a roll-up bar; the work band holds one card per
 * `tasks.md` phase, ready items before waiting ones in To do, a waiting card naming what it waits on by phase tag and linking to it; a work
 * card's spec chip names its spec; the two bands' Done lanes keep distinct ids; and a repository with no specs shows every lane's empty state.
 */

import {
  afterAll,
  describe,
  expect,
  test
} from 'bun:test';

import type { SpecSnapshot }                              from '../../../src/lib/spec-snapshot/@types/SpecSnapshot.ts';
import { deriveSpecSnapshot }                             from '../../../src/lib/spec-snapshot/SpecSnapshotDerivation.ts';
import { scannedExampleSpecKitRepository }                from '../../../src/testing/ScannedExampleSpecKitRepository.ts';
import { createScratchDirectory, removeScratchDirectory } from '../../../src/testing/ScratchWorkspace.ts';
import type { LaneCardModel, LaneModel }                  from '../../kanban/@types/LaneBoard.ts';
import { laneBoardMarkup }                                from '../../kanban/LaneBoardMarkup.ts';
import { EXAMPLE_TIMESTAMP_SLICES }                       from '../../testing/PageLimitsFixture.ts';
import { specKanbanModelOf }                              from './SpecKanbanModel.ts';

const EXAMPLE_NOW = new Date('2026-10-06T12:00:00+02:00');

const scratchDirectory = createScratchDirectory('spec-kanban');
const EXAMPLE_SNAPSHOT = deriveSpecSnapshot(scannedExampleSpecKitRepository(scratchDirectory, EXAMPLE_NOW), EXAMPLE_NOW);

afterAll(() => removeScratchDirectory(scratchDirectory));

function modelOf(snapshot: SpecSnapshot): ReturnType<typeof specKanbanModelOf> {
  return specKanbanModelOf({ snapshot, todayCalendarDate: '2026-10-06', slices: EXAMPLE_TIMESTAMP_SLICES });
}

function cardsOf(lane: LaneModel | undefined): readonly LaneCardModel[] {
  return lane?.body.kind === 'groups' ? lane.body.groups.flatMap((group) => group.cards) : [];
}

function laneNamed(lanes: readonly LaneModel[], key: string): LaneModel | undefined {
  return lanes.find((lane) => lane.key === key);
}

const MODEL = modelOf(EXAMPLE_SNAPSHOT);

describe('the Specs band', () => {
  test('each example spec sits in the lane of its phase, in folder order, and the counts match', () => {
    const specKeysByLane = MODEL.specsBand.lanes.map((lane) => [lane.key, lane.count, cardsOf(lane).map((card) => card.head.idText)]);

    expect(specKeysByLane).toEqual([
      ['specify', 2, ['007', '008']],
      ['plan', 2, ['005', '006']],
      ['tasks', 1, ['004']],
      ['implement', 1, ['002']],
      ['converge', 1, ['003']],
      ['done', 1, ['001']],
    ]);
    expect(MODEL.specsBand.cardCount).toBe(8);
  });

  test('an implementing spec reads its ticked of total with the roll-up bar of its work items', () => {
    const [productSearch] = cardsOf(laneNamed(MODEL.specsBand.lanes, 'implement'));

    expect(productSearch?.note).toBe('18 of 41 tasks ticked');
    expect(productSearch?.head.slotMarkup).toContain('aria-label="3 of 6 work items done"');
    expect(productSearch?.head.slotMarkup).toContain('class="ap-spec-steps" data-size="compact" aria-label="Phase: Implement"');
  });

  test('each lane words its card line from the snapshot', () => {
    const lineOf = (key: string, index = 0): string | null | undefined => cardsOf(laneNamed(MODEL.specsBand.lanes, key))[index]?.note;

    expect([lineOf('specify'), lineOf('specify', 1), lineOf('tasks'), lineOf('converge'), lineOf('done')]).toEqual([
      '2 clarify sessions', '2 open clarifications', '27 tasks written, none ticked', 'Convergence 0 of 3', 'Every task ticked',
    ]);
    expect(lineOf('plan')).toStartWith('Plan written ');
  });
});

describe('the work band', () => {
  test('holds one card per tasks.md phase of the specs that have one', () => {
    const workItemCount = EXAMPLE_SNAPSHOT.specs.reduce((sum, spec) => sum + spec.workItems.length, 0);

    expect(MODEL.workBand.lanes.map((lane) => lane.key)).toEqual(['to-do', 'in-progress', 'done']);
    expect(MODEL.workBand.lanes.reduce((sum, lane) => sum + lane.count, 0)).toBe(workItemCount);
    expect(MODEL.workBand.cardCount).toBe(workItemCount);
  });

  test('in To do the ready items come before the waiting ones, and Polish names US2 and US3 as what it waits on', () => {
    const toDo        = cardsOf(laneNamed(MODEL.workBand.lanes, 'to-do'));
    const identityOf  = (card: LaneCardModel): string => card.identity.value;
    const firstWaiter = toDo.findIndex((card) => card.marks.waitingOn.length > 0);

    expect(toDo.slice(0, firstWaiter).every((card) => card.marks.waitingOn.length === 0)).toBe(true);
    expect(toDo.slice(firstWaiter).every((card) => card.marks.waitingOn.length > 0)).toBe(true);
    expect(toDo.filter((card) => card.marks.waitingOn.length === 0).map(identityOf))
      .toEqual(expect.arrayContaining(['002-product-search-p04', '002-product-search-p05']));
    expect(toDo.find((card) => identityOf(card) === '002-product-search-p06')?.marks.waitingOn).toEqual([
      { text: 'US2 · P2', href: '#ap-spec-work-card-002-product-search-p04', hookAttribute: { name: 'data-open-work-item', value: '002-product-search-p04' } },
      { text: 'US3 · P3', href: '#ap-spec-work-card-002-product-search-p05', hookAttribute: { name: 'data-open-work-item', value: '002-product-search-p05' } },
    ]);
  });

  test('a work card carries its spec chip, its phase tag and its ticked of total', () => {
    const markup = laneBoardMarkup(MODEL.workBand.lanes);
    const card   = markup.slice(markup.indexOf('id="ap-spec-work-card-002-product-search-p04"'));

    expect(card).toStartWith('id="ap-spec-work-card-002-product-search-p04" data-work-item-id="002-product-search-p04" data-state="pending"');
    expect(card).toContain('<span class="ap-spec-phase-tag">US2 · P2</span>');
    expect(card).toContain('<span>0 of 11 tasks</span>');
    expect(card).toContain('data-spec="002-product-search"');
  });

  test('Done is ordered by spec and phase', () => {
    expect(cardsOf(laneNamed(MODEL.workBand.lanes, 'done')).slice(0, 2).map((card) => card.identity.value))
      .toEqual(['001-customer-login-p01', '001-customer-login-p02']);
  });
});

describe('both bands', () => {
  test('the two Done lanes keep distinct card container ids', () => {
    expect([laneNamed(MODEL.specsBand.lanes, 'done')?.cardsElementId, laneNamed(MODEL.workBand.lanes, 'done')?.cardsElementId])
      .toEqual(['ap-spec-specs-lane-done-cards', 'ap-spec-work-lane-done-cards']);
  });

  test('a repository with no specs shows every lane of both bands empty', () => {
    const empty = modelOf({ ...EXAMPLE_SNAPSHOT, specs: [] });

    expect([...empty.specsBand.lanes, ...empty.workBand.lanes].map((lane) => lane.body.kind)).toEqual(Array(9).fill('empty'));
    expect([empty.specsBand.cardCount, empty.workBand.cardCount]).toEqual([0, 0]);
  });
});
