/**
 * The markers of the block the tool owns in `CLAUDE.md`. The cases that matter: neither contains the other, since the block writer finds
 * the end by searching forward from the start; and both are single-line HTML comments, since the block sits in a file people read rendered.
 */
import { expect, test } from 'bun:test';

import { CLAUDE_MANAGED_BLOCK_MARKERS } from './ClaudeManagedBlockMarkers.ts';

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
