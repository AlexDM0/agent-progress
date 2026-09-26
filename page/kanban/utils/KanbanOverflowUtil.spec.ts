/** Which way the Kanban board can still scroll; a board within a pixel of an end counts as at that end. */

import { describe, expect, test } from 'bun:test';
import { KanbanOverflowUtil }     from './KanbanOverflowUtil.ts';

const { overflowDirectionsOf } = KanbanOverflowUtil;

describe('overflowDirectionsOf', () => {
  test.each([
    ['fits', 0, 1000, 1000, null],
    ['at the start of a wider board', 0, 1400, 1000, 'end'],
    ['mid-scroll', 200, 1400, 1000, 'start end'],
    ['at the end', 400, 1400, 1000, 'start'],
    ['within a pixel of the end', 399.5, 1400, 1000, 'start'],
  ])('answers the directions a board that %s can still scroll', (_description, scrollLeft, scrollWidth, clientWidth, expected) => {
    expect(overflowDirectionsOf(scrollLeft, scrollWidth, clientWidth)).toBe(expected);
  });
});
