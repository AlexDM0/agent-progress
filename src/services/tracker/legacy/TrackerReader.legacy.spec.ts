/**
 * `readTracker` on a version 1 progress.json: its embedded log comes back as notes, and log.jsonl must be rewritten to take them.
 * It reads the older input `src/adapters/legacy/` exists for, and is deleted with it.
 */
import { mkdirSync } from 'node:fs';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { writeVersionOneProgressFile }                    from '../../../adapters/legacy/testing/LegacyProgressFileFixtures.ts';
import { createScratchDirectory, removeScratchDirectory } from '../../../testing/ScratchWorkspace.ts';
import { EXAMPLE_SESSION_NOTE }                           from '../../../testing/TrackerFileFixtures.ts';
import { readTracker }                                    from '../TrackerReader.ts';
import { workspacePathsFor, type Workspace }              from '../Workspace.ts';

let workspace: Workspace;

beforeEach(() => {
  workspace = workspacePathsFor(createScratchDirectory('tracker-reader-legacy'));
  mkdirSync(workspace.ticketsDirectory, { recursive: true });
});

afterEach(() => {
  removeScratchDirectory(workspace.rootDirectory);
});

describe('readTracker', () => {
  test('a version 1 file beside no log.jsonl reads its embedded notes, and log.jsonl must be rewritten', () => {
    writeVersionOneProgressFile(workspace.progressFilePath, [{ at: EXAMPLE_SESSION_NOTE.at, text: 'Example session started' }]);

    const reading = readTracker(workspace);

    expect(reading.verdict === 'readable' ? reading.contents.storedLog : reading).toEqual({ records: [EXAMPLE_SESSION_NOTE], logFileMustBeRewritten: true });
  });
});
