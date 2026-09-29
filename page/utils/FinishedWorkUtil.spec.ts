/**
 * The finished-work switch's rules. The cases that matter: on one constructed board with work finished 30 minutes, 5 hours, 10 hours,
 * 2 days and 5 days ago, every choice lets through exactly the finished items it reaches and never hides unfinished work; a picked day
 * starts at its local midnight; a ticket is dated by its closing stamp; stored and clicked values read back only as real choices; and
 * the reach marks keep their order on one scale.
 */

import { describe, expect, test }  from 'bun:test';
import type { Task }               from '../../src/lib/tracker-model/@types/Task.ts';
import type { PageTicket }         from '../../src/shared/@types/PagePayload.ts';
import type { FinishedWorkChoice } from '../@types/ViewerChoices.ts';
import { EXAMPLE_PAGE_LIMITS }     from '../testing/PageLimitsFixture.ts';
import { FinishedWorkUtil }        from './FinishedWorkUtil.ts';

const {
  choiceFrom,
  choiceIsCustom,
  cutoffEpochMillisecondsOf,
  finishedMomentIsShown,
  hiddenCountOf,
  labelOf,
  reachPercentOf,
  shownFinishedCountOf,
  sinceChoiceFor,
  taskFinishedEpochMillisecondsOf,
  ticketFinishedEpochMillisecondsOf,
  windowPhraseOf,
} = FinishedWorkUtil;

const MINUTE_MILLISECONDS    = 60_000;
const HOUR_MILLISECONDS      = 60 * MINUTE_MILLISECONDS;
const DAY_MILLISECONDS       = 24 * HOUR_MILLISECONDS;
const NOW_EPOCH_MILLISECONDS = new Date(2026, 8, 25, 13, 36).getTime();

function stampBefore(milliseconds: number): string {
  return new Date(NOW_EPOCH_MILLISECONDS - milliseconds).toISOString();
}

function exampleTask(id: number, changes: Partial<Task>): Task {
  return {
    id,
    name:   `Example task ${id}`,
    status: 'delivered',
    start:  stampBefore(10 * DAY_MILLISECONDS),
    end:    null,
    owner:  'Alex Example',
    note:   '',
    ticket: null,
    tokens: null,
    ...changes,
  };
}

function exampleTicket(id: string, changes: Partial<PageTicket>): PageTicket {
  return {
    id,
    title:       `Example ticket ${id}`,
    type:        'change',
    status:      'delivered',
    filed:       stampBefore(10 * DAY_MILLISECONDS),
    updated:     stampBefore(10 * DAY_MILLISECONDS),
    started:     null,
    finished:    null,
    delivered:   null,
    abandonedAt: null,
    task:        null,
    extra:       [],
    filePath:    `.agent-progress/tickets/${id}-example.md`,
    bodyHtml:    '',
    ...changes,
  };
}

/** Finished 30 minutes, 5 hours, 10 hours, 2 days and 5 days ago, then two rows still open, one of them started 9 days ago. */
const BOARD_TASKS: readonly Task[] = [
  exampleTask(1, { end: stampBefore(30 * MINUTE_MILLISECONDS) }),
  exampleTask(2, { end: stampBefore(5 * HOUR_MILLISECONDS), status: 'abandoned' }),
  exampleTask(3, { end: stampBefore(10 * HOUR_MILLISECONDS) }),
  exampleTask(4, { end: stampBefore(2 * DAY_MILLISECONDS) }),
  exampleTask(5, { end: stampBefore(5 * DAY_MILLISECONDS) }),
  exampleTask(6, { status: 'in-progress', start: stampBefore(9 * DAY_MILLISECONDS) }),
  exampleTask(7, { status: 'reviewed', end: stampBefore(9 * DAY_MILLISECONDS) }),
];

