/**
 * The collector decides what log.jsonl holds after a command: the stored log followed by the new records in the order the Board logged
 * them; after a clearing, the clearing alone; a log carried over from an older progress file, which must reach log.jsonl even when nothing
 * new was logged; and nothing at all when there is nothing to write, so a command that logs nothing leaves the file alone.
 */
import { expect, test } from 'bun:test';

import type { LogRecord }           from '../../lib/tracker-model/@types/LogRecord.ts';
import { createLogger }             from '../../lib/tracker-model/Logger.ts';
import type { StoredLog }           from './@types/StoredLog.ts';
import { createLogRecordCollector } from './LogRecordCollector.ts';

const FILED_AT   = '2026-09-18T20:30:00+02:00';
const STARTED_AT = '2026-09-18T20:40:00+02:00';
const CLEARED_AT = '2026-09-18T21:00:00+02:00';

const STORED_NOTE: LogRecord = { at: '2026-09-18T20:00:00+02:00', kind: 'note', fields: { text: 'An entry from before this command' } };

function storedLogOf(records: LogRecord[], logFileMustBeRewritten: boolean): StoredLog {
  return { records, logFileMustBeRewritten };
}

test('records follow the stored log in the order the Board logged them', () => {
  const collector = createLogRecordCollector(storedLogOf([STORED_NOTE], false));
  const { log }   = createLogger(collector.collect);
  const filed     = log({ kind: 'ticket-filed', ticketId: '003', fields: { title: 'Double-click a role to edit it' } }, FILED_AT);
  const started   = log({ kind: 'ticket-started', ticketId: '003', fields: {} }, STARTED_AT);
  expect(collector.recordsToWrite()).toEqual([STORED_NOTE, filed, started]);
});

test('a cleared tracker restarts the log with the clearing alone', () => {
  const collector = createLogRecordCollector(storedLogOf([STORED_NOTE], true));
  const { log }   = createLogger(collector.collect);
  log({ kind: 'note', fields: { text: 'Example note from the orchestrator' } }, STARTED_AT);
  const cleared = log({ kind: 'tracker-cleared', fields: {} }, CLEARED_AT);
  expect(collector.recordsToWrite()).toEqual([cleared]);
});

test('records logged after a clearing follow it', () => {
  const collector = createLogRecordCollector(storedLogOf([STORED_NOTE], false));
  const { log }   = createLogger(collector.collect);
  const cleared   = log({ kind: 'tracker-cleared', fields: {} }, CLEARED_AT);
  const note      = log({ kind: 'note', fields: { text: 'Example note after the clearing' } }, CLEARED_AT);
  expect(collector.recordsToWrite()).toEqual([cleared, note]);
});

test('a log that must be rewritten is returned whole even when nothing new was logged', () => {
  const collector = createLogRecordCollector(storedLogOf([STORED_NOTE], true));
  expect(collector.recordsToWrite()).toEqual([STORED_NOTE]);
});

test('a command that logs nothing has nothing to write', () => {
  expect(createLogRecordCollector(storedLogOf([STORED_NOTE], false)).recordsToWrite()).toBeNull();
  expect(createLogRecordCollector(storedLogOf([], false)).recordsToWrite()).toBeNull();
});
