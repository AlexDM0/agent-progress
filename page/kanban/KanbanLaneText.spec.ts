/**
 * The words a Kanban card and lane head print: each sub-state note appears only where its source exists, and the lane heads count
 * independently.
 */

import { describe, expect, test }          from 'bun:test';
import type { Task }                       from '../../src/lib/tracker-model/@types/Task.ts';
import type { PageTicket }                 from '../../src/shared/@types/PagePayload.ts';
import type { KanbanCard }                 from '../@types/KanbanCard.ts';
import type { NoteFormat }                 from './KanbanLaneText.ts';
import { laneSubCountsOf, subStateNoteOf } from './KanbanLaneText.ts';
import { kanbanCardsFor }                  from './KanbanLanes.ts';

const EXAMPLE_TODAY = '2026-09-25';
const EXAMPLE_NOW   = Date.parse('2026-09-25T13:36:00+02:00');

const EXAMPLE_SLICES = {
  dateAndClockLength:    16,
  calendarDateLength:    10,
  monthAndDaySliceStart: 5,
  clockSliceStart:       11,
  clockSliceEnd:         16,
};

function at(clock: string, day = EXAMPLE_TODAY): string {
  return `${day}T${clock}:00+02:00`;
}

function exampleTicket(id: string, changes: Partial<PageTicket> = {}): PageTicket {
  return {
    id,
    title:       `Example ticket ${id}`,
    type:        'feature',
    status:      'pending',
    filed:       at('08:00'),
    updated:     at('08:00'),
    started:     null,
    finished:    null,
    delivered:   null,
    abandonedAt: null,
    task:        null,
    extra:       [],
    filePath:    `/example/.agent-progress/tickets/${id}.md`,
    bodyHtml:    '',
    ...changes,
  };
}

function exampleRow(id: number, changes: Partial<Task> = {}): Task {
  return {
    id,
    name:   `Example row ${id}`,
    status: 'pending',
    start:  null,
    end:    null,
    owner:  'Alex Example',
    note:   '',
    ticket: null,
    tokens: null,
    ...changes,
  };
}

function cardOf(ticket: PageTicket, tasks: readonly Task[], waitingOn: readonly string[] = []): KanbanCard {
  const [card] = kanbanCardsFor([ticket], tasks, new Map([[ticket.id, waitingOn]]));
  if (card === undefined) {
    throw new Error('no card was built');
  }
  return card;
}

function noteFormat(tasks: readonly Task[]): NoteFormat {
  return {
    tasks,
    nowEpochMilliseconds: EXAMPLE_NOW,
    todayCalendarDate:    EXAMPLE_TODAY,
    slices:               EXAMPLE_SLICES,
  };
}

