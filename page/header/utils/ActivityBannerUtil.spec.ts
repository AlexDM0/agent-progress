/**
 * The activity banner's figures. The cases that matter: only an in-progress row with no end is an agent at work; a row reviews only by its
 * `reviewOf`, so a name reading "Review 2 #12" without it still builds; a review names the ticket it reviews; the title is the ticket's,
 * else the row's name without its leading "#123 "; the longest-running agent comes first; and the elapsed time keeps the design's three
 * shapes with zero-padded inner units.
 */

import { describe, expect, test } from 'bun:test';
import type { Task }              from '../../../src/lib/tracker-model/@types/Task.ts';
import { EXAMPLE_PAGE_LIMITS }    from '../../testing/PageLimitsFixture.ts';
import { ActivityBannerUtil }     from './ActivityBannerUtil.ts';

const {
  activityKindOf, bannerTitleOf, activityEntriesOf, formatElapsed, elapsedTextOf
} = ActivityBannerUtil;

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR   = 60 * MINUTE;

function exampleTask(changes: Partial<Task> = {}): Task {
  return {
    id:     1,
    name:   '#012 Split the exporter into two passes',
    status: 'in-progress',
    start:  '2026-09-19T09:00:00+02:00',
    end:    null,
    owner:  'Alex Example',
    note:   '',
    ticket: '012',
    tokens: null,
    ...changes,
  };
}

describe('activityKindOf', () => {
  test('a row with reviewOf is reviewing', () => {
    expect(activityKindOf(exampleTask({ reviewOf: '012' }))).toBe('reviewing');
  });

  test('a row named "Review 2 #12" without reviewOf is building', () => {
    expect(activityKindOf(exampleTask({ name: 'Review 2 #12', ticket: null }))).toBe('building');
  });
});

describe('bannerTitleOf', () => {
  const titles = new Map([['012', 'Example Agency export']]);

  test('prefers the ticket title', () => {
    expect(bannerTitleOf(exampleTask(), titles)).toBe('Example Agency export');
  });

  test('a review takes the title of the ticket it reviews', () => {
    expect(bannerTitleOf(exampleTask({ ticket: null, name: 'Review 1 #012', reviewOf: '012' }), titles)).toBe('Example Agency export');
  });

  test('falls back to the row name without its leading id', () => {
    expect(bannerTitleOf(exampleTask({ ticket: '099' }), titles)).toBe('Split the exporter into two passes');
    expect(bannerTitleOf(exampleTask({ ticket: null, name: 'Tidy the fixtures' }), titles)).toBe('Tidy the fixtures');
  });
});

describe('activityEntriesOf', () => {
  test('keeps only running rows, longest-running first, ties in id order and a missing start last', () => {
    const entries = activityEntriesOf([
      exampleTask({ id: 1, start: '2026-09-19T10:00:00+02:00' }),
      exampleTask({
        id: 2, start: '2026-09-19T08:00:00+02:00', reviewOf: '012', ticket: null
      }),
      exampleTask({ id: 3, start: null }),
      exampleTask({ id: 4, start: '2026-09-19T10:00:00+02:00' }),
      exampleTask({ id: 5, status: 'in-progress', end: '2026-09-19T11:00:00+02:00' }),
      exampleTask({ id: 6, status: 'paused' }),
      exampleTask({ id: 7, status: 'delivered', end: '2026-09-19T11:00:00+02:00' }),
    ], [{ id: '012', title: 'Example Agency export' }]);

    expect(entries.map((entry) => entry.taskId)).toEqual([2, 1, 4, 3]);
    expect(entries[0]).toEqual({
      taskId:                 2,
      kind:                   'reviewing',
      ticketId:               '012',
      title:                  'Example Agency export',
      startEpochMilliseconds: Date.parse('2026-09-19T08:00:00+02:00'),
    });
    expect(entries[3]?.startEpochMilliseconds).toBeNull();
  });
});

describe('formatElapsed', () => {
  test.each([
    [0, '0s'],
    [42 * SECOND, '42s'],
    [4 * MINUTE + 12 * SECOND, '4m 12s'],
    [51 * MINUTE + 3 * SECOND, '51m 03s'],
    [HOUR + 2 * MINUTE + 17 * SECOND, '1h 02m 17s'],
    [26 * HOUR + 5 * SECOND, '26h 00m 05s'],
    [999, '0s'],
    [-5 * SECOND, '0s'],
  ])('%p ms prints %p', (milliseconds, expected) => {
    expect(formatElapsed(milliseconds, EXAMPLE_PAGE_LIMITS)).toBe(expected);
  });
});

describe('elapsedTextOf', () => {
  test('measures from the start to the reference moment, and an entry without a start prints nothing', () => {
    expect(elapsedTextOf({ startEpochMilliseconds: 1_000_000 }, 1_000_000 + 42 * SECOND, EXAMPLE_PAGE_LIMITS)).toBe('42s');
    expect(elapsedTextOf({ startEpochMilliseconds: null }, 1_000_000, EXAMPLE_PAGE_LIMITS)).toBe('');
  });
});
