/**
 * The bytes of log.jsonl are a stored format other builds read: one `JSON.stringify` line per record in the logger's key order, each ending
 * in a newline, written whole through the atomic writer so no temporary file is left beside it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join }                      from 'node:path';
import { afterAll, expect, test }    from 'bun:test';

import type { LogRecord }                                 from '../../lib/tracker-model/@types/LogRecord.ts';
import { createScratchDirectory, removeScratchDirectory } from '../../testing/ScratchWorkspace.ts';
import { LogFileIngestion }                               from './LogFileIngestion.ts';
import { createLogFileWriter }                            from './LogFileWriter.ts';

const NOTE: LogRecord = { at: '2026-09-18T22:05:00+02:00', kind: 'note', fields: { text: 'Wave 1 landed.' } };

const TICKET_STARTED: LogRecord = {
  at:       '2026-09-18T21:30:54+02:00',
  kind:     'ticket-started',
  ticketId: '003',
  fields:   {},
};

const REVIEW_BAR_STARTED: LogRecord = {
  at:       '2026-09-18T22:00:00+02:00',
  kind:     'review-bar-started',
  taskId:   18,
  ticketId: '003',
  fields:   { name: 'Review 1 #003 — Rewrite the importer' },
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

test('each record is one line in the stored format, in the order given', () => {
  const logFilePath = scratchLogFilePath('log-writer-bytes');
  createLogFileWriter(logFilePath).write([TICKET_STARTED, REVIEW_BAR_STARTED, NOTE]);
  expect(readFileSync(logFilePath, 'utf8')).toBe(
    '{"at":"2026-09-18T21:30:54+02:00","kind":"ticket-started","ticketId":"003","fields":{}}\n'
    + '{"at":"2026-09-18T22:00:00+02:00","kind":"review-bar-started","taskId":18,"ticketId":"003","fields":{"name":"Review 1 #003 — Rewrite the importer"}}\n'
    + '{"at":"2026-09-18T22:05:00+02:00","kind":"note","fields":{"text":"Wave 1 landed."}}\n',
  );
});

test('an empty log writes an empty file', () => {
  const logFilePath = scratchLogFilePath('log-writer-empty');
  createLogFileWriter(logFilePath).write([]);
  expect(readFileSync(logFilePath, 'utf8')).toBe('');
});

test('a rewrite replaces the whole file and leaves no temporary file beside it', () => {
  const logFilePath = scratchLogFilePath('log-writer-atomic');
  const writer = createLogFileWriter(logFilePath);
  writer.write([TICKET_STARTED, NOTE]);
  writer.write([NOTE]);
  expect(readFileSync(logFilePath, 'utf8')).toBe(`${JSON.stringify(NOTE)}\n`);
  expect(readdirSync(join(logFilePath, '..'))).toEqual(['log.jsonl']);
});

test('what the writer stores, the ingestion reads back unchanged', () => {
  const logFilePath = scratchLogFilePath('log-writer-round-trip');
  createLogFileWriter(logFilePath).write([TICKET_STARTED, REVIEW_BAR_STARTED, NOTE]);
  expect(new LogFileIngestion(logFilePath).read()).toEqual({ verdict: 'readable', records: [TICKET_STARTED, REVIEW_BAR_STARTED, NOTE] });
});
