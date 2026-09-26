/**
 * The log's seam to a log carried over from an older progress file, seen from the current side: with no carried-over log, any log.jsonl,
 * even one a carried-over log would refuse, comes back as its own records, an absent one as empty and an unreadable one with its own reason,
 * and nothing is ever marked for rewriting. It imports nothing from `src/adapters/legacy/`, so it still holds once that folder and its seam
 * line are dropped.
 */
import { expect, test } from 'bun:test';

import type { LogRecord }      from '../../../lib/tracker-model/@types/LogRecord.ts';
import type { LogFileReading } from '../LogFileIngestion.ts';
import { TrackerLogUtil }      from './TrackerLogUtil.ts';

const LOCATIONS = {
  logFilePath:      '/example/repository/.agent-progress/log.jsonl',
  progressFilePath: '/example/repository/.agent-progress/progress.json',
};

const NOTE: LogRecord = { at: '2026-09-18T20:30:00+02:00', kind: 'note', fields: { text: 'Example note naming #001' } };

const FINISHED_RECORD: LogRecord = {
  at:       '2026-09-18T21:00:00+02:00',
  kind:     'ticket-finished',
  ticketId: '001',
  fields:   {},
};

test('a readable log.jsonl comes back as its records, whatever they hold, and is never marked for rewriting', () => {
  for (const records of [[], [NOTE], [FINISHED_RECORD], [FINISHED_RECORD, NOTE], [NOTE, NOTE, FINISHED_RECORD]]) {
    expect(TrackerLogUtil.storedLogOf(null, { verdict: 'readable', records }, LOCATIONS), JSON.stringify(records))
      .toEqual({ verdict: 'readable', records, logFileMustBeRewritten: false });
  }
});

test('an absent log.jsonl is an empty log, never marked for rewriting', () => {
  expect(TrackerLogUtil.storedLogOf(null, { verdict: 'absent' }, LOCATIONS)).toEqual({ verdict: 'readable', records: [], logFileMustBeRewritten: false });
});

test('an unreadable log.jsonl keeps its own reason, which names no progress file', () => {
  const unreadableLogFile: LogFileReading = { verdict: 'unreadable', reason: `${LOCATIONS.logFilePath}, line 1: it is not valid JSON` };
  expect(TrackerLogUtil.storedLogOf(null, unreadableLogFile, LOCATIONS)).toEqual(unreadableLogFile);
});
