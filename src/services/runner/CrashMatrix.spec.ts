/**
 * The crash, reboot and update matrix, one row per scenario, each held against the mechanism that settles it; later mechanisms add their
 * rows here. What matters in these rows: a hold cut short after its journal is finished by the next holder before that holder reads, and a
 * holder whose lock was taken over writes nothing further, its committed journal replayed by its successor.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join }                                from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { refusalIsOperationRefusal }                      from '../../shared/OperationRefusal.ts';
import { LIMITS }                                         from '../../shared/constants/Limits.ts';
import { createScratchDirectory, removeScratchDirectory } from '../../testing/ScratchWorkspace.ts';
import { EXAMPLE_TICKET_FILE_NAME, writeReadableTracker } from '../../testing/TrackerFileFixtures.ts';
import { createRenderState }                              from '../render/RenderState.ts';
import { holdJournalFilePathOf }                          from '../tracker/HoldJournal.ts';
import { LockGenerationSteps }                            from '../tracker/TrackerLock.ts';
import { writeTracker, type TrackerChange }               from '../tracker/TrackerPipeline.ts';
import { workspacePathsFor, type Workspace }              from '../tracker/Workspace.ts';

const CHANGED_AT = '2026-09-18T20:05:00+02:00';

const now = (): Date => new Date('2026-09-18T18:05:00Z');

const renderState = createRenderState();

let workspace: Workspace;

function ticketText(): string {
  return readFileSync(join(workspace.ticketsDirectory, EXAMPLE_TICKET_FILE_NAME), 'utf8');
}

function holdTheExampleTicket(change: TrackerChange): void {
  change.board.addTask({ name: 'Example cut-short row', startsNow: false, movesTheLink: false }, change.at);
  change.board.holdTicket('001', 'Waiting on Alex Example', change.at);
}

function noteAnExample(change: TrackerChange): void {
  change.board.recordNote('Example note of the next holder', change.at);
}

async function failureOf(action: () => Promise<unknown>): Promise<unknown> {
  try {
    await action();
  } catch (error) {
    return error;
  }
  return null;
}

/** Takes the lock over as stale from inside the current hold, as a command arriving after the holder slept past the threshold would. */
function takeTheLockOver(): void {
  const payload  = { processId: process.pid, acquiredAt: CHANGED_AT };
  const takeover = LockGenerationSteps.attemptedAcquire(workspace.lockDirectoryPath, payload, now().getTime() + LIMITS.LOCK_STALE_MILLISECONDS + 1);
  if (takeover.verdict !== 'acquired') throw new Error(`the takeover found the lock ${takeover.verdict}`);
  LockGenerationSteps.release(workspace.lockDirectoryPath, takeover.generation, payload);
}

beforeEach(() => {
  workspace = workspacePathsFor(createScratchDirectory('crash-matrix'));
  mkdirSync(workspace.ticketsDirectory, { recursive: true });
  writeReadableTracker(workspace);
});

afterEach(() => {
  removeScratchDirectory(workspace.rootDirectory);
});

describe('crash between progress.json and the ticket files', () => {
  test('the next lock holder replays hold-journal.json, finishing the cut-short write before its own', async () => {
    const ticketBefore = ticketText();
    const crash        = new Error('the holder crashed');

    const failure = await failureOf(() => writeTracker({
      workspace,
      at:               CHANGED_AT,
      now,
      renderState,
      mutate:           holdTheExampleTicket,
      afterFileWritten: (filePath) => { if (filePath === workspace.progressFilePath) throw crash; },
    }));
    expect(failure).toBe(crash);
    expect(readFileSync(workspace.progressFilePath, 'utf8')).toContain('Example cut-short row');
    expect(ticketText(), 'the board is torn: the ticket was not written').toBe(ticketBefore);

    const written = await writeTracker({
      workspace, at: CHANGED_AT, now, renderState, mutate: noteAnExample,
    });

    expect(ticketText()).toContain('Waiting on Alex Example');
    expect(written.board.tasks().map((task) => task.name)).toEqual(['Example cut-short row']);
    const loggedKinds = readFileSync(workspace.logFilePath, 'utf8').trimEnd().split('\n').map((line) => (JSON.parse(line) as { kind: string }).kind);
    expect(loggedKinds.at(-1)).toBe('note');
    expect(loggedKinds.length, 'the cut-short hold\'s records are in the log before the next holder\'s note').toBeGreaterThan(2);
    expect(existsSync(holdJournalFilePathOf(workspace))).toBe(false);
  });
});

describe('a stale holder resumes after a lock takeover', () => {
  test('taken over before its journal, it refuses lock-taken-over as unrepaired and writes nothing', async () => {
    const progressBefore = readFileSync(workspace.progressFilePath, 'utf8');

    const failure = await failureOf(() => writeTracker({
      workspace,
      at:     CHANGED_AT,
      now,
      renderState,
      mutate: (change) => {
        holdTheExampleTicket(change);
        takeTheLockOver();
      },
    }));

    expect(refusalIsOperationRefusal(failure) ? failure.status : null).toBe('unrepaired');
    expect(refusalIsOperationRefusal(failure) ? failure.detail?.kind : null).toBe('lock-taken-over');
    expect(readFileSync(workspace.progressFilePath, 'utf8')).toBe(progressBefore);
    expect(existsSync(holdJournalFilePathOf(workspace))).toBe(false);
  });

  test('taken over after its journal, it writes no further file, and its successor replays the committed hold', async () => {
    const ticketBefore = ticketText();

    const failure = await failureOf(() => writeTracker({
      workspace,
      at:               CHANGED_AT,
      now,
      renderState,
      mutate:           holdTheExampleTicket,
      afterFileWritten: (filePath) => { if (filePath === workspace.progressFilePath) takeTheLockOver(); },
    }));

    expect(refusalIsOperationRefusal(failure) ? failure.detail?.kind : null).toBe('lock-taken-over');
    expect(ticketText()).toBe(ticketBefore);
    expect(existsSync(holdJournalFilePathOf(workspace))).toBe(true);

    await writeTracker({
      workspace, at: CHANGED_AT, now, renderState, mutate: noteAnExample,
    });

    expect(ticketText()).toContain('Waiting on Alex Example');
    expect(existsSync(holdJournalFilePathOf(workspace))).toBe(false);
  });
});