const BOARD_TICKETS: readonly PageTicket[] = [
  exampleTicket('001', { delivered: stampBefore(30 * MINUTE_MILLISECONDS) }),
  exampleTicket('002', { status: 'abandoned', abandonedAt: stampBefore(5 * HOUR_MILLISECONDS) }),
  exampleTicket('003', { delivered: stampBefore(10 * HOUR_MILLISECONDS) }),
  exampleTicket('004', { delivered: stampBefore(2 * DAY_MILLISECONDS) }),
  exampleTicket('005', { delivered: stampBefore(5 * DAY_MILLISECONDS) }),
  exampleTicket('006', { status: 'pending' }),
  exampleTicket('007', { status: 'in-review' }),
];

function shownTaskIds(choice: FinishedWorkChoice): number[] {
  const cutoff = cutoffEpochMillisecondsOf(choice, NOW_EPOCH_MILLISECONDS, EXAMPLE_PAGE_LIMITS);
  return BOARD_TASKS.filter((task) => finishedMomentIsShown(taskFinishedEpochMillisecondsOf(task), cutoff)).map((task) => task.id);
}

function shownTicketIds(choice: FinishedWorkChoice): string[] {
  const cutoff = cutoffEpochMillisecondsOf(choice, NOW_EPOCH_MILLISECONDS, EXAMPLE_PAGE_LIMITS);
  return BOARD_TICKETS.filter((ticket) => finishedMomentIsShown(ticketFinishedEpochMillisecondsOf(ticket), cutoff)).map((ticket) => ticket.id);
}

/** The local calendar day `daysBack` days before the board's now. */
function calendarDateBefore(daysBack: number): string {
  const day = new Date(NOW_EPOCH_MILLISECONDS - daysBack * DAY_MILLISECONDS);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
}

describe('each choice on the constructed board', () => {
  const EXPECTED_SHOWN: readonly (readonly [FinishedWorkChoice, number[], string[]])[] = [
    ['1h', [1, 6, 7], ['001', '006', '007']],
    ['6h', [1, 2, 6, 7], ['001', '002', '006', '007']],
    ['12h', [1, 2, 3, 6, 7], ['001', '002', '003', '006', '007']],
    ['1d', [1, 2, 3, 6, 7], ['001', '002', '003', '006', '007']],
    ['3d', [1, 2, 3, 4, 6, 7], ['001', '002', '003', '004', '006', '007']],
    ['all', [1, 2, 3, 4, 5, 6, 7], ['001', '002', '003', '004', '005', '006', '007']],
  ];

  for (const [choice, taskIds, ticketIds] of EXPECTED_SHOWN) {
    test(`${choice} shows exactly the finished work it reaches and every unfinished item`, () => {
      expect(shownTaskIds(choice)).toEqual(taskIds);
      expect(shownTicketIds(choice)).toEqual(ticketIds);
    });
  }

  test('a day picked 3 days back shows what finished since that local midnight: 2 days ago, not 5', () => {
    const choice = sinceChoiceFor(calendarDateBefore(3));
    expect(choice).not.toBeNull();
    expect(shownTaskIds(choice ?? 'all')).toEqual([1, 2, 3, 4, 6, 7]);
    expect(shownTicketIds(choice ?? 'all')).toEqual(['001', '002', '003', '004', '006', '007']);
  });

  test('a picked day starts at its local midnight', () => {
    const calendarDate = calendarDateBefore(1);
    const [year, month, day] = calendarDate.split('-').map(Number);
    expect(cutoffEpochMillisecondsOf(`since-${calendarDate}`, NOW_EPOCH_MILLISECONDS, EXAMPLE_PAGE_LIMITS))
      .toBe(new Date(year ?? 0, (month ?? 1) - 1, day ?? 1).getTime());
  });

  test('counts what a choice lets through and what it hides, never counting open work as either', () => {
    const moments = BOARD_TASKS.map((task) => taskFinishedEpochMillisecondsOf(task));
    const cutoff  = cutoffEpochMillisecondsOf('6h', NOW_EPOCH_MILLISECONDS, EXAMPLE_PAGE_LIMITS);
    expect(shownFinishedCountOf(moments, cutoff)).toBe(2);
    expect(hiddenCountOf(moments, cutoff)).toBe(3);
  });
});

