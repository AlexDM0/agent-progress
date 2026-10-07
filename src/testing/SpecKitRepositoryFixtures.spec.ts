/**
 * The example spec-kit repository, read back through the scan, since later tickets' specs and browser checks rely on what it holds: the
 * eight features with their artefacts and per-phase tick counts, the dates in the past in spec, plan, tasks order, and the two
 * constraints (only `003` says `wish`; only `008` holds open `[NEEDS CLARIFICATION]` markers). The expected table is written from the
 * ticket's description of the example, not taken from the writer.
 */
import { readdirSync } from 'node:fs';
import {
  afterEach,
  describe,
  expect,
  test
} from 'bun:test';

import type { SpecKitFeature }                                     from '../adapters/spec-kit/@types/SpecKitScan.ts';
import { createSpecKitRepositoryScan }                             from '../adapters/spec-kit/SpecKitRepositoryScan.ts';
import { createCanonicalScratchDirectory, removeScratchDirectory } from './ScratchWorkspace.ts';
import { writeExampleSpecKitRepository }                           from './SpecKitRepositoryFixtures.ts';

interface ExpectedFeature {
  readonly folderName:      string;
  readonly artefacts:       readonly string[];
  readonly storyPriorities: readonly number[];
  /** `name done/total`, MVP phases marked. */
  readonly phases:          readonly string[];
}

const EVERY_ARTEFACT = ['spec', 'plan', 'research', 'data-model', 'quickstart', 'contracts', 'tasks', 'checklists'];

const EXPECTED_FEATURES: readonly ExpectedFeature[] = [
  {
    folderName:      '001-customer-login',
    artefacts:       EVERY_ARTEFACT,
    storyPriorities: [1, 2],
    phases:          ['setup 2/2', 'foundational 4/4', 'US1 8/8 MVP', 'US2 6/6', 'polish 4/4'],
  },
  {
    folderName:      '002-product-search',
    artefacts:       EVERY_ARTEFACT,
    storyPriorities: [1, 2, 3],
    phases:          ['setup 3/3', 'foundational 6/6', 'US1 9/9 MVP', 'US2 0/11', 'US3 0/8', 'polish 0/4'],
  },
  {
    folderName:      '003-wishlist',
    artefacts:       EVERY_ARTEFACT,
    storyPriorities: [1, 2],
    phases:          ['setup 2/2', 'foundational 3/3', 'US1 9/9 MVP', 'US2 9/9', 'polish 4/4', 'convergence 0/3'],
  },
  {
    folderName:      '004-gift-cards',
    artefacts:       ['spec', 'plan', 'research', 'data-model', 'contracts', 'tasks'],
    storyPriorities: [1, 2, 3],
    phases:          ['setup 0/2', 'foundational 0/5', 'US1 0/7 MVP', 'US2 0/6', 'US3 0/4', 'polish 0/3'],
  },
  {
    folderName: '005-order-tracking', artefacts: ['spec', 'plan'], storyPriorities: [1, 2], phases: []
  },
  {
    folderName: '006-saved-addresses', artefacts: ['spec', 'plan'], storyPriorities: [1, 2], phases: []
  },
  {
    folderName: '007-store-pickup', artefacts: ['spec'], storyPriorities: [1, 2, 3], phases: []
  },
  {
    folderName: '008-gift-wrapping', artefacts: ['spec'], storyPriorities: [1], phases: []
  },
];

const scratchDirectories: string[] = [];

function exampleRepository(datesFilesInThePast: boolean): string {
  const directory = createCanonicalScratchDirectory('spec-kit-example');
  scratchDirectories.push(directory);
  writeExampleSpecKitRepository(directory, { datesFilesInThePast });
  return directory;
}

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) removeScratchDirectory(directory);
});

function artefactsOf(feature: SpecKitFeature): string[] {
  const presence: readonly (readonly [string, unknown])[] = [
    ['spec', feature.spec],
    ['plan', feature.plan],
    ['research', feature.research],
    ['data-model', feature.dataModel],
    ['quickstart', feature.quickstart],
    ['contracts', feature.contracts],
    ['tasks', feature.tasks],
    ['checklists', feature.checklists.length > 0 ? feature.checklists : null],
  ];
  return presence.filter(([, artefact]) => artefact !== null).map(([name]) => name);
}

function phaseSummariesOf(feature: SpecKitFeature): string[] {
  return (feature.tasks?.document.phases ?? []).map((phase) => {
    const label = phase.kind === 'user-story' ? `US${phase.storyNumber ?? '?'}` : phase.kind;
    const done  = phase.tasks.filter((task) => task.isDone).length;
    return `${label} ${done}/${phase.tasks.length}${phase.isMinimumViableProduct ? ' MVP' : ''}`;
  });
}

