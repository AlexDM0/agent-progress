/**
 * The spec Tickets tab's table over the shared example repository. The cases that matter: one row per `tasks.md` phase under its spec's
 * group row, specs in snapshot order and phases in phase order; a waiting row names what it waits on by phase tag, each opening that work
 * item; the search marks titles without breaking an escaped character; and the empty row says what was asked.
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
import { SpecTicketsMarkup }                               from './SpecTicketsMarkup.ts';
import { DEFAULT_SPEC_TICKETS_VIEW, SpecWorkItemViewUtil } from './SpecWorkItemViewUtil.ts';

const scratchDirectory = createScratchDirectory('spec-tickets');
const EXAMPLE_SNAPSHOT = deriveSpecSnapshot(scannedExampleSpecKitRepository(scratchDirectory), new Date('2026-10-06T12:00:00+02:00'));
const ENTRIES          = SpecWorkItemViewUtil.workItemEntriesOf(EXAMPLE_SNAPSHOT);

afterAll(() => removeScratchDirectory(scratchDirectory));

function rowIdsOf(markup: string): string[] {
  return [...markup.matchAll(/<tr data-work-item-id="([^"]+)"/g)].map((match) => match[1] ?? '');
}

describe('specTicketRowsMarkup', () => {
  const markup = SpecTicketsMarkup.specTicketRowsMarkup(ENTRIES, ENTRIES, '');

  test('one row per tasks.md phase, by spec in snapshot order and phase order', () => {
    expect(ENTRIES.length).toBeGreaterThan(0);
    expect(rowIdsOf(markup)).toEqual(EXAMPLE_SNAPSHOT.specs.flatMap((spec) => spec.workItems.map((workItem) => workItem.id)));
  });

  test('each spec with work items heads its rows with a group row on its colour slot and title button', () => {
    const specsWithWork = EXAMPLE_SNAPSHOT.specs.filter((spec) => spec.workItems.length > 0);

    expect(markup.match(/<tr class="ap-epic-group-row"/g)?.length).toBe(specsWithWork.length);
    for (const spec of specsWithWork) {
      expect(markup).toContain(`<tr class="ap-epic-group-row" data-epic-slot="${spec.colourSlot}"><td colspan="5">`);
      expect(markup).toContain(`data-open-spec="${spec.folderName}"`);
    }
  });

  test('002’s Polish row names US2 and US3 as what it waits on, each opening its work item', () => {
    const polish = ENTRIES.find((entry) => entry.spec.folderName.startsWith('002') && entry.workItem.kind === 'polish');
    const row    = markup.split('</tr>').find((part) => part.includes(`data-work-item-id="${polish?.workItem.id}"`)) ?? '';

    expect(polish?.workItem.waitingOn.length).toBe(2);
    for (const waitedId of polish?.workItem.waitingOn ?? []) {
      expect(row).toContain(`data-open-work-item="${waitedId}"`);
    }
    expect(row).toMatch(/>US2[^<]*<\/button>.*>US3[^<]*<\/button>/);
  });

  test('a row carries its ticked of total and its state badge', () => {
    const first = ENTRIES[0];
    const row   = markup.split('</tr>').find((part) => part.includes(`data-work-item-id="${first?.workItem.id}"`)) ?? '';

    expect(row).toContain(`<td class="mono">${first?.workItem.tickedCount} of ${first?.workItem.taskCount}</td>`);
    expect(row).toContain('<span class="ap-badge" data-state="');
  });

  test('the search marks a title match, case-insensitively', () => {
    const entry = ENTRIES[0];
    const word  = entry?.workItem.title.split(' ')[0] ?? '';

    expect(SpecTicketsMarkup.specTicketRowsMarkup(ENTRIES, ENTRIES, word.toUpperCase())).toContain(`<mark class="ap-match">${word}</mark>`);
  });
});

describe('emptySpecTicketTableMarkup', () => {
  test('says what was asked and offers the way back', () => {
    const view   = { searchText: '<wish>', specChips: [ENTRIES[0]?.spec.folderName ?? ''], stateChips: ['done' as const] };
    const markup = SpecTicketsMarkup.emptySpecTicketTableMarkup(view, true, (specKey) => `Spec ${specKey}`);

    expect(markup).toContain('<td colspan="5">');
    expect(markup).toContain(`No work item matches “&lt;wish&gt;”, spec Spec ${ENTRIES[0]?.spec.folderName}, state Done.`);
    expect(markup).toContain('data-clear-filters');
  });

  test('offers no way back when nothing narrowed the table', () => {
    const markup = SpecTicketsMarkup.emptySpecTicketTableMarkup(DEFAULT_SPEC_TICKETS_VIEW, false, (specKey) => specKey);

    expect(markup).toContain('No work item matches the view.');
    expect(markup).not.toContain('data-clear-filters');
  });
});

describe('the chips and the count', () => {
  test('a state chip carries its work-item state and the lane dot of its display state', () => {
    expect(SpecTicketsMarkup.stateChipsMarkup(['done'])).toContain('data-work-state="done" data-state="delivered"');
  });

  test('a spec chip carries its folder name and colour slot', () => {
    const spec = EXAMPLE_SNAPSHOT.specs[0];

    expect(SpecTicketsMarkup.specChipsMarkup(EXAMPLE_SNAPSHOT.specs)).toContain(`data-spec-chip="${spec?.folderName}" data-epic-slot="${spec?.colourSlot}"`);
  });

  test('counts shown of total work items', () => {
    expect(SpecTicketsMarkup.workItemCountText(3, 23)).toBe('3 of 23 work items');
    expect(SpecTicketsMarkup.workItemCountText(0, 0)).toBe('no work items');
  });
});
