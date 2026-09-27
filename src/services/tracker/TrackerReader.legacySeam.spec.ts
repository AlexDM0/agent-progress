/**
 * The log's seam to a log carried over from a version 1 progress file, seen from the current side: beside a version 2 progress.json, which
 * carries no log, any log.jsonl, even one a carried-over log would refuse, comes back as its own records, an absent one as empty and an
 * unreadable one with its own reason, and nothing is ever marked for rewriting. It imports nothing from `src/adapters/legacy/`, so it
 * still holds once that folder and its seam line are dropped.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  afterEach,
  beforeEach,
  expect,
  test,
} from 'bun:test';
import { createLogFileWriter }                            from '../../adapters/log/LogFileWriter.ts';
import { createProgressFileWriter }                       from '../../adapters/progress/ProgressFileWriter.ts';
import type { LogRecord }                                 from '../../lib/tracker-model/@types/LogRecord.ts';
import { emptyProgress }                                  from '../../testing/ProgressFixtures.ts';
import { createScratchDirectory, removeScratchDirectory } from '../../testing/ScratchWorkspace.ts';
import { readTracker, type TrackerReading }               from './TrackerReader.ts';
import { workspacePathsFor, type Workspace }              from './Workspace.ts';

const NOTE: LogRecord = { at: '2026-09-18T20:30:00+02:00', kind: 'note', fields: { text: 'Example note naming #001' } };

const FINISHED_RECORD: LogRecord = {
  at:       '2026-09-18T21:00:00+02:00',
  kind:     'ticket-finished',
  ticketId: '001',
  fields:   {},
};

let workspace: Workspace;

function writeVersionTwoProgressFile(): void {
  createProgressFileWriter(workspace.progressFilePath).write(emptyProgress());
}

function storedLogOrVerdictOf(reading: TrackerReading): unknown {
  return reading.verdict === 'readable' ? reading.contents.storedLog : reading;
}

beforeEach(() => {
  workspace = workspacePathsFor(createScratchDirectory('tracker-reader-log-seam'));
  mkdirSync(workspace.ticketsDirectory, { recursive: true });
  writeVersionTwoProgressFile();
});

afterEach(() => {
  removeScratchDirectory(workspace.rootDirectory);
});

test('a readable log.jsonl comes back as its records, whatever they hold, and is never marked for rewriting', () => {
  for (const records of [[], [NOTE], [FINISHED_RECORD], [FINISHED_RECORD, NOTE], [NOTE, NOTE, FINISHED_RECORD]]) {
    createLogFileWriter(workspace.logFilePath).write(records);
    expect(storedLogOrVerdictOf(readTracker(workspace)), JSON.stringify(records)).toEqual({ records, logFileMustBeRewritten: false });
  }
});

test('an absent log.jsonl is an empty log, never marked for rewriting', () => {
  expect(storedLogOrVerdictOf(readTracker(workspace))).toEqual({ records: [], logFileMustBeRewritten: false });
});

test('an unreadable log.jsonl keeps its own reason, which names no progress file', () => {
  writeFileSync(workspace.logFilePath, 'not JSON\n');

  const reading = readTracker(workspace);

  expect(reading.verdict === 'unreadable' ? reading.unreadableFile : null).toBe('log-file');
  expect(reading.verdict === 'unreadable' ? reading.reason : '').toStartWith(`${workspace.logFilePath}, line 1:`);
  expect(reading.verdict === 'unreadable' ? reading.reason : workspace.progressFilePath).not.toContain(workspace.progressFilePath);
});