describe('the example spec-kit repository', () => {
  test('scans as Example Storefront on spec-kit 1.1.0 with a v1.2.0 constitution of six principles and nothing unreadable', () => {
    const scan = createSpecKitRepositoryScan().scan(exampleRepository(false));

    expect(scan.unreadable).toEqual([]);
    expect(scan.initOptions?.document.speckitVersion).toBe('1.1.0');
    expect(scan.constitution?.document).toMatchObject({
      title: 'Example Storefront Constitution', version: '1.2.0', ratifiedDate: '2026-09-01', lastAmendedDate: '2026-09-30'
    });
    expect(scan.constitution?.document.principleNames).toHaveLength(6);
  });

  test('holds the eight features with the artefacts, stories and per-phase tick counts the ticket lists', () => {
    const { features } = createSpecKitRepositoryScan().scan(exampleRepository(false));

    const scannedFeatures: readonly ExpectedFeature[] = features.map((feature) => ({
      folderName:      feature.folderName,
      artefacts:       artefactsOf(feature),
      storyPriorities: feature.spec.document.userStories.map((story) => story.priority),
      phases:          phaseSummariesOf(feature),
    }));
    expect(scannedFeatures).toEqual(EXPECTED_FEATURES);
  });

  test('002 ticks 18 of 41 tasks and has two contract files; 006 holds one session of 3 answers; 007 two sessions', () => {
    const { features } = createSpecKitRepositoryScan().scan(exampleRepository(false));
    const featureNamed = (folderName: string): SpecKitFeature | undefined => features.find((feature) => feature.folderName === folderName);

    const productSearchTasks = featureNamed('002-product-search')?.tasks?.document.phases.flatMap((phase) => phase.tasks) ?? [];
    expect([productSearchTasks.filter((task) => task.isDone).length, productSearchTasks.length]).toEqual([18, 41]);
    expect(featureNamed('002-product-search')?.contracts?.fileCount).toBe(2);
    expect(featureNamed('006-saved-addresses')?.spec.document.clarificationSessions.map((session) => session.answers.length)).toEqual([3]);
    expect(featureNamed('007-store-pickup')?.spec.document.clarificationSessions).toHaveLength(2);
  });

  test('every artefact is filled', () => {
    const { features } = createSpecKitRepositoryScan().scan(exampleRepository(false));
    const fillStates = features.flatMap((feature) => [feature.spec, feature.plan, feature.tasks, ...feature.checklists])
      .flatMap((artefact) => (artefact === null ? [] : [artefact.fillState]));

    expect(fillStates.length).toBeGreaterThan(0);
    expect(new Set(fillStates)).toEqual(new Set(['filled']));
  });

  test('a scan of the example writes nothing: the listing before and after is equal', () => {
    const directory = exampleRepository(false);
    const listingBefore = readdirSync(directory, { recursive: true, encoding: 'utf8' }).sort();

    createSpecKitRepositoryScan().scan(directory);

    expect(readdirSync(directory, { recursive: true, encoding: 'utf8' }).sort()).toEqual(listingBefore);
  });
});

describe('dates in the past', () => {
  test('each spec\'s spec.md is dated before its plan.md, before its tasks.md, all before now and days apart', () => {
    const now = Date.now();
    const { features } = createSpecKitRepositoryScan().scan(exampleRepository(true));
    const millisecondsPerDay = 86_400_000;

    const datedFeatures = features.filter((feature) => feature.plan !== null);
    expect(datedFeatures.length).toBeGreaterThan(0);
    for (const feature of features) {
      const specTime = Date.parse(feature.spec.dates.modified.at);
      expect(specTime).toBeLessThan(now - millisecondsPerDay);
      if (feature.spec.dates.created.source === 'birth-time') expect(Date.parse(feature.spec.dates.created.at)).toBe(specTime);
      if (feature.plan === null) continue;
      const planTime = Date.parse(feature.plan.dates.modified.at);
      expect(planTime - specTime).toBeGreaterThanOrEqual(millisecondsPerDay);
      if (feature.tasks === null) continue;
      const tasksTime = Date.parse(feature.tasks.dates.modified.at);
      expect(tasksTime - planTime).toBeGreaterThanOrEqual(millisecondsPerDay);
      expect(tasksTime).toBeLessThan(now - millisecondsPerDay);
    }
  });

  test('without them, every file is dated now', () => {
    const before = Date.now() - 60_000;
    const { features } = createSpecKitRepositoryScan().scan(exampleRepository(false));

    expect(features.every((feature) => Date.parse(feature.spec.dates.modified.at) > before)).toBe(true);
  });
});

describe('the constraints later tickets rely on', () => {
  test('no title, story or phase name outside 003 contains `wish`', () => {
    const { features } = createSpecKitRepositoryScan().scan(exampleRepository(false));

    const namesOutsideWishlist = features.filter((feature) => feature.folderName !== '003-wishlist').flatMap((feature) => [
      feature.spec.document.title,
      ...feature.spec.document.userStories.map((story) => story.title),
      ...(feature.plan === null ? [] : [feature.plan.document.title]),
      ...(feature.tasks === null ? [] : [feature.tasks.document.title, ...feature.tasks.document.phases.map((phase) => phase.name)]),
    ]);
    expect(namesOutsideWishlist.length).toBeGreaterThan(0);
    expect(namesOutsideWishlist.filter((name) => /wish/i.test(name))).toEqual([]);
    expect(features.find((feature) => feature.folderName === '003-wishlist')?.spec.document.title).toMatch(/wish/i);
  });

  test('the only open `[NEEDS CLARIFICATION]` markers, in spec.md and plan.md alike, are 008\'s two', () => {
    const { features } = createSpecKitRepositoryScan().scan(exampleRepository(false));

    const openMarkerCounts = features.map((feature) => [
      feature.folderName,
      feature.spec.document.openClarifications.length + (feature.plan?.document.openClarificationCount ?? 0),
    ]).filter(([, count]) => count !== 0);
    expect(openMarkerCounts).toEqual([['008-gift-wrapping', 2]]);
  });
});
