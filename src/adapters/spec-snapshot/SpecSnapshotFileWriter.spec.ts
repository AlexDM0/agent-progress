/**
 * The writer's contract on disk: into a scratch directory with no `.agent-progress/`, it creates the folder holding only
 * `progress-spec.json`; the text is the versioned document with a two-space indent and a trailing newline; and a second write replaces the
 * first whole.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join }                                  from 'node:path';
import { afterAll, expect, test }                from 'bun:test';

import type { SpecSnapshot }                              from '../../lib/spec-snapshot/@types/SpecSnapshot.ts';
import { deriveSpecSnapshot }                             from '../../lib/spec-snapshot/SpecSnapshotDerivation.ts';
import { createScratchDirectory, removeScratchDirectory } from '../../testing/ScratchWorkspace.ts';
import { sourceFeature, sourceRepository }                from '../../testing/SpecSnapshotSourceFixtures.ts';
import { createSpecSnapshotFileWriter }                   from './SpecSnapshotFileWriter.ts';

const GENERATED_AT = new Date('2026-10-07T09:30:00.000Z');
const scratchDirectories: string[] = [];

afterAll(() => {
  for (const directory of scratchDirectories) removeScratchDirectory(directory);
});

function scratchTrackerDirectory(prefix: string): string {
  const directory = createScratchDirectory(prefix);
  scratchDirectories.push(directory);
  return join(directory, '.agent-progress');
}

function snapshotOfProject(project: string): SpecSnapshot {
  return { ...deriveSpecSnapshot(sourceRepository([sourceFeature({})]), GENERATED_AT), project };
}

test('writing into a directory without .agent-progress/ creates the folder holding only progress-spec.json', () => {
  const trackerDirectory = scratchTrackerDirectory('spec-snapshot-writer-folder');
  expect(existsSync(trackerDirectory)).toBe(false);
  createSpecSnapshotFileWriter(trackerDirectory).write(snapshotOfProject('Example Project'));
  expect(readdirSync(trackerDirectory)).toEqual(['progress-spec.json']);
});

test('the stored text is the versioned document, version first, indented by two spaces and ending with a newline', () => {
  const trackerDirectory = scratchTrackerDirectory('spec-snapshot-writer-text');
  const snapshot = snapshotOfProject('Example Project');
  createSpecSnapshotFileWriter(trackerDirectory).write(snapshot);
  expect(readFileSync(join(trackerDirectory, 'progress-spec.json'), 'utf8')).toBe(`${JSON.stringify({ version: 1, ...snapshot }, null, 2)}\n`);
});

test('a second write replaces the first whole', () => {
  const trackerDirectory = scratchTrackerDirectory('spec-snapshot-writer-replace');
  const writer = createSpecSnapshotFileWriter(trackerDirectory);
  writer.write(snapshotOfProject('Example Project'));
  writer.write(snapshotOfProject('Example Agency'));
  const storedDocument: unknown = JSON.parse(readFileSync(join(trackerDirectory, 'progress-spec.json'), 'utf8'));
  expect(storedDocument).toMatchObject({ version: 1, project: 'Example Agency' });
});
