/**
 * `rewriteOlderTrackerFiles` on real tracker files, pinned on its three verdicts and on being idempotent: a current, absent or unreadable
 * tracker is left byte for byte; a version 1 file and a ticket in a retired word are rewritten once; and a version 2 file holding a retired
 * word or a review row known only by its name is stored in the current words with the row's link, with nothing logged.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join }                                   from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { writeVersionOneProgressFile }                    from '../../../adapters/legacy/testing/LegacyProgressFileFixtures.ts';
import { createLogFileWriter }                            from '../../../adapters/log/LogFileWriter.ts';
import { createProgressFileWriter }                       from '../../../adapters/progress/ProgressFileWriter.ts';
import { LIMITS }                                         from '../../../shared/constants/Limits.ts';
import { emptyProgress, fileRow }                         from '../../../testing/ProgressFixtures.ts';
import { createScratchDirectory, removeScratchDirectory } from '../../../testing/ScratchWorkspace.ts';
import {
  BROKEN_LOG_TEXT,
  EXAMPLE_SESSION_NOTE,
  storedFileContentsOf,
  writeReadableTracker
} from '../../../testing/TrackerFileFixtures.ts';
import { createRenderState }                 from '../../render/RenderState.ts';
import { workspacePathsFor, type Workspace } from '../Workspace.ts';
import { rewriteOlderTrackerFiles }          from './OlderTrackerFilesRewrite.ts';

const STARTED_AT = '2026-09-18T09:00:00+02:00';

const VERSION_ONE_LOG = [{ at: EXAMPLE_SESSION_NOTE.at, text: 'Example session started' }];

const TICKET_FILE_WITH_A_RETIRED_WORD = `---
id: "002"
title: "Rewrite the example importer"
type: "change"
status: "open"
filed: "2026-09-18T09:00:00+02:00"
updated: "2026-09-18T09:00:00+02:00"
started: null
finished: null
delivered: null
abandonedAt: null
task: null
---
# 002 — Rewrite the example importer
`;

const now = (): Date => new Date('2026-09-18T18:05:00Z');

const renderState = createRenderState();

let workspace: Workspace;


/** A version 2 file as a build before the status rename and the review link stored it: a row and its phase running, and a bar named only. */
function writeVersionTwoTrackerInOlderWords(): void {
  const progress = emptyProgress();
  fileRow(progress, { name: 'Draft the example page' });
  fileRow(progress, { name: 'Review 1 #001 — Example importer' });
  createProgressFileWriter(workspace.progressFilePath).write(progress);
  createLogFileWriter(workspace.logFilePath).write([EXAMPLE_SESSION_NOTE]);
  const stored = JSON.parse(readFileSync(workspace.progressFilePath, 'utf8')) as { tasks: Record<string, unknown>[] };
  const [buildingRow] = stored.tasks;
  if (buildingRow === undefined) throw new Error('expected the filed row in the stored file');
  buildingRow['status']  = 'running';
  buildingRow['history'] = [{ status: 'running', at: STARTED_AT }];
  writeFileSync(workspace.progressFilePath, `${JSON.stringify(stored, null, LIMITS.JSON_INDENT_SPACES)}\n`);
}

beforeEach(() => {
  workspace = workspacePathsFor(createScratchDirectory('older-tracker-files-rewrite'));
  mkdirSync(workspace.ticketsDirectory, { recursive: true });
});

afterEach(() => {
  removeScratchDirectory(workspace.rootDirectory);
});

describe('rewriteOlderTrackerFiles', () => {
  test('a current tracker answers current and is left byte for byte', async () => {
    writeReadableTracker(workspace);
    const filesBefore = storedFileContentsOf(workspace);

    expect(await rewriteOlderTrackerFiles(workspace, now, renderState)).toEqual({ verdict: 'current' });
    expect(storedFileContentsOf(workspace)).toEqual(filesBefore);
  });

  test('an unreadable or absent tracker answers unreadable and is left byte for byte', async () => {
    expect(await rewriteOlderTrackerFiles(workspace, now, renderState)).toEqual({ verdict: 'unreadable' });

    writeVersionOneProgressFile(workspace.progressFilePath, VERSION_ONE_LOG);
    writeFileSync(workspace.logFilePath, BROKEN_LOG_TEXT);
    const filesBefore = storedFileContentsOf(workspace);

    expect(await rewriteOlderTrackerFiles(workspace, now, renderState)).toEqual({ verdict: 'unreadable' });
    expect(storedFileContentsOf(workspace)).toEqual(filesBefore);
  });

  test('a version 1 file and a ticket holding a retired word are rewritten, and a second run answers current', async () => {
    writeVersionOneProgressFile(workspace.progressFilePath, VERSION_ONE_LOG);
    writeFileSync(join(workspace.ticketsDirectory, '002-rewrite-the-example-importer.md'), TICKET_FILE_WITH_A_RETIRED_WORD);

    const rewriting = await rewriteOlderTrackerFiles(workspace, now, renderState);

    expect(rewriting).toEqual({
      verdict:       'rewritten',
      rewrite:       { progressFileWasRewritten: true, logWasMovedToItsOwnFile: true, rewrittenTicketCount: 1 },
      renderOutcome: { verdict: 'rendered', malformedTickets: [] },
    });
    expect(JSON.parse(readFileSync(workspace.progressFilePath, 'utf8'))).toMatchObject({ version: 2 });
    expect(readFileSync(workspace.logFilePath, 'utf8')).toBe(`${JSON.stringify(EXAMPLE_SESSION_NOTE)}\n`);
    expect(readFileSync(join(workspace.ticketsDirectory, '002-rewrite-the-example-importer.md'), 'utf8')).not.toContain('status: "open"');
    expect(await rewriteOlderTrackerFiles(workspace, now, renderState)).toEqual({ verdict: 'current' });
  });

  test('a version 2 file holding a retired word and a review row known only by its name is stored current and linked, with nothing logged', async () => {
    writeVersionTwoTrackerInOlderWords();
    const logBefore = readFileSync(workspace.logFilePath, 'utf8');

    const rewriting = await rewriteOlderTrackerFiles(workspace, now, renderState);

    expect(rewriting).toEqual({
      verdict:       'rewritten',
      rewrite:       { progressFileWasRewritten: true, logWasMovedToItsOwnFile: false, rewrittenTicketCount: 0 },
      renderOutcome: { verdict: 'rendered', malformedTickets: [] },
    });
    const stored = JSON.parse(readFileSync(workspace.progressFilePath, 'utf8')) as { version: number; tasks: Record<string, unknown>[] };
    expect(stored.version).toBe(2);
    expect(stored.tasks[0]).toMatchObject({ status: 'in-progress', history: [{ status: 'in-progress', at: STARTED_AT }] });
    expect(stored.tasks[1]).toMatchObject({ reviewOf: '001', reviewBarRound: 1 });
    expect(readFileSync(workspace.logFilePath, 'utf8')).toBe(logBefore);
    const filesAfterTheRewrite = storedFileContentsOf(workspace);
    expect(await rewriteOlderTrackerFiles(workspace, now, renderState)).toEqual({ verdict: 'current' });
    expect(storedFileContentsOf(workspace)).toEqual(filesAfterTheRewrite);
  });
});
