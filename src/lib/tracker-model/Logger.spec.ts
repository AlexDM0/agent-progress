/**
 * What the Board and the sinks rely on: each `log` call hands the sink exactly one record, the content it was given stamped with `at`
 * first, so the stored line opens with its stamp, in call order, and returns that same record, so a Board change can return what it logged.
 */
import { expect, test } from 'bun:test';

import type { LogRecord }            from './@types/LogRecord.ts';
import { createLogger, type Logger } from './Logger.ts';

const LOGGED_AT = '2026-09-26T10:15:00+02:00';

function recordingLogger(): { log: Logger['log']; records: LogRecord[] } {
  const records: LogRecord[] = [];
  const logger = createLogger((record) => records.push(record));
  return { log: logger.log, records };
}

test('a call hands the sink one record: the content it was given, stamped', () => {
  const { log, records } = recordingLogger();
  log({ kind: 'ticket-held', ticketId: '003', fields: { reason: 'waiting on Example Agency' } }, LOGGED_AT);
  expect(records).toEqual([{
    at:       LOGGED_AT,
    kind:     'ticket-held',
    ticketId: '003',
    fields:   { reason: 'waiting on Example Agency' },
  }]);
});

test('the stamp is the first key, ahead of the content in the order it was given', () => {
  const { log, records } = recordingLogger();
  log({
    kind:     'review-bar-started',
    taskId:   7,
    ticketId: '003',
    fields:   { name: 'Review 2 #003 — Example checkout page' },
  }, LOGGED_AT);
  expect(Object.keys(records[0] ?? {})).toEqual(['at', 'kind', 'taskId', 'ticketId', 'fields']);
});

// A Board change returns the records it logged; that is only true if what it got back is what the sink received.
test('a call returns the very record the sink received', () => {
  const { log, records } = recordingLogger();
  const returned = log({ kind: 'note', fields: { text: 'Example note' } }, LOGGED_AT);
  expect(returned).toBe(records[0] as LogRecord);
});

test('records reach the sink in call order, one per call', () => {
  const { log, records } = recordingLogger();
  log({ kind: 'ticket-started', ticketId: '003', fields: {} }, '2026-09-26T10:00:00+02:00');
  log({ kind: 'tracker-cleared', fields: {} }, '2026-09-26T10:05:00+02:00');
  log({ kind: 'note', fields: { text: 'Example note' } }, '2026-09-26T10:10:00+02:00');
  expect(records.map(({ kind, at }) => `${kind} ${at}`)).toEqual([
    'ticket-started 2026-09-26T10:00:00+02:00',
    'tracker-cleared 2026-09-26T10:05:00+02:00',
    'note 2026-09-26T10:10:00+02:00',
  ]);
});

test('nothing reaches the sink until a record is logged', () => {
  const { records } = recordingLogger();
  expect(records).toEqual([]);
});
