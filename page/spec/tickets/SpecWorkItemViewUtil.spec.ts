/**
 * The spec Tickets tab's search and chip rules over the shared example repository. The cases that matter: the search reads a row's title,
 * phase tag and spec, so a spec's words find all its rows; a spec chip and a state chip each narrow, and together both hold; and a group's
 * counts ignore its own pressed chips while honouring the search and the other group.
 */

import {
  afterAll,
  describe,
  expect,
  test
} from 'bun:test';

import { deriveSpecSnapshot }                              from '../../../src/lib/spec-snapshot/SpecSnapshotDerivation.ts';
import { scannedExampleSpecKitRepository }                 from '../../../src/testing/ScannedExampleSpecKitRepository.ts';
import { createScratchDirectory, removeScratchDirectory }  from '../../../src/testing/ScratchWorkspace.ts';
import type { SpecTicketsView }                            from './SpecWorkItemViewUtil.ts';
import { DEFAULT_SPEC_TICKETS_VIEW, SpecWorkItemViewUtil } from './SpecWorkItemViewUtil.ts';

const scratchDirectory   = createScratchDirectory('spec-work-item-view');
const EXAMPLE_NOW        = new Date('2026-10-06T12:00:00+02:00');
const EXAMPLE_SNAPSHOT   = deriveSpecSnapshot(scannedExampleSpecKitRepository(scratchDirectory, EXAMPLE_NOW), EXAMPLE_NOW);
const ENTRIES            = SpecWorkItemViewUtil.workItemEntriesOf(EXAMPLE_SNAPSHOT);
const SEARCHABLE_TEXTS   = new Map(ENTRIES.map((entry) => [entry.workItem.id, SpecWorkItemViewUtil.searchableTextOf(entry)]));
const SPEC_002           = EXAMPLE_SNAPSHOT.specs.find((spec) => spec.folderName.startsWith('002'))?.folderName ?? '';

afterAll(() => removeScratchDirectory(scratchDirectory));

function shownSpecKeys(view: SpecTicketsView): string[] {
  return [...new Set(SpecWorkItemViewUtil.entriesShownBy(view, ENTRIES, SEARCHABLE_TEXTS).map((entry) => entry.spec.folderName))];
}

describe('the search', () => {
  test('“wish” leaves only 003’s rows, every one of them', () => {
    const shown = SpecWorkItemViewUtil.entriesShownBy({ ...DEFAULT_SPEC_TICKETS_VIEW, searchText: ' WISH ' }, ENTRIES, SEARCHABLE_TEXTS);

    expect(shown.length).toBeGreaterThan(0);
    expect(shown.every((entry) => entry.spec.folderName.startsWith('003'))).toBe(true);
    expect(shown.length).toBe(ENTRIES.filter((entry) => entry.spec.folderName.startsWith('003')).length);
  });

  test('reads a row’s phase tag', () => {
    const polish = ENTRIES.find((entry) => entry.workItem.kind === 'polish');

    expect(polish === undefined ? '' : SpecWorkItemViewUtil.searchableTextOf(polish)).toContain('polish');
  });
});

describe('the chips', () => {
  test('the 002 chip leaves only 002’s rows', () => {
    expect(shownSpecKeys({ ...DEFAULT_SPEC_TICKETS_VIEW, specChips: [SPEC_002] })).toEqual([SPEC_002]);
  });

  test('the Done chip leaves only done rows, and with the 002 chip only 002’s done rows', () => {
    const done = SpecWorkItemViewUtil.entriesShownBy({ ...DEFAULT_SPEC_TICKETS_VIEW, stateChips: ['done'] }, ENTRIES, SEARCHABLE_TEXTS);
    const both = SpecWorkItemViewUtil.entriesShownBy({ ...DEFAULT_SPEC_TICKETS_VIEW, specChips: [SPEC_002], stateChips: ['done'] }, ENTRIES, SEARCHABLE_TEXTS);

    expect(done.length).toBeGreaterThan(0);
    expect(done.every((entry) => entry.workItem.state === 'done')).toBe(true);
    expect(both.length).toBeGreaterThan(0);
    expect(both.every((entry) => entry.workItem.state === 'done' && entry.spec.folderName === SPEC_002)).toBe(true);
  });

  test('a group’s counts ignore its own pressed chips and honour the other group', () => {
    const view       = { ...DEFAULT_SPEC_TICKETS_VIEW, specChips: [SPEC_002], stateChips: ['done' as const] };
    const specCounts = SpecWorkItemViewUtil.specChipCountsOf(view, ENTRIES, SEARCHABLE_TEXTS);
    const doneCount  = ENTRIES.filter((entry) => entry.workItem.state === 'done').length;

    expect([...specCounts.values()].reduce((sum, count) => sum + count, 0)).toBe(doneCount);
    expect([...SpecWorkItemViewUtil.stateChipCountsOf(view, ENTRIES, SEARCHABLE_TEXTS).keys()]).toEqual(['to-do', 'in-progress', 'done']);
  });

  test('a view narrows once a search or chip is set', () => {
    expect(SpecWorkItemViewUtil.viewNarrows(DEFAULT_SPEC_TICKETS_VIEW)).toBe(false);
    expect(SpecWorkItemViewUtil.viewNarrows({ ...DEFAULT_SPEC_TICKETS_VIEW, searchText: '  ' })).toBe(false);
    expect(SpecWorkItemViewUtil.viewNarrows({ ...DEFAULT_SPEC_TICKETS_VIEW, stateChips: ['to-do'] })).toBe(true);
  });
});
