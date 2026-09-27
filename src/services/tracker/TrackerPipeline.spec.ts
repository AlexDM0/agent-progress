/**
 * The write pipeline on real tracker files: the mutation runs with the lock held, a Board refusal and any other throw leave every stored
 * file as it was, an unreadable tracker is refused before the mutation runs, and the write order holds (progress.json, the tickets, the
 * deletions and log.jsonl last), observed by breaking one write from inside the mutation, with no clock.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
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
import { OperationRefusal, refusalIsOperationRefusal }    from '../../shared/OperationRefusal.ts';
import { createScratchDirectory, removeScratchDirectory } from '../../testing/ScratchWorkspace.ts';
import { failureOf }                                      from '../../testing/ThrownFailure.ts';
import {
  BROKEN_LOG_TEXT,
  EXAMPLE_TICKET_FILE_NAME,
  storedFileContentsOf,
  writeReadableTracker
} from '../../testing/TrackerFileFixtures.ts';
import { createRenderState }                 from '../render/RenderState.ts';
import { LockGenerationSteps }               from './TrackerLock.ts';
import { writeTracker, type TrackerChange }  from './TrackerPipeline.ts';
import { workspacePathsFor, type Workspace } from './Workspace.ts';

const CHANGED_AT = '2026-09-18T20:05:00+02:00';

const now = (): Date => new Date('2026-09-18T18:05:00Z');

const renderState = createRenderState();

let workspace: Workspace;

function ticketFilePath(): string {
  return join(workspace.ticketsDirectory, EXAMPLE_TICKET_FILE_NAME);
}

function newestLockRecord(): unknown {
  const newestGeneration = (LockGenerationSteps.generationsIn(workspace.lockDirectoryPath) ?? []).at(-1);
  if (newestGeneration === undefined) return null;
  return JSON.parse(readFileSync(LockGenerationSteps.generationPathFor(workspace.lockDirectoryPath, newestGeneration), 'utf8'));
}

function addExampleRow(change: TrackerChange, name = 'Example rendered row'): void {
  change.board.addTask({ name, startsNow: false, movesTheLink: false }, change.at);
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
    writeReadableTracker(workspace);

    const written = await writeTracker({
      workspace,
      at:     CHANGED_AT,
      now,
      renderState,
      mutate: () => newestLockRecord(),
    });

    expect(written.result).toMatchObject({ processId: process.pid, state: 'held' });
  });

  test('the returned Board carries the mutation, and the rendered page shows the row it added', async () => {
    writeReadableTracker(workspace);

    const written = await writeTracker({
      workspace,
      at:     CHANGED_AT,
      now,
      renderState,
      mutate: (change) => addExampleRow(change),
    });

    expect(written.board.tasks().map((task) => task.name)).toEqual(['Example rendered row']);
    expect(written.renderOutcome).toEqual({ verdict: 'rendered', malformedTickets: [] });
    expect(readFileSync(workspace.htmlFilePath, 'utf8')).toContain('Example rendered row');
  });

  test('a Board refusal arrives as a refused OperationRefusal carrying its detail, and every file stays byte for byte', async () => {
    writeReadableTracker(workspace);
    const filesBefore = storedFileContentsOf(workspace);

    const failure = await failureOf(() => writeTracker({
      workspace,
      at:     CHANGED_AT,
      now,
      renderState,
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
    expect(storedFileContentsOf(workspace)).toEqual(filesBefore);
  });

  test('any other throw arrives as it was thrown, and nothing is written', async () => {
    writeReadableTracker(workspace);
    const filesBefore   = storedFileContentsOf(workspace);
    const thrownFailure = new Error('the mutation failed');

    const failure = await failureOf(() => writeTracker({
      workspace,
      at:     CHANGED_AT,
      now,
      renderState,
      mutate: (change) => {
        addExampleRow(change);
        throw thrownFailure;
      },
    }));

    expect(failure).toBe(thrownFailure);
    expect(storedFileContentsOf(workspace)).toEqual(filesBefore);
    expect(existsSync(workspace.htmlFilePath)).toBe(false);
  });

  test('an OperationRefusal thrown by the mutation arrives as it was thrown, with its own status', async () => {
    writeReadableTracker(workspace);
    const thrownRefusal = new OperationRefusal('refused', 'Example refusal from the mutation.');

    const failure = await failureOf(() => writeTracker({
      workspace,
      at:     CHANGED_AT,
      now,
      renderState,
      mutate: () => { throw thrownRefusal; },
    }));

    expect(failure).toBe(thrownRefusal);
  });

  test('an unreadable tracker is refused as unrepaired, and the mutation is never called', async () => {
    writeReadableTracker(workspace);
    writeFileSync(workspace.logFilePath, BROKEN_LOG_TEXT);
    let mutationWasCalled = false;

    const failure = await failureOf(() => writeTracker({
      workspace,
      at:     CHANGED_AT,
      now,
      renderState,
      mutate: () => { mutationWasCalled = true; },
    }));

    expect(refusalIsOperationRefusal(failure) ? failure.status : null).toBe('unrepaired');
    expect(refusalIsOperationRefusal(failure) ? failure.detail?.kind : null).toBe('unreadable-tracker');
    expect(mutationWasCalled).toBe(false);
  });

  test('a ticket write that fails does so after progress.json is written and before log.jsonl', async () => {
    writeReadableTracker(workspace);
    const logBefore = readFileSync(workspace.logFilePath, 'utf8');

    const failure = await failureOf(() => writeTracker({
      workspace,
      at:     CHANGED_AT,
      now,
      renderState,
      mutate: (change) => {
        addExampleRow(change);
        change.board.holdTicket('001', 'Waiting on Alex Example', change.at);
        rmSync(ticketFilePath());
        mkdirSync(ticketFilePath());
      },
    }));

    expect(String(failure), 'the ticket write is what failed').toContain(`/${EXAMPLE_TICKET_FILE_NAME}'`);
    expect(readFileSync(workspace.progressFilePath, 'utf8')).toContain('Example rendered row');
    expect(readFileSync(workspace.logFilePath, 'utf8')).toBe(logBefore);
  });

  test('the ticket files are deleted after progress.json is written, and the callback is handed their count', async () => {
    writeReadableTracker(workspace);
    writeFileSync(join(workspace.ticketsDirectory, '002-broken-by-hand.md'), 'no frontmatter here\n');
    const observedDeletions: { deletedTicketCount: number; progressAtDeletion: string }[] = [];

    await writeTracker({
      workspace,
      at:     CHANGED_AT,
      now,
      renderState,
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
    writeReadableTracker(workspace);

    const written = await writeTracker({
      workspace,
      at:     CHANGED_AT,
      now,
      renderState,
      mutate: (change) => {
        change.board.recordNote('Example note', change.at);
        return change.storedLogEntryCount;
      },
    });

    expect(written.result).toBe(1);
    expect(readFileSync(workspace.logFilePath, 'utf8').trimEnd().split('\n')).toHaveLength(2);
  });
});
