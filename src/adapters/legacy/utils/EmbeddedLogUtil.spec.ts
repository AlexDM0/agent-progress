/**
 * A version 1 file's own log: it has to be an array of `{ at, text }` entries, and the first malformed entry is named by its index and
 * field; each entry becomes a note, in order, stamps kept, in the key order log.jsonl stores a record in.
 */
import { expect, test } from 'bun:test';

import { EmbeddedLogUtil } from './EmbeddedLogUtil.ts';

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
