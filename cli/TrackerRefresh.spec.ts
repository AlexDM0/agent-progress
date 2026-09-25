/**
 * The managed CLAUDE.md markers: the block writer finds the end by searching forward from the start, and
 * the block sits in a file people read rendered, so the markers must stay distinct and invisible.
 */
import { expect, test } from 'bun:test';

import { CLAUDE_MANAGED_BLOCK_MARKERS } from './TrackerRefresh';

const { start, end } = CLAUDE_MANAGED_BLOCK_MARKERS;

test('neither managed marker contains the other, so the search for the end marker cannot match the start marker', () => {
  expect(start).not.toBe(end);
  expect(start).not.toContain(end);
  expect(end).not.toContain(start);
});

test('both markers are HTML comments on a single line, so they stay invisible in a rendered CLAUDE.md', () => {
  for (const marker of [start, end]) {
    expect(marker.startsWith('<!--'), marker).toBe(true);
    expect(marker.endsWith('-->'), marker).toBe(true);
    expect(marker).not.toContain('\n');
  }
});
