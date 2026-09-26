/**
 * Which log a tracker has: a version 2 progress.json leaves the log to log.jsonl, so a readable log.jsonl is the log, an absent one an empty
 * log and an unreadable one makes the log unreadable with its own reason; nothing needs rewriting.
 */
import { describe, expect, test } from 'bun:test';

import type { LogRecord }      from '../../../lib/tracker-model/@types/LogRecord.ts';
import type { LogFileReading } from '../LogFileIngestion.ts';
import { TrackerLogUtil }      from './TrackerLogUtil.ts';

const { storedLogOf } = TrackerLogUtil;

const LOCATIONS = {
  logFilePath:      '/example/repository/.agent-progress/log.jsonl',
  progressFilePath: '/example/repository/.agent-progress/progress.json',
};

const FIRST_NOTE: LogRecord = { at: '2026-09-18T20:30:00+02:00', kind: 'note', fields: { text: 'Ticket #001 filed: Example checkout flow' } };

const LATER_RECORD: LogRecord = {
  at:       '2026-09-18T21:00:00+02:00',
  kind:     'ticket-finished',
  ticketId: '001',
  fields:   {},
};

const UNREADABLE_LOG_FILE: LogFileReading = { verdict: 'unreadable', reason: `${LOCATIONS.logFilePath}, line 3: fields.text is not a string` };

describe('beside a version 2 progress.json', () => {
  test('a readable log.jsonl is the log, and nothing needs rewriting', () => {
    expect(storedLogOf(null, { verdict: 'readable', records: [FIRST_NOTE, LATER_RECORD] }, LOCATIONS))
      .toEqual({ verdict: 'readable', records: [FIRST_NOTE, LATER_RECORD], logFileMustBeRewritten: false });
  });

  test('an absent log.jsonl is an empty log', () => {
    expect(storedLogOf(null, { verdict: 'absent' }, LOCATIONS)).toEqual({ verdict: 'readable', records: [], logFileMustBeRewritten: false });
  });

  test('an unreadable log.jsonl makes the log unreadable with its own reason', () => {
    expect(storedLogOf(null, UNREADABLE_LOG_FILE, LOCATIONS)).toEqual(UNREADABLE_LOG_FILE);
  });
});
