/**
 * `rewriteOlderTrackerFiles` on real tracker files, pinned on its three verdicts and on being idempotent: a current, absent or unreadable
 * tracker is left byte for byte, and a version 1 file and a ticket in a retired word are rewritten once.
 */
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { createLogFileWriter }                            from '../../../adapters/log/LogFileWriter.ts';
import { createProgressFileWriter }                       from '../../../adapters/progress/ProgressFileWriter.ts';
import { createTicketFileWriter }                         from '../../../adapters/tickets/TicketFileWriter.ts';
import type { LogRecord }                                 from '../../../lib/tracker-model/@types/LogRecord.ts';
import type { ProgressFile }                              from '../../../lib/tracker-model/@types/ProgressFile.ts';
import { EmptyProgressUtil }                              from '../../../lib/tracker-model/utils/EmptyProgressUtil.ts';
import { LIMITS }                                         from '../../../shared/constants/Limits.ts';
import { ticketFixture }                                  from '../../../testing/BoardFixtures.ts';
import { createScratchDirectory, removeScratchDirectory } from '../../../testing/ScratchWorkspace.ts';
import { createRenderState }                              from '../../render/RenderState.ts';
import { workspacePathsFor, type Workspace }              from '../Workspace.ts';
import { rewriteOlderTrackerFiles }                       from './OlderTrackerFilesRewrite.ts';

const STARTED_AT = '2026-09-18T09:00:00+02:00';

const NOTE_RECORD: LogRecord = { at: '2026-09-18T10:15:00+02:00', kind: 'note', fields: { text: 'Example session started' } };

const BROKEN_LOG_TEXT = '{"at":"2026-09-18T20:05:00+02:00","kind":"note","fields":{"text":5}}\n';

const TICKET_FILE_NAME = '001-example-checkout-page.md';

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

function emptyProgress(): ProgressFile {
  return EmptyProgressUtil.emptyProgressFor({ project: 'Example Agency', startedAt: STARTED_AT, trackerId: 'example-tracker-id' });
}

function writeReadableTracker(): void {
  createProgressFileWriter(workspace.progressFilePath).write(emptyProgress());
  createLogFileWriter(workspace.logFilePath).write([NOTE_RECORD]);
  createTicketFileWriter().write({ ...ticketFixture({ title: 'Example checkout page' }), filePath: join(workspace.ticketsDirectory, TICKET_FILE_NAME) });
}

/** A version 1 file keeps its log inside itself as `{ at, text }` notes; the writers only write version 2, so the version is set by hand. */
function writeVersionOneTracker(): void {
  createProgressFileWriter(workspace.progressFilePath).write(emptyProgress());
  const stored = JSON.parse(readFileSync(workspace.progressFilePath, 'utf8')) as Record<string, unknown>;
  const versionOneDocument = { ...stored, version: 1, log: [{ at: NOTE_RECORD.at, text: 'Example session started' }] };
  writeFileSync(workspace.progressFilePath, `${JSON.stringify(versionOneDocument, null, LIMITS.JSON_INDENT)}\n`);
}

/** Every stored file but the lock's records, which every lock hold writes. */
function storedFileContents(): Record<string, string> {
  const contents: Record<string, string> = {};
  for (const fileName of readdirSync(workspace.trackerDirectory, { recursive: true, encoding: 'utf8' })) {
    const filePath = join(workspace.trackerDirectory, fileName);
    if (filePath.startsWith(workspace.lockDirectoryPath) || statSync(filePath).isDirectory()) continue;
    contents[fileName] = readFileSync(filePath, 'utf8');
  }
  return contents;
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
    writeReadableTracker();
    const filesBefore = storedFileContents();

    expect(await rewriteOlderTrackerFiles(workspace, now, renderState)).toEqual({ verdict: 'current' });
    expect(storedFileContents()).toEqual(filesBefore);
  });

  test('an unreadable or absent tracker answers unreadable and is left byte for byte', async () => {
    expect(await rewriteOlderTrackerFiles(workspace, now, renderState)).toEqual({ verdict: 'unreadable' });

    writeVersionOneTracker();
    writeFileSync(workspace.logFilePath, BROKEN_LOG_TEXT);
    const filesBefore = storedFileContents();

    expect(await rewriteOlderTrackerFiles(workspace, now, renderState)).toEqual({ verdict: 'unreadable' });
    expect(storedFileContents()).toEqual(filesBefore);
  });

  test('a version 1 file and a ticket holding a retired word are rewritten, and a second run answers current', async () => {
    writeVersionOneTracker();
    writeFileSync(join(workspace.ticketsDirectory, '002-rewrite-the-example-importer.md'), TICKET_FILE_WITH_A_RETIRED_WORD);

    const rewriting = await rewriteOlderTrackerFiles(workspace, now, renderState);

    expect(rewriting).toEqual({
      verdict:       'rewritten',
      rewrite:       { progressFileWasRewritten: true, rewrittenTicketCount: 1 },
      renderOutcome: { verdict: 'rendered', malformedTickets: [] },
    });
    expect(JSON.parse(readFileSync(workspace.progressFilePath, 'utf8'))).toMatchObject({ version: 2 });
    expect(readFileSync(workspace.logFilePath, 'utf8')).toBe(`${JSON.stringify(NOTE_RECORD)}\n`);
    expect(readFileSync(join(workspace.ticketsDirectory, '002-rewrite-the-example-importer.md'), 'utf8')).not.toContain('status: "open"');
    expect(await rewriteOlderTrackerFiles(workspace, now, renderState)).toEqual({ verdict: 'current' });
  });
});
