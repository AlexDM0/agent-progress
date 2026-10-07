/**
 * The snapshot derived from the example spec-kit repository, reached only through `src/testing/`: its eight specs in folder order and
 * lanes, `002`'s ticks, work items and waiting Polish, and the header facts. Every file date is then permuted (creation after modification,
 * all equal, all unknown) to prove no date decides a lane, a state, a dependency or an order.
 */
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  test
} from 'bun:test';

import { scannedExampleSpecKitRepository }                         from '../../testing/ScannedExampleSpecKitRepository.ts';
import { createCanonicalScratchDirectory, removeScratchDirectory } from '../../testing/ScratchWorkspace.ts';
import { TicketBodyHashUtil }                                      from '../tracker-model/utils/TicketBodyHashUtil.ts';
import type { SpecSnapshot }                                       from './@types/SpecSnapshot.ts';
import type { SourceFileDates, SpecSnapshotSource }                from './@types/SpecSnapshotSource.ts';
import { deriveSpecSnapshot }                                      from './SpecSnapshotDerivation.ts';

const GENERATED_AT = new Date('2026-10-07T09:30:00.000Z');
let scratchDirectory = '';
let exampleSource: SpecSnapshotSource;
let exampleSnapshot: SpecSnapshot;

beforeAll(() => {
  scratchDirectory = createCanonicalScratchDirectory('spec-snapshot');
  exampleSource = scannedExampleSpecKitRepository(scratchDirectory);
  exampleSnapshot = deriveSpecSnapshot(exampleSource, GENERATED_AT);
});

afterAll(() => {
  removeScratchDirectory(scratchDirectory);
});

function withDates<Dated extends { readonly dates: SourceFileDates }>(dated: Dated, redate: (dates: SourceFileDates) => SourceFileDates): Dated {
  return { ...dated, dates: redate(dated.dates) };
}

function withEveryDate(source: SpecSnapshotSource, redate: (dates: SourceFileDates) => SourceFileDates): SpecSnapshotSource {
  const redated = <Dated extends { readonly dates: SourceFileDates }>(dated: Dated | null): Dated | null => (dated === null ? null : withDates(dated, redate));
  return {
    ...source,
    initOptions:  redated(source.initOptions),
    constitution: redated(source.constitution),
    features:     source.features.map((feature) => ({
      ...feature,
      spec:       withDates(feature.spec, redate),
      plan:       redated(feature.plan),
      research:   redated(feature.research),
      dataModel:  redated(feature.dataModel),
      quickstart: redated(feature.quickstart),
      contracts:  redated(feature.contracts),
      tasks:      redated(feature.tasks),
      checklists: feature.checklists.map((checklist) => withDates(checklist, redate)),
    })),
  };
}

/** Everything a date must not decide. */
function decisionsOf(snapshot: SpecSnapshot): unknown {
  return snapshot.specs.map((spec) => ({
    folderName: spec.folderName,
    lane:       spec.lane,
    stepper:    spec.stepper,
    stories:    spec.stories.map((story) => story.phaseState),
    workItems:  spec.workItems.map(({
      id, state, dependsOn, waitingOn
    }) => ({
      id, state, dependsOn, waitingOn
    })),
    spanStages: spec.stageSpans.map((span) => `${span.stage} ${span.isOpen}`),
  }));
}

