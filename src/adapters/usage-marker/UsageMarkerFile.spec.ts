/**
 * The machine-wide usage marker both ways. What matters: a written marker reads back whole, into a monitor folder that does not exist yet;
 * a marker any Overseer could misread (no stamp, no seenBy, not JSON) is `malformed`, never a throw, so a hand-edited file cannot take the
 * Overseer down; and no marker is `absent`.
 */
import { readdirSync, writeFileSync } from 'node:fs';
import { join }                       from 'node:path';
import {
  afterEach,
  beforeEach,
  expect,
  test,
} from 'bun:test';
import { createScratchDirectory, removeScratchDirectory } from '../../testing/ScratchWorkspace.ts';
import { type UsageMarker, UsageMarkerFile }              from './UsageMarkerFile.ts';

const EXAMPLE_MARKER: UsageMarker = {
  vendor: 'claude-code', window: 'five_hour', resetsAt: '2026-11-01T22:00:34.000Z', seenBy: { trackerId: 'example-tracker', jobId: 'J4' },
};

let scratchDirectory = '';

const monitorFolder = (): string => join(scratchDirectory, 'monitor');

beforeEach(() => {
  scratchDirectory = createScratchDirectory('usage-marker');
});

afterEach(() => {
  removeScratchDirectory(scratchDirectory);
});

test('no marker reads as absent', () => {
  expect(UsageMarkerFile.read(monitorFolder())).toEqual({ verdict: 'absent' });
});

test('a written marker reads back whole, the monitor folder created, and leaves no temporary file behind', () => {
  UsageMarkerFile.write(monitorFolder(), EXAMPLE_MARKER);
  expect(UsageMarkerFile.read(monitorFolder())).toEqual({ verdict: 'read', marker: EXAMPLE_MARKER });
  expect(readdirSync(monitorFolder())).toEqual(['usage-limit.json']);
});

test.each([
  ['not JSON', '{'],
  ['a list', '[]'],
  ['no stamp', JSON.stringify({ ...EXAMPLE_MARKER, resetsAt: 'soon' })],
  ['no window', JSON.stringify({ ...EXAMPLE_MARKER, window: '' })],
  ['no seenBy job', JSON.stringify({ ...EXAMPLE_MARKER, seenBy: { trackerId: 'example-tracker' } })],
])('a marker with %s is malformed, never a throw', (_case, storedText) => {
  UsageMarkerFile.write(monitorFolder(), EXAMPLE_MARKER);
  writeFileSync(UsageMarkerFile.pathIn(monitorFolder()), storedText);
  expect(UsageMarkerFile.read(monitorFolder()).verdict).toBe('malformed');
});