describe('the sub-state note', () => {
  test('dates a pause from the newest paused phase and counts to now', () => {
    const row = exampleRow(1, {
      status:  'paused',
      ticket:  '061',
      history: [{ status: 'paused', at: at('09:00') }, { status: 'in-progress', at: at('09:30') }, { status: 'paused', at: at('11:45') }],
    });

    expect(subStateNoteOf(cardOf(exampleTicket('061', { status: 'in-progress' }), [row]), noteFormat([row]))).toBe('paused since 11:45 · 1h 51m');
  });

  test('leaves a paused row without history with no note', () => {
    const row = exampleRow(1, { status: 'paused', ticket: '061' });

    expect(subStateNoteOf(cardOf(exampleTicket('061', { status: 'in-progress' }), [row]), noteFormat([row]))).toBeNull();
  });

  test.each([
    ['the newest finished phase', { history: [{ status: 'in-review', at: at('13:20') }] }, { finished: at('12:00') }, 'no reviewer yet · 16m'],
    ['the ticket’s finished stamp', {}, { finished: at('13:00') }, 'no reviewer yet · 36m'],
    ['the row’s end', { end: at('11:36') }, {}, 'no reviewer yet · 2h'],
  ] as Array<[string, Partial<Task>, Partial<PageTicket>, string]>)('counts the wait for a reviewer from %s', (_source, rowChanges, ticketChanges, expected) => {
    const row = exampleRow(1, { status: 'in-review', ticket: '062', ...rowChanges });

    expect(subStateNoteOf(cardOf(exampleTicket('062', { status: 'pending', ...ticketChanges }), [row]), noteFormat([row]))).toBe(expected);
  });

  test('names the running reviewer’s start on a reviewing card', () => {
    const tasks = [exampleRow(1, { status: 'in-review', ticket: '058' }), exampleRow(2, { status: 'in-progress', reviewOf: '058', start: at('13:05') })];

    expect(subStateNoteOf(cardOf(exampleTicket('058', { status: 'in-review' }), tasks), noteFormat(tasks))).toBe('reviewer since 13:05');
  });

  test('names the round and the newest reviewer on a repeat review, finding a review row by its name', () => {
    const tasks = [
      exampleRow(1, { status: 're-review', ticket: '059', reviewRound: 3 }),
      exampleRow(2, {
        name: 'Review 1 #059 — Accent-blind search', status: 'delivered', start: at('10:50'), end: at('11:30') 
      }),
      exampleRow(3, { name: 'Review 2 #059 — Accent-blind search', status: 'in-progress', start: at('11:34', '2026-09-24') }),
    ];

    expect(subStateNoteOf(cardOf(exampleTicket('059', { status: 'in-review' }), tasks), noteFormat(tasks))).toBe('round 3 reviewer since 09-24 11:34');
  });

  test('falls back to the first repeat round when the row names none', () => {
    const tasks = [exampleRow(1, { status: 're-review', ticket: '059' }), exampleRow(2, { reviewOf: '059', status: 'in-progress', start: at('11:34') })];

    expect(subStateNoteOf(cardOf(exampleTicket('059', { status: 'in-review' }), tasks), noteFormat(tasks))).toBe('round 2 reviewer since 11:34');
  });

  // Between rounds the newest review has ended and no new one has started: no reviewer is running, so none is named.
  test('leaves a reviewing card with no note when the newest review row has ended', () => {
    const tasks = [
      exampleRow(1, { status: 're-review', ticket: '059' }),
      exampleRow(2, { reviewOf: '059', status: 'in-progress', start: at('10:50') }),
      exampleRow(3, {
        reviewOf: '059', status: 'delivered', start: at('11:00'), end: at('11:30') 
      }),
    ];

    expect(subStateNoteOf(cardOf(exampleTicket('059', { status: 'in-review' }), tasks), noteFormat(tasks))).toBeNull();
  });

  test('says when an awaiting-merge card was reviewed, and nothing when the row does not know', () => {
    const reviewed   = exampleRow(1, { status: 'reviewed', ticket: '056', reviewed: at('12:10') });
    const unrecorded = exampleRow(2, { status: 'reviewed', ticket: '057' });

    expect(subStateNoteOf(cardOf(exampleTicket('056', { status: 'reviewed' }), [reviewed]), noteFormat([reviewed]))).toBe('reviewed 12:10');
    expect(subStateNoteOf(cardOf(exampleTicket('057', { status: 'reviewed' }), [unrecorded]), noteFormat([unrecorded]))).toBeNull();
  });

  test('gives an abandoned card its reason, and no note without one', () => {
    expect(subStateNoteOf(cardOf(exampleTicket('046', { status: 'abandoned', reason: 'Superseded by #056' }), []), noteFormat([]))).toBe('Superseded by #056');
    expect(subStateNoteOf(cardOf(exampleTicket('047', { status: 'abandoned' }), []), noteFormat([]))).toBeNull();
  });
});

describe('the lane heads', () => {
  test('counts To do’s waiting, held and rowless tickets independently, so a held ticket without a row counts twice', () => {
    const cards = [
      cardOf(exampleTicket('065'), [exampleRow(1, { ticket: '065' })], ['060']),
      cardOf(exampleTicket('068', { priority: 'low', hold: 'Waiting for copy' }), []),
      cardOf(exampleTicket('069', { priority: 'low' }), []),
    ];

    expect(laneSubCountsOf('todo', cards).map((entry) => `${entry.count} ${entry.label}`)).toEqual(['1 waiting', '1 held', '2 no row']);
  });

  test('leaves a zero count out and counts a repeat review as reviewing', () => {
    const tasks = [exampleRow(1, { status: 're-review', ticket: '059' }), exampleRow(2, { status: 'in-review', ticket: '058' })];
    const cards = kanbanCardsFor([exampleTicket('059', { status: 'in-review' }), exampleTicket('058', { status: 'in-review' })], tasks, new Map());

    expect(laneSubCountsOf('review', cards).map((entry) => `${entry.dotState} ${entry.count} ${entry.label}`)).toEqual(['reviewing 2 reviewing']);
  });

  test('counts every reviewed Done card, before the cap', () => {
    const tickets = Array.from({ length: 20 }, (_unused, index) => exampleTicket(String(index + 1), { status: 'delivered', delivered: at('10:00') }));
    const tasks   = tickets.map((ticket, index) => exampleRow(index + 1, { status: 'delivered', ticket: ticket.id }));

    expect(laneSubCountsOf('done', kanbanCardsFor(tickets, tasks, new Map()))).toEqual([{
      count:        20,
      label:        'reviewed first',
      dotState:     null,
      reviewedMark: true,
    }]);
  });
});
