/**
 * What "done for longer than the window" means for a task and for a ticket. The cases that matter: an open item is never hidden however
 * old, a done item without a usable timestamp stays visible, and a ticket is judged by its last transition rather than by `finished`.
 */

import { describe, expect, test } from 'bun:test';
import type { Task }              from '../constants/Types.ts';
import type { PageTicket }        from './page/PageData.ts';
import {
  hiddenWorkNoteText,
  taskIsLongDone,
  ticketIsLongDone,
  workVisibilityFrom,
} from './page/WorkVisibility.ts';

const DAY_MILLISECONDS     = 86_400_000;
const NOW_EPOCH_MILLISECONDS = Date.parse('2026-09-19T12:00:00+02:00');

function exampleTask(changes: Partial<Task> = {}): Task {
  return {
    id:     1,
    name:   'Split the exporter into two passes',
    status: 'delivered',
    start:  '2026-09-17T09:00:00+02:00',
    end:    '2026-09-17T10:00:00+02:00',
    owner:  'Alex Example',
    note:   '',
    ticket: null,
    tokens: null,
    ...changes,
  };
}

function exampleTicket(changes: Partial<PageTicket> = {}): PageTicket {
  return {
    id:          '003',
    title:       'Split the exporter into two passes',
    type:        'change',
    status:      'delivered',
    filed:       '2026-09-16T09:00:00+02:00',
    updated:     '2026-09-17T10:00:00+02:00',
    started:     '2026-09-16T10:00:00+02:00',
    finished:    '2026-09-16T11:00:00+02:00',
    delivered:   null,
    abandonedAt: null,
    task:        1,
    extra:       [],
    filePath:    '.agent-progress/tickets/003-split-the-exporter.md',
    bodyHtml:    '',
    ...changes,
  };
}

describe('taskIsLongDone', () => {
  test('hides a delivered or abandoned task that ended more than a day ago', () => {
    for (const status of ['delivered', 'abandoned'] as const) {
      expect(taskIsLongDone(exampleTask({ status }), NOW_EPOCH_MILLISECONDS, DAY_MILLISECONDS)).toBe(true);
    }
  });

  // Done means merged: a `reviewed` row is awaiting merge and is still counted under that heading in the summary.
  test('keeps a reviewed task that ended more than a day ago, because it still awaits a merge', () => {
    expect(taskIsLongDone(exampleTask({ status: 'reviewed' }), NOW_EPOCH_MILLISECONDS, DAY_MILLISECONDS)).toBe(false);
  });

  // `finished` and `re-review` both mean awaiting a reviewer, so neither is done yet.
  test('never hides a task that is not done, however long ago it ended', () => {
    for (const status of ['pending', 'running', 'paused', 'finished', 're-review'] as const) {
      expect(taskIsLongDone(exampleTask({ status }), NOW_EPOCH_MILLISECONDS, DAY_MILLISECONDS)).toBe(false);
    }
  });

  test('keeps a task that ended within the last day', () => {
    const task = exampleTask({ end: '2026-09-19T08:00:00+02:00' });

    expect(taskIsLongDone(task, NOW_EPOCH_MILLISECONDS, DAY_MILLISECONDS)).toBe(false);
  });

  test('falls back to the start when a done task has no end, and keeps it when it has neither', () => {
    expect(taskIsLongDone(exampleTask({ end: null }), NOW_EPOCH_MILLISECONDS, DAY_MILLISECONDS)).toBe(true);
    expect(taskIsLongDone(exampleTask({ start: null, end: null }), NOW_EPOCH_MILLISECONDS, DAY_MILLISECONDS)).toBe(false);
  });
});

describe('ticketIsLongDone', () => {
  test('hides a delivered or abandoned ticket last moved more than a day ago', () => {
    for (const status of ['delivered', 'abandoned'] as const) {
      expect(ticketIsLongDone(exampleTicket({ status }), NOW_EPOCH_MILLISECONDS, DAY_MILLISECONDS)).toBe(true);
    }
  });

  // A `done` ticket's row is `reviewed`, awaiting merge, so the two are hidden or kept together.
  test('never hides an open, in-progress, in-review or done ticket', () => {
    for (const status of ['open', 'in-progress', 'in-review', 'done'] as const) {
      expect(ticketIsLongDone(exampleTicket({ status }), NOW_EPOCH_MILLISECONDS, DAY_MILLISECONDS)).toBe(false);
    }
  });

  // `finished` is stamped when review starts; a ticket reviewed for days and closed an hour ago is recent work.
  test('judges a ticket by its last transition, not by when it finished', () => {
    const ticket = exampleTicket({ updated: '2026-09-19T11:00:00+02:00' });

    expect(ticketIsLongDone(ticket, NOW_EPOCH_MILLISECONDS, DAY_MILLISECONDS)).toBe(false);
  });
});

describe('workVisibilityFrom', () => {
  test('reads only "all" as all, so a damaged stored value falls back to hiding old work', () => {
    expect(workVisibilityFrom('all')).toBe('all');
    expect(workVisibilityFrom('recent')).toBe('recent');
    expect(workVisibilityFrom(null)).toBe('recent');
    expect(workVisibilityFrom('constructor')).toBe('recent');
  });
});

describe('hiddenWorkNoteText', () => {
  test('names only the kinds that have hidden items, and says nothing when none are hidden', () => {
    expect(hiddenWorkNoteText(0, 0)).toBe('');
    expect(hiddenWorkNoteText(1, 0)).toBe('1 task hidden');
    expect(hiddenWorkNoteText(3, 2)).toBe('3 tasks · 2 tickets hidden');
  });
});
