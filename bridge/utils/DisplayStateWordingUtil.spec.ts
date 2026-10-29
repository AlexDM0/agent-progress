/** The state words. The case that matters is the repeat review, the one label carrying a number. */
import { expect, test } from 'bun:test';

import { DisplayStateWordingUtil } from './DisplayStateWordingUtil.ts';

test('a state reads as the static page words it', () => {
  expect(['draft', 'pending', 'in-review', 'reviewed', 'delivered'].map((state) => DisplayStateWordingUtil.labelOf(state as 'draft'))).toEqual([
    'Draft', 'To do', 'Awaiting review', 'Awaiting merge', 'Done',
  ]);
});

test('only a repeat review names its round', () => {
  expect(DisplayStateWordingUtil.stateLabelOf('re-review', 3)).toBe('Reviewing (round 3)');
  expect(DisplayStateWordingUtil.stateLabelOf('reviewing', 3)).toBe('Reviewing');
});