describe('the snapshot of the example repository', () => {
  test('holds its eight specs in folder order, in the lanes done, implement, converge, tasks, plan, plan, specify, specify', () => {
    expect(exampleSnapshot.specs.map((spec) => spec.lane)).toEqual(['done', 'implement', 'converge', 'tasks', 'plan', 'plan', 'specify', 'specify']);
    expect(exampleSnapshot.specs.map((spec) => spec.folderName)).toEqual(exampleSource.features.map((feature) => feature.folderName));
    expect(exampleSnapshot.laneCounts).toEqual({
      specify: 2, plan: 2, tasks: 1, implement: 1, converge: 1, done: 1
    });
  });

  test('002 reads 18 of 41 with six work items, and its Polish waits on US2 and US3', () => {
    const productSearch = exampleSnapshot.specs[1];
    expect(productSearch?.folderName).toBe('002-product-search');
    expect(productSearch?.tasks).toEqual({ ticked: 18, total: 41 });
    expect(productSearch?.workItems).toHaveLength(6);
    const polish = productSearch?.workItems.find((item) => item.kind === 'polish');
    const storyIds = productSearch?.workItems.filter((item) => item.kind === 'user-story').map((item) => item.id) ?? [];
    expect(polish?.waitingOn).toEqual(storyIds.slice(1));
    expect(polish?.dependsOn).toEqual(storyIds);
  });

  test('colour slots cycle through six by folder index', () => {
    expect(exampleSnapshot.specs.map((spec) => spec.colourSlot)).toEqual([1, 2, 3, 4, 5, 6, 1, 2]);
  });

  test('the header carries the project, versions, constitution, task totals and the given time', () => {
    expect(exampleSnapshot.project).toBe(scratchDirectory.split('/').at(-1) ?? '');
    expect(exampleSnapshot.specKitVersion).toBe('1.1.0');
    expect(exampleSnapshot.constitution).toMatchObject({ version: '1.2.0', ratified: '2026-09-01', lastAmended: '2026-09-30' });
    expect(exampleSnapshot.constitution?.principles).toHaveLength(6);
    expect(exampleSnapshot.tasks.total).toBe(exampleSnapshot.specs.reduce((sum, spec) => sum + spec.tasks.total, 0));
    expect(exampleSnapshot.generatedAt.startsWith('2026-10-07T')).toBe(true);
    expect(exampleSnapshot.generatedAt.endsWith('Z')).toBe(false);
  });

  test('the only open markers are 008\'s, each with its text and line', () => {
    expect(new Set(exampleSnapshot.openMarkers.map((marker) => marker.folderName))).toEqual(new Set([exampleSource.features[7]?.folderName ?? '']));
    expect(exampleSnapshot.openMarkers).toHaveLength(2);
    expect(exampleSnapshot.specs[7]?.counts.openMarkers).toBe(2);
  });

  test('the repository key is the tracker model\'s body hash of the root path', () => {
    expect(exampleSnapshot.repositoryKey).toBe(TicketBodyHashUtil.bodyHashOf(exampleSource.rootDirectory));
  });

  test('every artefact date is local-offset and keeps its source', () => {
    const dates = exampleSnapshot.specs.flatMap((spec) => spec.artefacts.flatMap((artefact) => [artefact.created, artefact.modified]));
    expect(dates.length).toBeGreaterThan(0);
    expect(dates.every((date) => date !== null && !date.at.endsWith('Z') && date.source.length > 0)).toBe(true);
  });

  test('every spec title drops spec-kit\'s "Feature Specification:" prefix', () => {
    expect(exampleSource.features.every((feature) => feature.spec.document.title.startsWith('Feature Specification: '))).toBe(true);
    expect(exampleSnapshot.specs.map((spec) => spec.title)).toEqual([
      'Customer Login', 'Product Search', 'Wishlist', 'Gift Cards', 'Order Tracking', 'Saved Addresses', 'Store Pickup', 'Gift Wrapping',
    ]);
  });

  test('a title without the prefix, or of the prefix alone, is kept byte for byte', () => {
    const titles = ['  Store Pickup: Feature Specification:', 'Feature Specification:'];
    const source = {
      ...exampleSource,
      features: titles.map((title, index) => {
        const feature = exampleSource.features[index] ?? exampleSource.features[0];
        if (feature === undefined) throw new Error('the example repository has no feature');
        return { ...feature, spec: { ...feature.spec, document: { ...feature.spec.document, title } } };
      }),
    };
    expect(deriveSpecSnapshot(source, GENERATED_AT).specs.map((spec) => spec.title)).toEqual(titles);
  });

  test('the contracts artefact alone carries its folder\'s file count', () => {
    const productSearch = exampleSnapshot.specs.find((spec) => spec.folderName === '002-product-search');
    expect(productSearch?.artefacts.find((artefact) => artefact.kind === 'contracts')?.fileCount).toBe(2);
    const counted = exampleSnapshot.specs.flatMap((spec) => spec.artefacts).filter((artefact) => 'fileCount' in artefact);
    expect(counted.length).toBeGreaterThan(0);
    expect(counted.every((artefact) => artefact.kind === 'contracts')).toBe(true);
  });
});

describe('no date decides a lane, a state, a dependency or an order', () => {
  const DATE_PERMUTATIONS: readonly (readonly [string, (dates: SourceFileDates) => SourceFileDates])[] = [
    ['creation after modification', ({ created, modified }) => ({ created: modified, modified: created })],
    ['all equal', () => ({ created: { at: '2026-01-01T00:00:00.000Z', source: 'birth-time' }, modified: { at: '2026-01-01T00:00:00.000Z', source: 'modification-time' } })],
    ['all unknown', () => ({ created: null, modified: null })],
  ];

  for (const [permutation, redate] of DATE_PERMUTATIONS) {
    test(`with every file date ${permutation}, every lane, state and dependency stays the same`, () => {
      expect(decisionsOf(deriveSpecSnapshot(withEveryDate(exampleSource, redate), GENERATED_AT))).toEqual(decisionsOf(exampleSnapshot));
    });
  }

  test('with every date unknown, the spans carry no date', () => {
    const undated = deriveSpecSnapshot(withEveryDate(exampleSource, () => ({ created: null, modified: null })), GENERATED_AT);
    expect(undated.specs.flatMap((spec) => spec.stageSpans).every((span) => span.start.date === null && (span.end?.date ?? null) === null)).toBe(true);
  });
});
