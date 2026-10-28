/**
 * The redo journal on real files. What matters: the journal is whole on disk before the first target file changes and gone after the last;
 * the fence runs before the journal and before every file, so a taken-over hold writes nothing further; replay rewrites every file verbatim,
 * so replaying twice leaves the same bytes even over a hand-edited log; and a malformed journal is refused before any file is touched.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
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
import type { JournaledFile }                             from '../../adapters/hold-journal/HoldJournalIngestion.ts';
import { createHoldJournalWriter }                        from '../../adapters/hold-journal/HoldJournalWriter.ts';
import { refusalIsOperationRefusal }                      from '../../shared/OperationRefusal.ts';
import { LIMITS }                                         from '../../shared/constants/Limits.ts';
import { createScratchDirectory, removeScratchDirectory } from '../../testing/ScratchWorkspace.ts';
import {
  commitHold,
  holdJournalFilePathOf,
  readHoldJournal,
  replayHoldJournal,
  type HoldFence,
} from './HoldJournal.ts';
import { LockGenerationSteps, withLock }     from './TrackerLock.ts';
import { workspacePathsFor, type Workspace } from './Workspace.ts';
import { thrownFailureOf }                   from './testing/ThrownFailure.ts';

const now = (): Date => new Date('2026-09-18T18:05:00Z');

const OPEN_FENCE: HoldFence = { requireStillHeld: () => {} };

const HAND_EDITED_LOG_TEXT = '{"kind":"note","at":"2026-09-18T10:15:00+02:00","fields":{"text":"Example session started"}}\n\n';

let workspace: Workspace;

function ticketFilePath(): string {
  return join(workspace.ticketsDirectory, '001-example-checkout-page.md');
}

function exampleFiles(): JournaledFile[] {
  return [
    { kind: 'written', filePath: workspace.progressFilePath, contents: '{\n  "version": 1\n}\n' },
    { kind: 'written', filePath: ticketFilePath(), contents: '---\nid: 001\n---\nExample body\n' },
    { kind: 'removed', filePath: join(workspace.epicsDirectory, 'example-epic.md') },
    { kind: 'written', filePath: workspace.logFilePath, contents: '{"at":"2026-09-18T10:15:00+02:00","kind":"note","fields":{"text":"Example"}}\n' },
  ];
}

function storedBytesOf(files: readonly JournaledFile[]): (string | null)[] {
  return files.map((file) => (existsSync(file.filePath) ? readFileSync(file.filePath, 'utf8') : null));
}

beforeEach(() => {
  workspace = workspacePathsFor(createScratchDirectory('hold-journal'));
  mkdirSync(workspace.epicsDirectory, { recursive: true });
  writeFileSync(join(workspace.epicsDirectory, 'example-epic.md'), 'an epic the hold removes\n');
});

afterEach(() => {
  removeScratchDirectory(workspace.rootDirectory);
});

describe('commitHold', () => {
  test('the journal holds every file, the log as its whole new text, before the first target changes, and is gone after the last', () => {
    const files = exampleFiles();
    const observed: { journal: ReturnType<typeof readHoldJournal>; ticketExisted: boolean }[] = [];

    commitHold(workspace, files, OPEN_FENCE, (filePath) => {
      if (filePath === workspace.progressFilePath) observed.push({ journal: readHoldJournal(workspace), ticketExisted: existsSync(ticketFilePath()) });
    });

    expect(observed).toEqual([{ journal: { verdict: 'readable', files }, ticketExisted: false }]);
    expect(storedBytesOf(files)).toEqual(files.map((file) => (file.kind === 'written' ? file.contents : null)));
    expect(existsSync(holdJournalFilePathOf(workspace))).toBe(false);
  });

  test('a fence that refuses before the journal leaves no journal and no file written', async () => {
    const refusal = new Error('taken over');
    const failure = await thrownFailureOf(() => Promise.resolve(commitHold(workspace, exampleFiles(), { requireStillHeld: () => { throw refusal; } })));

    expect(failure).toBe(refusal);
    expect(existsSync(holdJournalFilePathOf(workspace))).toBe(false);
    expect(existsSync(workspace.progressFilePath)).toBe(false);
  });

  test('the fence runs before every file: refused after the first, the rest stay as they were and the journal stays for the successor', async () => {
    let fenceChecks = 0;
    const fence: HoldFence = {
      requireStillHeld: () => {
        fenceChecks++;
        // The journal's check and the progress file's pass; the ticket's is the first after the takeover.
        if (fenceChecks > 2) throw new Error('taken over');
      },
    };

    await thrownFailureOf(() => Promise.resolve(commitHold(workspace, exampleFiles(), fence)));

    expect(existsSync(workspace.progressFilePath)).toBe(true);
    expect(existsSync(ticketFilePath())).toBe(false);
    expect(readHoldJournal(workspace).verdict).toBe('readable');
  });
});

describe('a hold under the real lock', () => {
  test('a newer generation taken over the hold refuses lock-taken-over as unrepaired, and nothing further is written', async () => {
    const failure = await thrownFailureOf(() => withLock(workspace, (hold) => {
      const takeover = LockGenerationSteps.attemptedAcquire(
        workspace.lockDirectoryPath,
        { processId: process.pid, acquiredAt: '2026-09-18T20:05:00+02:00' },
        now().getTime() + LIMITS.LOCK_STALE_MILLISECONDS + 1,
      );
      expect(takeover.verdict).toBe('acquired');
      commitHold(workspace, exampleFiles(), hold);
    }, now));

    expect(refusalIsOperationRefusal(failure) ? failure.status : null).toBe('unrepaired');
    expect(refusalIsOperationRefusal(failure) ? failure.detail : null).toEqual({ kind: 'lock-taken-over', lockDirectoryPath: workspace.lockDirectoryPath });
    expect(existsSync(holdJournalFilePathOf(workspace))).toBe(false);
    expect(existsSync(workspace.progressFilePath)).toBe(false);
  });

  test('every acquisition replays a journal it finds before the action runs', async () => {
    const files = exampleFiles();
    createHoldJournalWriter(holdJournalFilePathOf(workspace), workspace.trackerDirectory).write(files);

    const bytesSeenByTheAction = await withLock(workspace, () => storedBytesOf(files), now);

    expect(bytesSeenByTheAction).toEqual(files.map((file) => (file.kind === 'written' ? file.contents : null)));
    expect(existsSync(holdJournalFilePathOf(workspace))).toBe(false);
  });

  test('a malformed journal is refused as unrepaired at acquisition, the action never runs and every file stays', async () => {
    mkdirSync(workspace.trackerDirectory, { recursive: true });
    writeFileSync(holdJournalFilePathOf(workspace), '{"version":1,"files":"not a list"}\n');
    writeFileSync(workspace.logFilePath, HAND_EDITED_LOG_TEXT);
    let actionRan = false;

    const failure = await thrownFailureOf(() => withLock(workspace, () => { actionRan = true; }, now));

    expect(refusalIsOperationRefusal(failure) ? failure.status : null).toBe('unrepaired');
    expect(refusalIsOperationRefusal(failure) ? failure.detail : null).toEqual({
      kind:            'malformed-hold-journal',
      journalFilePath: holdJournalFilePathOf(workspace),
      reason:          'its "files" is not a list',
    });
    expect(actionRan).toBe(false);
    expect(readFileSync(workspace.logFilePath, 'utf8')).toBe(HAND_EDITED_LOG_TEXT);
  });
});

describe('replayHoldJournal', () => {
  test('replaying twice yields the same bytes, over a hand-edited log with a blank line and reordered keys', () => {
    const files = exampleFiles();
    mkdirSync(workspace.trackerDirectory, { recursive: true });
    writeFileSync(workspace.logFilePath, HAND_EDITED_LOG_TEXT);
    const journalWriter = createHoldJournalWriter(holdJournalFilePathOf(workspace), workspace.trackerDirectory);

    journalWriter.write(files);
    replayHoldJournal(workspace, OPEN_FENCE);
    const bytesAfterTheFirstReplay = storedBytesOf(files);
    journalWriter.write(files);
    replayHoldJournal(workspace, OPEN_FENCE);

    expect(bytesAfterTheFirstReplay).toEqual(files.map((file) => (file.kind === 'written' ? file.contents : null)));
    expect(storedBytesOf(files)).toEqual(bytesAfterTheFirstReplay);
    expect(existsSync(holdJournalFilePathOf(workspace))).toBe(false);
  });

  test('no journal leaves every file alone', () => {
    mkdirSync(workspace.trackerDirectory, { recursive: true });
    writeFileSync(workspace.logFilePath, HAND_EDITED_LOG_TEXT);

    replayHoldJournal(workspace, OPEN_FENCE);

    expect(readFileSync(workspace.logFilePath, 'utf8')).toBe(HAND_EDITED_LOG_TEXT);
  });
});
