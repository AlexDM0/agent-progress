/**
 * `writeTracker` on a version 1 progress.json: the notes its embedded log held are written to log.jsonl before progress.json, so a failed
 * progress write never loses them. It reads the older input `src/adapters/legacy/` exists for, and is deleted with it.
 */
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
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
import { createRenderState }                              from '../../render/RenderState.ts';
import { writeTracker }                                   from '../TrackerPipeline.ts';
import { workspacePathsFor, type Workspace }              from '../Workspace.ts';
import { failureOf }                                      from '../testing/ThrownFailure.ts';

const CHANGED_AT = '2026-09-18T20:05:00+02:00';

const now = (): Date => new Date('2026-09-18T18:05:00Z');

const renderState = createRenderState();

let workspace: Workspace;

beforeEach(() => {
  workspace = workspacePathsFor(createScratchDirectory('tracker-pipeline-legacy'));
  mkdirSync(workspace.ticketsDirectory, { recursive: true });
});

afterEach(() => {
  removeScratchDirectory(workspace.rootDirectory);
});

describe('writeTracker', () => {
  test('for a version 1 tracker, log.jsonl is written before progress.json', async () => {
    writeVersionOneProgressFile(workspace.progressFilePath, [{ at: EXAMPLE_SESSION_NOTE.at, text: 'Example session started' }]);

    const failure = await failureOf(() => writeTracker({
      workspace,
      at:     CHANGED_AT,
      now,
      renderState,
      mutate: (change) => {
        change.board.addTask({ name: 'Example rendered row', startsNow: false, movesTheLink: false }, change.at);
        rmSync(workspace.progressFilePath);
        mkdirSync(workspace.progressFilePath);
      },
    }));

    expect(String(failure), 'the progress file write is what failed').toContain('/progress.json\'');
    expect(readFileSync(workspace.logFilePath, 'utf8')).toBe(`${JSON.stringify(EXAMPLE_SESSION_NOTE)}\n`);
  });
});
