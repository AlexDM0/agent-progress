/**
 * A spec's group mark, roll-up and phase tags. The cases that matter: the mark carries the folder name as its key and the number with the
 * title; the roll-up counts work items by state, finished first, only the states present; and a phase tag falls back to its kind's word.
 */

import { describe, expect, test } from 'bun:test';

import type { SnapshotSpec, WorkItem } from '../../../src/lib/spec-snapshot/@types/SpecSnapshot.ts';
import { SpecGroupMarks }              from './SpecGroupMarks.ts';

function workItemOf(fields: Partial<WorkItem>): WorkItem {
  return {
    kind: 'user-story', ordinal: 1, storyNumber: null, tagText: null, state: 'to-do', ...fields
  } as WorkItem;
}

const EXAMPLE_SPEC = {
  folderName: '012-example-cart',
  title:      'Example cart',
  colourSlot: 3,
  workItems:  [workItemOf({ state: 'done' }), workItemOf({ state: 'to-do' }), workItemOf({ state: 'done' })],
} as unknown as SnapshotSpec;

describe('SpecGroupMarks', () => {
  test('a spec mark is keyed by its folder name and titled with its number', () => {
    expect(SpecGroupMarks.specMarkOf(EXAMPLE_SPEC)).toEqual({ key: '012-example-cart', title: '012 Example cart', slot: 3 });
    expect(SpecGroupMarks.specKeyOf({ ...EXAMPLE_SPEC, folderName: 'example-cart' })).toBe('example-cart');
  });

  test('the roll-up counts work items by state, finished first, leaving out the absent states', () => {
    expect(SpecGroupMarks.specRollupOf(EXAMPLE_SPEC)).toEqual({
      segments:  [{ state: 'delivered', count: 2 }, { state: 'pending', count: 1 }],
      ariaLabel: '2 of 3 work items done',
    });
  });

  test('a phase tag is the tasks.md label, or the word for its kind', () => {
    const tags = [
      workItemOf({ tagText: 'US2 · P2' }),
      workItemOf({ storyNumber: 4 }),
      workItemOf({ kind: 'polish' }),
      workItemOf({ kind: 'convergence' }),
      workItemOf({ kind: 'other', ordinal: 7 }),
    ].map(SpecGroupMarks.phaseTagTextOf);

    expect(tags).toEqual(['US2 · P2', 'US4', 'Polish', 'Converge', 'Phase 7']);
    expect(SpecGroupMarks.phaseTagMarkup(workItemOf({ tagText: '<US1>' }))).toBe('<span class="ap-spec-phase-tag">&lt;US1&gt;</span>');
  });
});
