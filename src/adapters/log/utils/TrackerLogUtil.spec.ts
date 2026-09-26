/**
 * Which log a tracker has, row by row of the design's table: a version 2 progress.json leaves the log to log.jsonl; a version 1 one owns
 * its log, which must be moved to log.jsonl on the next write; and a log.jsonl beside a version 1 file is believed only as a migration cut
 * short, when it begins with that log. Every other pairing is refused naming both files, so no log is dropped silently.
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

const CONFLICT_REASON = '/example/repository/.agent-progress/log.jsonl sits beside a version 1 /example/repository/.agent-progress/progress.json '
  + 'and does not continue its log: remove log.jsonl to keep the progress file\'s log, or restore the version 2 progress.json it belongs to';

const FIRST_NOTE: LogRecord  = { at: '2026-09-18T20:30:00+02:00', kind: 'note', fields: { text: 'Ticket #001 filed: Example checkout flow' } };
const SECOND_NOTE: LogRecord = { at: '2026-09-18T20:40:00+02:00', kind: 'note', fields: { text: 'Ticket #001 started' } };
const EMBEDDED_LOG           = [FIRST_NOTE, SECOND_NOTE] as const;

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

describe('beside a version 1 progress.json', () => {
  test('with no log.jsonl, the log is the embedded notes, which must be written to log.jsonl', () => {
    expect(storedLogOf(EMBEDDED_LOG, { verdict: 'absent' }, LOCATIONS))
      .toEqual({ verdict: 'readable', records: [FIRST_NOTE, SECOND_NOTE], logFileMustBeRewritten: true });
  });

  test('a log.jsonl that begins with the embedded notes is a migration cut short: the lines after them are dropped by the rewrite', () => {
    expect(storedLogOf(EMBEDDED_LOG, { verdict: 'readable', records: [FIRST_NOTE, SECOND_NOTE, LATER_RECORD] }, LOCATIONS))
      .toEqual({ verdict: 'readable', records: [FIRST_NOTE, SECOND_NOTE], logFileMustBeRewritten: true });
  });

  test('a log.jsonl holding exactly the embedded notes is a migration cut short too', () => {
    expect(storedLogOf(EMBEDDED_LOG, { verdict: 'readable', records: [FIRST_NOTE, SECOND_NOTE] }, LOCATIONS))
      .toEqual({ verdict: 'readable', records: [FIRST_NOTE, SECOND_NOTE], logFileMustBeRewritten: true });
  });

  test('an empty version 1 log is continued by any readable log.jsonl', () => {
    expect(storedLogOf([], { verdict: 'readable', records: [LATER_RECORD] }, LOCATIONS))
      .toEqual({ verdict: 'readable', records: [], logFileMustBeRewritten: true });
  });

  test('a log.jsonl that does not begin with the embedded notes is refused, naming both files', () => {
    expect(storedLogOf(EMBEDDED_LOG, { verdict: 'readable', records: [SECOND_NOTE, FIRST_NOTE] }, LOCATIONS))
      .toEqual({ verdict: 'unreadable', reason: CONFLICT_REASON });
  });

  test('a log.jsonl shorter than the embedded log is refused', () => {
    expect(storedLogOf(EMBEDDED_LOG, { verdict: 'readable', records: [FIRST_NOTE] }, LOCATIONS)).toEqual({ verdict: 'unreadable', reason: CONFLICT_REASON });
  });

  test('a note with the same text at another time does not continue the log', () => {
    const restamped: LogRecord = { ...SECOND_NOTE, at: '2026-09-18T20:41:00+02:00' };
    expect(storedLogOf(EMBEDDED_LOG, { verdict: 'readable', records: [FIRST_NOTE, restamped] }, LOCATIONS).verdict).toBe('unreadable');
  });

  test('a record of another kind in a note\'s place does not continue the log', () => {
    expect(storedLogOf(EMBEDDED_LOG, { verdict: 'readable', records: [FIRST_NOTE, LATER_RECORD] }, LOCATIONS).verdict).toBe('unreadable');
  });

  test('an unreadable log.jsonl is refused with the same reason, naming both files', () => {
    expect(storedLogOf(EMBEDDED_LOG, UNREADABLE_LOG_FILE, LOCATIONS)).toEqual({ verdict: 'unreadable', reason: CONFLICT_REASON });
  });
});
