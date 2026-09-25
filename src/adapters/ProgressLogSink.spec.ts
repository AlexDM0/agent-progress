/**
 * Until the log has its own file, the progress file's `log` is what people read back, so the sink must append each record's sentence
 * in the order the Board logged it, and a cleared tracker must restart that same array (a reader holds it) with the clearing itself.
 */
import { expect, test } from 'bun:test';

import type { LogEntry }         from '../lib/tracker-model/@types/ProgressFile';
import { createLogger }          from '../lib/tracker-model/Logger';
import { createProgressLogSink } from './ProgressLogSink';

const FILED_AT   = '2026-09-18T20:30:00+02:00';
const STARTED_AT = '2026-09-18T20:40:00+02:00';
const CLEARED_AT = '2026-09-18T21:00:00+02:00';

test('log entries are appended in order, oldest first', () => {
  const log: LogEntry[] = [];
  const logger          = createLogger(createProgressLogSink(log));
  logger.ticketFiled('003', 'Double-click a role to edit it', FILED_AT);
  logger.ticketStarted('003', STARTED_AT);
  expect(log).toEqual([
    { at: FILED_AT, text: 'Ticket #003 filed: Double-click a role to edit it' },
    { at: STARTED_AT, text: 'Ticket #003 started' },
  ]);
});

test('a cleared tracker empties the same log array and leaves the clearing as its one entry', () => {
  const log: LogEntry[] = [{ at: FILED_AT, text: 'An entry from before the clearing' }];
  const logger          = createLogger(createProgressLogSink(log));
  logger.note('Example note from the orchestrator', STARTED_AT);
  logger.trackerCleared(CLEARED_AT);
  expect(log).toEqual([{ at: CLEARED_AT, text: 'Tracker cleared' }]);
});
