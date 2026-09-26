/**
 * The write pipeline on real tracker files: the mutation runs with the lock held, a Board refusal and any other throw leave every stored
 * file as it was, an unreadable tracker is refused before the mutation runs, and the write order holds (a version 1 log first, then
 * progress.json, the tickets, the deletions and log.jsonl last), observed by breaking one write from inside the mutation, with no clock.
 * `rewriteOlderTrackerFiles` is pinned on its three verdicts and on being idempotent.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
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
import { createLogFileWriter }                                        from '../../adapters/log/LogFileWriter.ts';
import { createProgressFileWriter }                                   from '../../adapters/progress/ProgressFileWriter.ts';
import { createTicketFileWriter }                                     from '../../adapters/tickets/TicketFileWriter.ts';
import type { LogRecord }                                             from '../../lib/tracker-model/@types/LogRecord.ts';
import type { ProgressFile }                                          from '../../lib/tracker-model/@types/ProgressFile.ts';
import { EmptyProgressUtil }                                          from '../../lib/tracker-model/utils/EmptyProgressUtil.ts';
import { OperationRefusal, refusalIsOperationRefusal }                from '../../shared/OperationRefusal.ts';
import { LIMITS }                                                     from '../../shared/constants/Limits.ts';
import { ticketFixture }                                              from '../../testing/BoardFixtures.ts';
import { createScratchDirectory, removeScratchDirectory }             from '../../testing/ScratchWorkspace.ts';
import { LockGenerationSteps }                                        from './TrackerLock.ts';
import { rewriteOlderTrackerFiles, writeTracker, type TrackerChange } from './TrackerPipeline.ts';
import { workspacePathsFor, type Workspace }                          from './Workspace.ts';

const STARTED_AT = '2026-09-18T09:00:00+02:00';

const CHANGED_AT = '2026-09-18T20:05:00+02:00';

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

let workspace: Workspace;

function emptyProgress(): ProgressFile {
  return EmptyProgressUtil.emptyProgressFor({ project: 'Example Agency', startedAt: STARTED_AT, trackerId: 'example-tracker-id' });
}

function ticketFilePath(): string {
  return join(workspace.ticketsDirectory, TICKET_FILE_NAME);
}

function writeReadableTracker(): void {
  createProgressFileWriter(workspace.progressFilePath).write(emptyProgress());
  createLogFileWriter(workspace.logFilePath).write([NOTE_RECORD]);
  createTicketFileWriter().write({ ...ticketFixture({ title: 'Example checkout page' }), filePath: ticketFilePath() });
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

function newestLockRecord(): unknown {
  const newestGeneration = (LockGenerationSteps.generationsIn(workspace.lockDirectoryPath) ?? []).at(-1);
  if (newestGeneration === undefined) return null;
  return JSON.parse(readFileSync(LockGenerationSteps.generationPathFor(workspace.lockDirectoryPath, newestGeneration), 'utf8'));
}

function addExampleRow(change: TrackerChange, name = 'Example rendered row'): void {
  change.board.addTask({ name, startsNow: false, movesTheLink: false }, change.at);
}

async function failureOf(action: () => Promise<unknown>): Promise<unknown> {
  try {
    await action();
  } catch (error) {
    return error;
  }
  throw new Error('the action did not fail');
}

beforeEach(() => {
  workspace = workspacePathsFor(createScratchDirectory('tracker-pipeline'));
  mkdirSync(workspace.ticketsDirectory, { recursive: true });
});

afterEach(() => {
  removeScratchDirectory(workspace.rootDirectory);
});

describe('writeTracker', () => {
  test('the mutation runs with the lock held', async () => {
    writeReadableTracker();

    const written = await writeTracker({
      workspace,
      at:     CHANGED_AT,
      now,
      mutate: () => newestLockRecord(),
    });

    expect(written.result).toMatchObject({ processId: process.pid, state: 'held' });
  });

  test('the returned Board carries the mutation, and the rendered page shows the row it added', async () => {
    writeReadableTracker();

    const written = await writeTracker({
      workspace,
      at:     CHANGED_AT,
      now,
      mutate: (change) => addExampleRow(change),
    });

    expect(written.board.tasks().map((task) => task.name)).toEqual(['Example rendered row']);
    expect(written.renderOutcome).toEqual({ verdict: 'rendered', malformedTickets: [] });
    expect(readFileSync(workspace.htmlFilePath, 'utf8')).toContain('Example rendered row');
  });

  test('a Board refusal arrives as a refused OperationRefusal carrying its detail, and every file stays byte for byte', async () => {
    writeReadableTracker();
    const filesBefore = storedFileContents();

    const failure = await failureOf(() => writeTracker({
      workspace,
      at:     CHANGED_AT,
      now,
      mutate: (change) => {
        addExampleRow(change);
        change.board.holdTicket('001', 'Waiting on Alex Example', change.at);
        change.board.holdTicket('001', 'Waiting on Alex Example', change.at);
      },
    }));

    expect(refusalIsOperationRefusal(failure) ? failure.status : null).toBe('refused');
    expect(refusalIsOperationRefusal(failure) ? failure.detail : null).toEqual({
      kind:         'board-refusal',
      boardRefusal: { reason: 'ticket-already-held', ticketId: '001' },
    });
    expect(storedFileContents()).toEqual(filesBefore);
  });

  test('any other throw arrives as it was thrown, and nothing is written', async () => {
    writeReadableTracker();
    const filesBefore   = storedFileContents();
    const thrownFailure = new Error('the mutation failed');

    const failure = await failureOf(() => writeTracker({
      workspace,
      at:     CHANGED_AT,
      now,
      mutate: (change) => {
        addExampleRow(change);
        throw thrownFailure;
      },
    }));

    expect(failure).toBe(thrownFailure);
    expect(storedFileContents()).toEqual(filesBefore);
    expect(existsSync(workspace.htmlFilePath)).toBe(false);
  });

  test('an OperationRefusal thrown by the mutation arrives as it was thrown, with its own status', async () => {
    writeReadableTracker();
    const thrownRefusal = new OperationRefusal('refused', 'Example refusal from the mutation.');

    const failure = await failureOf(() => writeTracker({
      workspace,
      at:     CHANGED_AT,
      now,
      mutate: () => { throw thrownRefusal; },
    }));

    expect(failure).toBe(thrownRefusal);
  });

  test('an unreadable tracker is refused as unrepaired, and the mutation is never called', async () => {
    writeReadableTracker();
    writeFileSync(workspace.logFilePath, BROKEN_LOG_TEXT);
    let mutationWasCalled = false;

    const failure = await failureOf(() => writeTracker({
      workspace,
      at:     CHANGED_AT,
      now,
      mutate: () => { mutationWasCalled = true; },
    }));

    expect(refusalIsOperationRefusal(failure) ? failure.status : null).toBe('unrepaired');
    expect(refusalIsOperationRefusal(failure) ? failure.detail?.kind : null).toBe('unreadable-tracker');
    expect(mutationWasCalled).toBe(false);
  });

  test('a ticket write that fails does so after progress.json is written and before log.jsonl', async () => {
    writeReadableTracker();
    const logBefore = readFileSync(workspace.logFilePath, 'utf8');

    const failure = await failureOf(() => writeTracker({
      workspace,
      at:     CHANGED_AT,
      now,
      mutate: (change) => {
        addExampleRow(change);
        change.board.holdTicket('001', 'Waiting on Alex Example', change.at);
        rmSync(ticketFilePath());
        mkdirSync(ticketFilePath());
      },
    }));

    expect(String(failure), 'the ticket write is what failed').toContain(`/${TICKET_FILE_NAME}'`);
    expect(readFileSync(workspace.progressFilePath, 'utf8')).toContain('Example rendered row');
    expect(readFileSync(workspace.logFilePath, 'utf8')).toBe(logBefore);
  });

  test('for a version 1 tracker, log.jsonl is written before progress.json', async () => {
    writeVersionOneTracker();

    const failure = await failureOf(() => writeTracker({
      workspace,
      at:     CHANGED_AT,
      now,
      mutate: (change) => {
        addExampleRow(change);
        rmSync(workspace.progressFilePath);
        mkdirSync(workspace.progressFilePath);
      },
    }));

    expect(String(failure), 'the progress file write is what failed').toContain('/progress.json\'');
    expect(readFileSync(workspace.logFilePath, 'utf8')).toBe(`${JSON.stringify(NOTE_RECORD)}\n`);
  });

  test('the ticket files are deleted after progress.json is written, and the callback is handed their count', async () => {
    writeReadableTracker();
    writeFileSync(join(workspace.ticketsDirectory, '002-broken-by-hand.md'), 'no frontmatter here\n');
    const observedDeletions: { deletedTicketCount: number; progressAtDeletion: string }[] = [];

    await writeTracker({
      workspace,
      at:     CHANGED_AT,
      now,
      mutate: (change) => {
        addExampleRow(change);
        change.deleteAllTicketFilesAfterwards((deletedTicketCount) => {
          observedDeletions.push({ deletedTicketCount, progressAtDeletion: readFileSync(workspace.progressFilePath, 'utf8') });
        });
      },
    });

    expect(observedDeletions.map((deletion) => deletion.deletedTicketCount)).toEqual([2]);
    expect(observedDeletions[0]?.progressAtDeletion ?? '').toContain('Example rendered row');
    expect(readdirSync(workspace.ticketsDirectory)).toEqual([]);
  });

  test('the stored log entry count is the count read before the mutation logged anything', async () => {
    writeReadableTracker();

    const written = await writeTracker({
      workspace,
      at:     CHANGED_AT,
      now,
      mutate: (change) => {
        change.board.recordNote('Example note', change.at);
        return change.storedLogEntryCount;
      },
    });

    expect(written.result).toBe(1);
    expect(readFileSync(workspace.logFilePath, 'utf8').trimEnd().split('\n')).toHaveLength(2);
  });
});

describe('rewriteOlderTrackerFiles', () => {
  test('a current tracker answers current and is left byte for byte', async () => {
    writeReadableTracker();
    const filesBefore = storedFileContents();

    expect(await rewriteOlderTrackerFiles(workspace, now)).toEqual({ verdict: 'current' });
    expect(storedFileContents()).toEqual(filesBefore);
  });

  test('an unreadable or absent tracker answers unreadable and is left byte for byte', async () => {
    expect(await rewriteOlderTrackerFiles(workspace, now)).toEqual({ verdict: 'unreadable' });

    writeVersionOneTracker();
    writeFileSync(workspace.logFilePath, BROKEN_LOG_TEXT);
    const filesBefore = storedFileContents();

    expect(await rewriteOlderTrackerFiles(workspace, now)).toEqual({ verdict: 'unreadable' });
    expect(storedFileContents()).toEqual(filesBefore);
  });

  test('a version 1 file and a ticket holding a retired word are rewritten, and a second run answers current', async () => {
    writeVersionOneTracker();
    writeFileSync(join(workspace.ticketsDirectory, '002-rewrite-the-example-importer.md'), TICKET_FILE_WITH_A_RETIRED_WORD);

    const rewriting = await rewriteOlderTrackerFiles(workspace, now);

    expect(rewriting).toEqual({
      verdict:       'rewritten',
      rewrite:       { progressFileWasRewritten: true, rewrittenTicketCount: 1 },
      renderOutcome: { verdict: 'rendered', malformedTickets: [] },
    });
    expect(JSON.parse(readFileSync(workspace.progressFilePath, 'utf8'))).toMatchObject({ version: 2 });
    expect(readFileSync(workspace.logFilePath, 'utf8')).toBe(`${JSON.stringify(NOTE_RECORD)}\n`);
    expect(readFileSync(join(workspace.ticketsDirectory, '002-rewrite-the-example-importer.md'), 'utf8')).not.toContain('status: "open"');
    expect(await rewriteOlderTrackerFiles(workspace, now)).toEqual({ verdict: 'current' });
  });
});
