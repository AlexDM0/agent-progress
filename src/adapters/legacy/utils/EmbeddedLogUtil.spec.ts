/**
 * A version 1 file's own log: it has to be an array of `{ at, text }` entries, and the first malformed entry is named by its index and
 * field; each entry becomes a note, in order, stamps kept, in the key order log.jsonl stores a record in. The log must be moved to log.jsonl
 * on the next write, and a log.jsonl beside a version 1 file is believed only as a migration cut short, when it holds that log or its start;
 * one holding any record the log lacks is refused naming both files, so no log is dropped silently. With no log carried over it gives
 * no answer.
 */
import { describe, expect, test } from 'bun:test';

import type { LogRecord }      from '../../../lib/tracker-model/@types/LogRecord.ts';
import type { LogFileReading } from '../../log/@types/StoredLog.ts';
import { EmbeddedLogUtil }     from './EmbeddedLogUtil.ts';

const { storedLogBesideAnEmbeddedLog } = EmbeddedLogUtil;

const LOCATIONS = {
  logFilePath:      '/example/repository/.agent-progress/log.jsonl',
  progressFilePath: '/example/repository/.agent-progress/progress.json',
};

const CONFLICT_REASON = '/example/repository/.agent-progress/log.jsonl sits beside a version 1 /example/repository/.agent-progress/progress.json '
  + 'and holds records its log does not: remove log.jsonl to keep the progress file\'s log, or restore the version 2 progress.json it belongs to';

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

test('a log that is not an array is named, and an array is not a problem', () => {
  for (const log of [undefined, 7, 'none', { at: 'x' }, null]) expect(EmbeddedLogUtil.logArrayProblemOf(log), JSON.stringify(log)).toBe('log is not an array');
  expect(EmbeddedLogUtil.logArrayProblemOf([])).toBeNull();
});

test('the first malformed entry is named by its index and the field it lacks', () => {
  expect(EmbeddedLogUtil.logEntriesProblemOf([{ at: '2026-09-18T20:40:00+02:00', text: 'Example note' }])).toBeNull();
  expect(EmbeddedLogUtil.logEntriesProblemOf([{ at: '2026-09-18T20:40:00+02:00', text: 'Example note' }, 'note'])).toBe('log[1] is not an object');
  expect(EmbeddedLogUtil.logEntriesProblemOf([{ text: 'Example note' }])).toBe('log[0].at is not a timestamp');
  expect(EmbeddedLogUtil.logEntriesProblemOf([{ at: '2026-09-18T20:40:00+02:00' }, null])).toBe('log[0].text is not a string');
});

test('each worded log entry becomes a note carrying its stamp and its sentence, in the log\'s order', () => {
  const entries = [
    { at: '2026-09-18T20:40:00+02:00', text: 'Ticket #001 started' },
    { at: '2026-09-18T20:11:03+02:00', text: 'Example note stamped earlier' },
  ];
  expect(EmbeddedLogUtil.notesOf(entries)).toEqual([
    { at: '2026-09-18T20:40:00+02:00', kind: 'note', fields: { text: 'Ticket #001 started' } },
    { at: '2026-09-18T20:11:03+02:00', kind: 'note', fields: { text: 'Example note stamped earlier' } },
  ]);
  expect(Object.keys(EmbeddedLogUtil.notesOf(entries)[0] ?? {}), 'the order log.jsonl stores a record in').toEqual(['at', 'kind', 'fields']);
});

test('with no log carried over there is no answer, and the current log.jsonl reading decides', () => {
  expect(storedLogBesideAnEmbeddedLog(null, { verdict: 'readable', records: [LATER_RECORD] }, LOCATIONS)).toBeNull();
  expect(storedLogBesideAnEmbeddedLog(null, { verdict: 'absent' }, LOCATIONS)).toBeNull();
  expect(storedLogBesideAnEmbeddedLog(null, UNREADABLE_LOG_FILE, LOCATIONS)).toBeNull();
});

describe('beside a version 1 progress.json', () => {
  test('with no log.jsonl, the log is the embedded notes, which must be written to log.jsonl', () => {
    expect(storedLogBesideAnEmbeddedLog(EMBEDDED_LOG, { verdict: 'absent' }, LOCATIONS))
      .toEqual({ verdict: 'readable', records: [FIRST_NOTE, SECOND_NOTE], logFileMustBeRewritten: true });
  });

  test('a log.jsonl holding records after the embedded notes is refused, naming both files', () => {
    expect(storedLogBesideAnEmbeddedLog(EMBEDDED_LOG, { verdict: 'readable', records: [FIRST_NOTE, SECOND_NOTE, LATER_RECORD] }, LOCATIONS))
      .toEqual({ verdict: 'unreadable', reason: CONFLICT_REASON });
  });

  test('a log.jsonl holding exactly the embedded notes is a migration cut short too', () => {
    expect(storedLogBesideAnEmbeddedLog(EMBEDDED_LOG, { verdict: 'readable', records: [FIRST_NOTE, SECOND_NOTE] }, LOCATIONS))
      .toEqual({ verdict: 'readable', records: [FIRST_NOTE, SECOND_NOTE], logFileMustBeRewritten: true });
  });

  test('beside an empty version 1 log, a log.jsonl holding any record is refused', () => {
    expect(storedLogBesideAnEmbeddedLog([], { verdict: 'readable', records: [LATER_RECORD] }, LOCATIONS)).toEqual({ verdict: 'unreadable', reason: CONFLICT_REASON });
  });

  test('an empty log.jsonl beside a version 1 file is a migration cut short', () => {
    expect(storedLogBesideAnEmbeddedLog(EMBEDDED_LOG, { verdict: 'readable', records: [] }, LOCATIONS))
      .toEqual({ verdict: 'readable', records: [FIRST_NOTE, SECOND_NOTE], logFileMustBeRewritten: true });
  });

  test('a log.jsonl that does not begin with the embedded notes is refused, naming both files', () => {
    expect(storedLogBesideAnEmbeddedLog(EMBEDDED_LOG, { verdict: 'readable', records: [SECOND_NOTE, FIRST_NOTE] }, LOCATIONS))
      .toEqual({ verdict: 'unreadable', reason: CONFLICT_REASON });
  });

  test('a log.jsonl holding the start of the embedded notes is a migration cut short an older CLI appended to', () => {
    expect(storedLogBesideAnEmbeddedLog(EMBEDDED_LOG, { verdict: 'readable', records: [FIRST_NOTE] }, LOCATIONS))
      .toEqual({ verdict: 'readable', records: [FIRST_NOTE, SECOND_NOTE], logFileMustBeRewritten: true });
  });

  test('a note with the same text at another time is not the embedded log\'s start', () => {
    const restamped: LogRecord = { ...SECOND_NOTE, at: '2026-09-18T20:41:00+02:00' };
    expect(storedLogBesideAnEmbeddedLog(EMBEDDED_LOG, { verdict: 'readable', records: [FIRST_NOTE, restamped] }, LOCATIONS)?.verdict).toBe('unreadable');
  });

  test('a record of another kind in a note\'s place is not the embedded log\'s start', () => {
    expect(storedLogBesideAnEmbeddedLog(EMBEDDED_LOG, { verdict: 'readable', records: [LATER_RECORD] }, LOCATIONS)?.verdict).toBe('unreadable');
  });

  test('an unreadable log.jsonl is refused with the same reason, naming both files', () => {
    expect(storedLogBesideAnEmbeddedLog(EMBEDDED_LOG, UNREADABLE_LOG_FILE, LOCATIONS)).toEqual({ verdict: 'unreadable', reason: CONFLICT_REASON });
  });
});
