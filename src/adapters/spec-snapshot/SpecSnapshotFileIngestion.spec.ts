/**
 * progress-spec.json read through a real file, as the render after its write reads it: the example repository's snapshot comes back equal,
 * task lines and `waitingOn` included, and each way a document goes wrong (another version, bad JSON, a field of the wrong type deep in a
 * work item) is an `unreadable` verdict naming its cause, never a throw. A missing file is `absent`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join }                     from 'node:path';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  test
} from 'bun:test';

import type { SpecSnapshot }                                                               from '../../lib/spec-snapshot/@types/SpecSnapshot.ts';
import { deriveSpecSnapshot }                                                              from '../../lib/spec-snapshot/SpecSnapshotDerivation.ts';
import { scannedExampleSpecKitRepository }                                                 from '../../testing/ScannedExampleSpecKitRepository.ts';
import { createCanonicalScratchDirectory, createScratchDirectory, removeScratchDirectory } from '../../testing/ScratchWorkspace.ts';
import { SpecSnapshotFileIngestion, type SpecSnapshotFileReading }                         from './SpecSnapshotFileIngestion.ts';
import { createSpecSnapshotFileWriter }                                                    from './SpecSnapshotFileWriter.ts';
import { SPEC_SNAPSHOT_FILE_NAME }                                                         from './constants/SpecSnapshotFile.ts';

const GENERATED_AT = new Date('2026-10-07T09:30:00.000Z');
const scratchDirectories: string[] = [];
let exampleSnapshot: SpecSnapshot;

beforeAll(() => {
  const repositoryDirectory = createCanonicalScratchDirectory('spec-snapshot-file-example');
  scratchDirectories.push(repositoryDirectory);
  exampleSnapshot = deriveSpecSnapshot(scannedExampleSpecKitRepository(repositoryDirectory), GENERATED_AT);
});

afterAll(() => {
  for (const directory of scratchDirectories) removeScratchDirectory(directory);
});

function scratchTrackerDirectory(prefix: string): string {
  const directory = createScratchDirectory(prefix);
  scratchDirectories.push(directory);
  return join(directory, '.agent-progress');
}

function readBackText(prefix: string, storedText: string): SpecSnapshotFileReading {
  const trackerDirectory = scratchTrackerDirectory(prefix);
  mkdirSync(trackerDirectory, { recursive: true });
  writeFileSync(join(trackerDirectory, SPEC_SNAPSHOT_FILE_NAME), storedText);
  return new SpecSnapshotFileIngestion(trackerDirectory).read();
}

function storedDocumentOf(snapshot: SpecSnapshot): Record<string, unknown> {
  return { version: 1, ...structuredClone(snapshot) };
}

function reasonOf(reading: SpecSnapshotFileReading): string {
  if (reading.verdict !== 'unreadable') throw new Error(`expected an unreadable document, got ${reading.verdict}`);
  return reading.reason;
}

describe('the round trip', () => {
  test('writing the example repository\'s snapshot and reading it back gives an equal snapshot', () => {
    const trackerDirectory = scratchTrackerDirectory('spec-snapshot-file-round-trip');
    createSpecSnapshotFileWriter(trackerDirectory).write(exampleSnapshot);
    const reading = new SpecSnapshotFileIngestion(trackerDirectory).read();
    if (reading.verdict !== 'readable') throw new Error(`expected a readable document, got ${JSON.stringify(reading)}`);
    expect(reading.snapshot).toEqual(exampleSnapshot);
    expect(Object.keys(reading.snapshot)).toEqual(Object.keys(exampleSnapshot));
  });

  test('the example holds task lines and a waiting work item, so the round trip carries both', () => {
    const workItems = exampleSnapshot.specs.flatMap((spec) => spec.workItems);
    expect(workItems.some((workItem) => workItem.tasks.length > 0)).toBe(true);
    expect(workItems.some((workItem) => workItem.waitingOn.length > 0)).toBe(true);
  });
});

describe('what the ingestion refuses', () => {
  test('a tracker folder holding no snapshot reads as absent', () => {
    expect(new SpecSnapshotFileIngestion(scratchTrackerDirectory('spec-snapshot-file-absent')).read()).toEqual({ verdict: 'absent' });
  });

  test('another version is unreadable and names the version it found and the one it reads', () => {
    const storedText = JSON.stringify({ ...storedDocumentOf(exampleSnapshot), version: 2 });
    expect(reasonOf(readBackText('spec-snapshot-file-version', storedText))).toBe('version is 2, and this build of agent-progress reads version 1');
  });

  test('bad JSON is unreadable and says it is not JSON', () => {
    expect(reasonOf(readBackText('spec-snapshot-file-bad-json', '{ "version": 1, '))).toContain('not valid JSON');
  });

  test('a field of the wrong type deep in a work item is unreadable and named by its path', () => {
    const storedDocument = storedDocumentOf(exampleSnapshot);
    const specIndex = exampleSnapshot.specs.findIndex((spec) => spec.workItems.some((workItem) => workItem.waitingOn.length > 0));
    const specs = storedDocument['specs'] as { workItems: { waitingOn: unknown }[] }[];
    const waitingWorkItem = specs[specIndex]?.workItems[0];
    if (waitingWorkItem === undefined) throw new Error('the example has no work item to spoil');
    waitingWorkItem.waitingOn = 'US2';
    expect(reasonOf(readBackText('spec-snapshot-file-wrong-type', JSON.stringify(storedDocument)))).toBe(`specs[${specIndex}].workItems[0].waitingOn is not an array`);
  });

  test('a document that is not an object is unreadable rather than a throw', () => {
    expect(reasonOf(readBackText('spec-snapshot-file-not-object', '[]'))).toBe('the document is not a JSON object');
  });
});