describe('finished moments', () => {
  test('a settled row without an end finished when it started, and an open row has no finished moment', () => {
    expect(taskFinishedEpochMillisecondsOf(exampleTask(1, { start: stampBefore(HOUR_MILLISECONDS) }))).toBe(NOW_EPOCH_MILLISECONDS - HOUR_MILLISECONDS);
    expect(taskFinishedEpochMillisecondsOf(exampleTask(1, { status: 'reviewed', end: stampBefore(HOUR_MILLISECONDS) }))).toBeNull();
  });

  test('a ticket is dated by its closing stamp, and by its last transition when it has none', () => {
    expect(ticketFinishedEpochMillisecondsOf(exampleTicket('001', { delivered: stampBefore(HOUR_MILLISECONDS) }))).toBe(NOW_EPOCH_MILLISECONDS - HOUR_MILLISECONDS);
    expect(ticketFinishedEpochMillisecondsOf(exampleTicket('001', { updated: stampBefore(DAY_MILLISECONDS) }))).toBe(NOW_EPOCH_MILLISECONDS - DAY_MILLISECONDS);
  });

  test('finished work the page cannot date stays shown', () => {
    expect(finishedMomentIsShown(null, NOW_EPOCH_MILLISECONDS)).toBe(true);
  });
});

describe('choiceFrom', () => {
  test('reads every span and a real day, and nothing else', () => {
    expect(choiceFrom('1h')).toBe('1h');
    expect(choiceFrom('all')).toBe('all');
    expect(choiceFrom('since-2026-09-24')).toBe('since-2026-09-24');
    expect(choiceFrom('since-2026-02-30')).toBeNull();
    expect(choiceFrom('since-yesterday')).toBeNull();
    expect(choiceFrom('recent')).toBeNull();
    expect(choiceFrom('constructor')).toBeNull();
    expect(choiceFrom(42)).toBeNull();
  });

  test('only last hour and last day are not custom', () => {
    expect(choiceIsCustom('1h')).toBe(false);
    expect(choiceIsCustom('1d')).toBe(false);
    expect(choiceIsCustom('6h')).toBe(true);
    expect(choiceIsCustom('since-2026-09-24')).toBe(true);
  });
});

describe('the words', () => {
  test('a choice reads as its pill and as the end of "finished …"', () => {
    expect(labelOf('1h')).toBe('last hour');
    expect(labelOf('12h')).toBe('12 hours');
    expect(labelOf('since-2026-09-24')).toBe('since 09-24');
    expect(windowPhraseOf('1d')).toBe('in the last day');
    expect(windowPhraseOf('3d')).toBe('in the last 3 days');
    expect(windowPhraseOf('all')).toBe('ever');
    expect(windowPhraseOf('since-2026-09-24')).toBe('since 09-24');
  });
});

describe('reachPercentOf', () => {
  test('a longer span reaches further, all fills the track, and nothing passes the oldest finished work', () => {
    const oldest  = NOW_EPOCH_MILLISECONDS - 5 * DAY_MILLISECONDS;
    const reachOf = (choice: FinishedWorkChoice): number => {
      const cutoff = cutoffEpochMillisecondsOf(choice, NOW_EPOCH_MILLISECONDS, EXAMPLE_PAGE_LIMITS);
      return reachPercentOf(cutoff, oldest, NOW_EPOCH_MILLISECONDS);
    };
    expect(reachOf('1h')).toBeLessThan(reachOf('6h'));
    expect(reachOf('6h')).toBeLessThan(reachOf('1d'));
    expect(reachOf('1d')).toBeLessThan(reachOf('3d'));
    expect(reachOf('all')).toBe(100);
    expect(reachPercentOf(NOW_EPOCH_MILLISECONDS - 30 * DAY_MILLISECONDS, oldest, NOW_EPOCH_MILLISECONDS)).toBe(100);
  });
});
