/**
 * The log is read strictly, like progress.json: a missing file is an empty log, never an unreadable one; blank lines are no records;
 * and any other line that is not a well-formed record makes the whole file unreadable, naming the file, its 1-based line and the field,
 * because a person repairs it by hand from that reason alone.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join }                                   from 'node:path';
import { afterAll, expect, test }                 from 'bun:test';

import type { LogRecord }                                 from '../../lib/tracker-model/@types/LogRecord.ts';
import { createScratchDirectory, removeScratchDirectory } from '../../testing/ScratchWorkspace.ts';
import { LogFileIngestion, type LogFileReading }          from './LogFileIngestion.ts';

const FILED_AT   = '2026-09-18T20:30:00+02:00';
const STARTED_AT = '2026-09-18T20:40:00+02:00';

const FILED: LogRecord = {
  at:       FILED_AT,
  kind:     'ticket-filed',
  ticketId: '003',
  fields:   { title: 'Example checkout flow' },
};

const STARTED: LogRecord = {
  at:       STARTED_AT,
  kind:     'ticket-started',
  ticketId: '003',
  fields:   {},
};

const scratchDirectories: string[] = [];

afterAll(() => {
  for (const directory of scratchDirectories) removeScratchDirectory(directory);
});

function scratchLogFilePath(prefix: string): string {
  const directory = createScratchDirectory(prefix);
  scratchDirectories.push(directory);
  return join(directory, 'log.jsonl');
}

function readBack(prefix: string, text: string): { logFilePath: string; reading: LogFileReading } {
  const logFilePath = scratchLogFilePath(prefix);
  writeFileSync(logFilePath, text);
  return { logFilePath, reading: new LogFileIngestion(logFilePath).read() };
}

function reasonOf(reading: LogFileReading): string {
  return reading.verdict === 'unreadable' ? reading.reason : `a ${reading.verdict} log`;
}

test('a missing log.jsonl is absent, not unreadable', () => {
  expect(new LogFileIngestion(scratchLogFilePath('log-absent')).read()).toEqual({ verdict: 'absent' });
});

test('an empty file is a readable log with no records', () => {
  expect(readBack('log-empty', '').reading).toEqual({ verdict: 'readable', records: [] });
});

test('records come back in file order', () => {
  const { reading } = readBack('log-order', `${JSON.stringify(FILED)}\n${JSON.stringify(STARTED)}\n`);
  expect(reading).toEqual({ verdict: 'readable', records: [FILED, STARTED] });
});

test('blank and whitespace-only lines are skipped, and a last line without a newline still reads', () => {
  const { reading } = readBack('log-blank-lines', `\n${JSON.stringify(FILED)}\n   \n\t\n${JSON.stringify(STARTED)}`);
  expect(reading).toEqual({ verdict: 'readable', records: [FILED, STARTED] });
});

test('a malformed record makes the file unreadable, naming the file, its 1-based line and the field', () => {
  const malformed = JSON.stringify({ at: STARTED_AT, kind: 'note', fields: { text: 7 } });
  const { logFilePath, reading } = readBack('log-bad-field', `${JSON.stringify(FILED)}\n\n${malformed}\n`);
  expect(reading.verdict).toBe('unreadable');
  expect(reasonOf(reading)).toBe(`${logFilePath}, line 3: fields.text is not a string`);
});

test('a line that is not JSON makes the file unreadable and says so', () => {
  const { logFilePath, reading } = readBack('log-not-json', `${JSON.stringify(FILED)}\n{ this is not json\n`);
  expect(reasonOf(reading)).toStartWith(`${logFilePath}, line 2: it is not valid JSON (`);
});

test('a directory where the file should be is unreadable, never absent', () => {
  const logFilePath = scratchLogFilePath('log-directory');
  mkdirSync(logFilePath);
  const reading = new LogFileIngestion(logFilePath).read();
  expect(reading.verdict).toBe('unreadable');
  expect(reasonOf(reading)).toStartWith(`${logFilePath}: it could not be read (`);
});

test('a read leaves the file byte for byte, a hand-spaced line included', () => {
  const text = `${JSON.stringify(FILED, null, 1).replaceAll('\n', '')}\n\n`;
  const { logFilePath, reading } = readBack('log-read-only', text);
  expect(reading.verdict).toBe('readable');
  expect(readFileSync(logFilePath, 'utf8')).toBe(text);
});
