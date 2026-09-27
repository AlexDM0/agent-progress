/**
 * The tracker read without the lock: which verdict each broken or missing file gives, that the progress file's verdict wins over a broken
 * log, how an absent log.jsonl reads beside a version 2 file, and that reading writes nothing. `requireProgressFile` is pinned apart because
 * `concurrency` and `dispatcher` must keep working with a broken log.jsonl.
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
import { createLogFileWriter }                            from '../../adapters/log/LogFileWriter.ts';
import { createProgressFileWriter }                       from '../../adapters/progress/ProgressFileWriter.ts';
import { createTicketFileWriter }                         from '../../adapters/tickets/TicketFileWriter.ts';
import type { LogRecord }                                 from '../../lib/tracker-model/@types/LogRecord.ts';
import type { ProgressFile }                              from '../../lib/tracker-model/@types/ProgressFile.ts';
import type { UnreadableTracker }                         from '../../shared/@types/UnreadableTracker.ts';
import { refusalIsOperationRefusal }                      from '../../shared/OperationRefusal.ts';
import { ticketFixture }                                  from '../../testing/BoardFixtures.ts';
import { emptyProgress, fileRow }                         from '../../testing/ProgressFixtures.ts';
import { createScratchDirectory, removeScratchDirectory } from '../../testing/ScratchWorkspace.ts';
import { BROKEN_LOG_TEXT }                                from '../../testing/TrackerFileFixtures.ts';
import {
  readTracker,
  requireProgressFile,
  requireTracker,
  type TrackerContents,
  type TrackerReading
} from './TrackerReader.ts';
import { workspacePathsFor, type Workspace } from './Workspace.ts';

const NOTE_AT = '2026-09-18T20:05:00+02:00';

const UNPARSEABLE_PROGRESS_TEXT = 'not a progress file\n';

const MALFORMED_TICKET_TEXT = 'no frontmatter here\n';

const NOTE_RECORD: LogRecord = { at: NOTE_AT, kind: 'note', fields: { text: 'Example note' } };

let workspace: Workspace;

function progressWithOneRow(): ProgressFile {
  const progress = emptyProgress();
  fileRow(progress, { name: 'Example task' });
  return progress;
}

function writeReadableTracker(): void {
  createProgressFileWriter(workspace.progressFilePath).write(progressWithOneRow());
  createLogFileWriter(workspace.logFilePath).write([NOTE_RECORD]);
  createTicketFileWriter().write({ ...ticketFixture({ title: 'Example checkout page' }), filePath: join(workspace.ticketsDirectory, '001-example-checkout-page.md') });
  writeFileSync(join(workspace.ticketsDirectory, '002-broken-by-hand.md'), MALFORMED_TICKET_TEXT);
}

function trackerFileContents(): Record<string, string> {
  const contents: Record<string, string> = {};
  for (const fileName of readdirSync(workspace.trackerDirectory, { recursive: true, encoding: 'utf8' })) {
    const filePath = join(workspace.trackerDirectory, fileName);
    if (!statSync(filePath).isDirectory()) contents[fileName] = readFileSync(filePath, 'utf8');
  }
  return contents;
}

function contentsOf(reading: TrackerReading): TrackerContents {
  if (reading.verdict !== 'readable') throw new Error(`the tracker was expected to be readable, and reads ${reading.verdict}`);
  return reading.contents;
}

function unreadableReadingOf(reading: TrackerReading): UnreadableTracker {
  if (reading.verdict === 'readable') throw new Error('the tracker was expected to be unreadable, and reads readable');
  return reading;
}

function refusalOf(read: () => unknown): unknown {
  try {
    read();
  } catch (error) {
    return error;
  }
  throw new Error('the read did not refuse');
}

beforeEach(() => {
  workspace = workspacePathsFor(createScratchDirectory('tracker-reader'));
  mkdirSync(workspace.ticketsDirectory, { recursive: true });
});

afterEach(() => {
  removeScratchDirectory(workspace.rootDirectory);
});

describe('readTracker', () => {
  test('a readable tracker gives its progress, its log records and its listing with the malformed files, and every file stays byte for byte', () => {
    writeReadableTracker();
    const filesBefore = trackerFileContents();

    const contents = contentsOf(readTracker(workspace));

    expect(contents.progress).toEqual(progressWithOneRow());
    expect(contents.storedLog).toEqual({ records: [NOTE_RECORD], logFileMustBeRewritten: false });
    expect(contents.listing.tickets.map((ticket) => ticket.frontmatter.id)).toEqual(['001']);
    expect(contents.listing.malformed.map((malformed) => malformed.filePath)).toEqual([join(workspace.ticketsDirectory, '002-broken-by-hand.md')]);
    expect(trackerFileContents()).toEqual(filesBefore);
  });

  test('an absent progress file is absent, with its path', () => {
    expect(readTracker(workspace)).toEqual({ verdict: 'absent', filePath: workspace.progressFilePath });
  });

  test('a progress file that does not parse is an unreadable progress file, carrying the adapter\'s reason', () => {
    writeFileSync(workspace.progressFilePath, UNPARSEABLE_PROGRESS_TEXT);

    const reading = readTracker(workspace);

    expect(reading.verdict === 'unreadable' ? reading.unreadableFile : null).toBe('progress-file');
    expect(reading.verdict === 'unreadable' ? reading.filePath : null).toBe(workspace.progressFilePath);
    expect(reading.verdict === 'unreadable' ? reading.reason : '').not.toBe('');
  });

  test('a broken log.jsonl is an unreadable log file, carrying the adapter\'s reason', () => {
    createProgressFileWriter(workspace.progressFilePath).write(progressWithOneRow());
    writeFileSync(workspace.logFilePath, BROKEN_LOG_TEXT);

    expect(readTracker(workspace)).toEqual({
      verdict:        'unreadable',
      unreadableFile: 'log-file',
      filePath:       workspace.logFilePath,
      reason:         `${workspace.logFilePath}, line 1: fields.text is not a string`,
    });
  });

  test('when both files are broken, the progress file\'s verdict comes first', () => {
    writeFileSync(workspace.progressFilePath, UNPARSEABLE_PROGRESS_TEXT);
    writeFileSync(workspace.logFilePath, BROKEN_LOG_TEXT);

    const reading = readTracker(workspace);

    expect(reading.verdict === 'unreadable' ? reading.unreadableFile : null).toBe('progress-file');
  });

  test('an absent log.jsonl beside a version 2 file reads as an empty log that does not need rewriting', () => {
    createProgressFileWriter(workspace.progressFilePath).write(progressWithOneRow());

    expect(contentsOf(readTracker(workspace)).storedLog).toEqual({ records: [], logFileMustBeRewritten: false });
  });
});

describe('requireTracker', () => {
  test('a readable tracker gives the contents readTracker reads', () => {
    writeReadableTracker();

    expect(requireTracker(workspace)).toEqual(contentsOf(readTracker(workspace)));
  });

  test('a tracker that cannot be read throws unrepaired, carrying the reading', () => {
    createProgressFileWriter(workspace.progressFilePath).write(progressWithOneRow());
    writeFileSync(workspace.logFilePath, BROKEN_LOG_TEXT);

    const refusal = refusalOf(() => requireTracker(workspace));

    expect(refusalIsOperationRefusal(refusal)).toBe(true);
    expect(refusalIsOperationRefusal(refusal) ? refusal.status : null).toBe('unrepaired');
    expect(refusalIsOperationRefusal(refusal) ? refusal.detail : null).toEqual({ kind: 'unreadable-tracker', reading: unreadableReadingOf(readTracker(workspace)) });
  });
});

describe('requireProgressFile', () => {
  test('it reads a tracker whose log.jsonl is broken, because it never reads the log', () => {
    createProgressFileWriter(workspace.progressFilePath).write(progressWithOneRow());
    writeFileSync(workspace.logFilePath, BROKEN_LOG_TEXT);

    expect(requireProgressFile(workspace)).toEqual(progressWithOneRow());
  });

  test('an absent progress file throws unrepaired, carrying the absent reading', () => {
    const refusal = refusalOf(() => requireProgressFile(workspace));

    expect(refusalIsOperationRefusal(refusal) ? refusal.status : null).toBe('unrepaired');
    expect(refusalIsOperationRefusal(refusal) ? refusal.detail : null).toEqual({
      kind:    'unreadable-tracker',
      reading: { verdict: 'absent', filePath: workspace.progressFilePath },
    });
  });

  test('a progress file that does not parse throws unrepaired, carrying the unreadable progress-file reading', () => {
    writeFileSync(workspace.progressFilePath, UNPARSEABLE_PROGRESS_TEXT);

    const refusal = refusalOf(() => requireProgressFile(workspace));

    expect(refusalIsOperationRefusal(refusal) ? refusal.detail : null).toEqual({ kind: 'unreadable-tracker', reading: unreadableReadingOf(readTracker(workspace)) });
  });
});
