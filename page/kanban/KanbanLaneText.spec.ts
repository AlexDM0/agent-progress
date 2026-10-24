/**
 * The words a Kanban card and lane head print: a working card's stamp ticks from the start its agent's row records, a waiting card's counts
 * how long it waited, each appears only where its source exists, the notes no longer repeat them, and the lane heads count independently.
 */

import { describe, expect, test }          from 'bun:test';
import type { Task }                       from '../../src/lib/tracker-model/@types/Task.ts';
import type { PageTicket }                 from '../../src/shared/@types/PagePayload.ts';
import type { KanbanCard }                 from '../@types/KanbanCard.ts';
import { pageBoardFixture }                from '../testing/PageBoardFixture.ts';
import { EXAMPLE_PAGE_LIMITS }             from '../testing/PageLimitsFixture.ts';
import type { NoteFormat }                 from './KanbanLaneText.ts';
import { laneSubCountsOf, subStateNoteOf } from './KanbanLaneText.ts';
import { workStampOf }                     from './KanbanLaneText.ts';
import { KanbanLaneUtil }                  from './utils/KanbanLaneUtil.ts';

const EXAMPLE_TODAY = '2026-09-25';
const EXAMPLE_NOW   = Date.parse('2026-09-25T13:36:00+02:00');

function at(clock: string, day = EXAMPLE_TODAY): string {
  return `${day}T${clock}:00+02:00`;
}

function exampleTicket(id: string, changes: Partial<PageTicket> = {}): PageTicket {
  return {
    id,
    title:       `Example ticket ${id}`,
    type:        'ticket',
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
  const [card] = KanbanLaneUtil.kanbanCardsFor(pageBoardFixture({ tasks, tickets: [ticket] }).tickets, new Map([[ticket.id, waitingOn]]));
  if (card === undefined) {
    throw new Error('no card was built');
  }
  return card;
}

function noteFormat(): NoteFormat {
  return {
    nowEpochMilliseconds: EXAMPLE_NOW,
    todayCalendarDate:    EXAMPLE_TODAY,
    slices:               EXAMPLE_PAGE_LIMITS,
  };
}

function stampTextOf(card: KanbanCard): string | null {
  return workStampOf(card, noteFormat())?.stamp.shortText ?? null;
}

describe('the work stamp', () => {
  test('counts a pause from the newest paused phase to now, its start in the hover', () => {
    const row = exampleRow(1, {
      status:  'paused',
      ticket:  '061',
      history: [{ status: 'paused', at: at('09:00') }, { status: 'in-progress', at: at('09:30') }, { status: 'paused', at: at('11:45') }],
    });

    expect(workStampOf(cardOf(exampleTicket('061', { status: 'in-progress' }), [row]), noteFormat())).toEqual({
      stamp:        { shortText: 'paused 1h 51m', fullText: 'paused since 2026-09-25 11:45' },
      elapsedStamp: null,
    });
  });

  test('leaves a paused row without history to its milestone', () => {
    const row = exampleRow(1, { status: 'paused', ticket: '061' });

    expect(stampTextOf(cardOf(exampleTicket('061', { status: 'in-progress' }), [row]))).toBeNull();
  });

  test.each([
    ['the newest finished phase', { history: [{ status: 'in-review', at: at('13:20') }] }, { finished: at('12:00') }, 'waiting 16m'],
    ['the ticket’s finished stamp', {}, { finished: at('13:00') }, 'waiting 36m'],
    ['the row’s end', { end: at('11:36') }, {}, 'waiting 2h'],
  ] as Array<[string, Partial<Task>, Partial<PageTicket>, string]>)('counts the wait for a reviewer from %s', (_source, rowChanges, ticketChanges, expected) => {
    const row = exampleRow(1, { status: 'in-review', ticket: '062', ...rowChanges });

    expect(stampTextOf(cardOf(exampleTicket('062', { status: 'pending', ...ticketChanges }), [row]))).toBe(expected);
  });

  test('ticks a build from its row’s start, naming the start for the page’s ticker', () => {
    const row = exampleRow(1, { status: 'in-progress', ticket: '060', start: at('11:00') });

    expect(workStampOf(cardOf(exampleTicket('060', { status: 'in-progress' }), [row]), noteFormat())).toEqual({
      stamp:        { shortText: 'building 2h 36m 00s', fullText: 'building 2h 36m 00s' },
      elapsedStamp: { label: 'building', startEpochMilliseconds: Date.parse(at('11:00')) },
    });
  });

  test('ticks a review from the running reviewer’s start', () => {
    const tasks = [exampleRow(1, { status: 'in-review', ticket: '058' }), exampleRow(2, { status: 'in-progress', reviewOf: '058', start: at('13:05') })];

    expect(stampTextOf(cardOf(exampleTicket('058', { status: 'in-review' }), tasks))).toBe('reviewing 31m 00s');
  });

  test('names the round of a repeat review and times the newest reviewer, finding a review row by its reviewOf', () => {
    const tasks = [
      exampleRow(1, { status: 're-review', ticket: '059', reviewRound: 3 }),
      exampleRow(2, {
        name:           'Review 1 #059 — Accent-blind search',
        status:         'delivered',
        start:          at('10:50'),
        end:            at('11:30'),
        reviewOf:       '059',
        reviewBarRound: 1,
      }),
      exampleRow(3, {
        name:           'Review 2 #059 — Accent-blind search',
        status:         'in-progress',
        start:          at('11:34', '2026-09-24'),
        reviewOf:       '059',
        reviewBarRound: 2,
      }),
    ];

    expect(stampTextOf(cardOf(exampleTicket('059', { status: 'in-review' }), tasks))).toBe('3rd round 26h 02m 00s');
  });

  test('falls back to the first repeat round when the row names none', () => {
    const tasks = [exampleRow(1, { status: 're-review', ticket: '059' }), exampleRow(2, { reviewOf: '059', status: 'in-progress', start: at('11:34') })];

    expect(stampTextOf(cardOf(exampleTicket('059', { status: 'in-review' }), tasks))).toBe('2nd round 2h 02m 00s');
  });

  test.each([[1, '1st'], [2, '2nd'], [3, '3rd'], [4, '4th'], [11, '11th'], [12, '12th'], [13, '13th'], [21, '21st'], [112, '112th']])(
    'calls round %p the %p round',
    (reviewRound, ordinal) => {
      const tasks = [exampleRow(1, { status: 're-review', ticket: '059', reviewRound }), exampleRow(2, { reviewOf: '059', status: 'in-progress', start: at('13:36') })];

      expect(stampTextOf(cardOf(exampleTicket('059', { status: 'in-review' }), tasks))).toBe(`${ordinal} round 0s`);
    },
  );

  test('says nothing of a card no agent works on or waits for', () => {
    expect(stampTextOf(cardOf(exampleTicket('063', { status: 'reviewed', finished: at('10:40') }), [exampleRow(1, { status: 'reviewed', ticket: '063' })]))).toBeNull();
  });

  // Between rounds the newest review has ended and no new one has started: no reviewer is running, so nothing ticks.
  test('leaves a reviewing card to its milestone when the newest review row has ended', () => {
    const tasks = [
      exampleRow(1, { status: 're-review', ticket: '059' }),
      exampleRow(2, { reviewOf: '059', status: 'in-progress', start: at('10:50') }),
      exampleRow(3, {
        reviewOf: '059',
        status:   'delivered',
        start:    at('11:00'),
        end:      at('11:30'),
      }),
    ];

    expect(stampTextOf(cardOf(exampleTicket('059', { status: 'in-review' }), tasks))).toBeNull();
  });
});

describe('the sub-state note', () => {
  test('leaves the cards an agent works on or waits for without a note, since their stamp says it', () => {
    const paused    = exampleRow(1, { status: 'paused', ticket: '061', history: [{ status: 'paused', at: at('11:45') }] });
    const awaiting  = exampleRow(2, { status: 'in-review', ticket: '062', end: at('11:36') });
    const reviewing = [exampleRow(3, { status: 're-review', ticket: '059' }), exampleRow(4, { reviewOf: '059', status: 'in-progress', start: at('11:34') })];

    expect(subStateNoteOf(cardOf(exampleTicket('061', { status: 'in-progress' }), [paused]), noteFormat())).toBeNull();
    expect(subStateNoteOf(cardOf(exampleTicket('062', { status: 'in-progress' }), [awaiting]), noteFormat())).toBeNull();
    expect(subStateNoteOf(cardOf(exampleTicket('059', { status: 'in-review' }), reviewing), noteFormat())).toBeNull();
  });

  test('says when an awaiting-merge card was reviewed, and nothing when the row does not know', () => {
    const reviewed   = exampleRow(1, { status: 'reviewed', ticket: '056', reviewed: at('12:10') });
    const unrecorded = exampleRow(2, { status: 'reviewed', ticket: '057' });

    expect(subStateNoteOf(cardOf(exampleTicket('056', { status: 'reviewed' }), [reviewed]), noteFormat())).toBe('reviewed 12:10');
    expect(subStateNoteOf(cardOf(exampleTicket('057', { status: 'reviewed' }), [unrecorded]), noteFormat())).toBeNull();
  });

  test('gives an abandoned card its reason, and no note without one', () => {
    expect(subStateNoteOf(cardOf(exampleTicket('046', { status: 'abandoned', reason: 'Superseded by #056' }), []), noteFormat())).toBe('Superseded by #056');
    expect(subStateNoteOf(cardOf(exampleTicket('047', { status: 'abandoned' }), []), noteFormat())).toBeNull();
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
    const tasks = [
      exampleRow(1, { status: 're-review', ticket: '059' }),
      exampleRow(2, { status: 'in-review', ticket: '058' }),
      exampleRow(3, { status: 'in-progress', reviewOf: '058' }),
    ];
    const cards = KanbanLaneUtil.kanbanCardsFor(
      pageBoardFixture({ tasks, tickets: [exampleTicket('059', { status: 'in-review' }), exampleTicket('058', { status: 'in-review' })] }).tickets,
      new Map(),
    );

    expect(laneSubCountsOf('review', cards).map((entry) => `${entry.dotState} ${entry.count} ${entry.label}`)).toEqual(['reviewing 2 reviewing']);
  });

  test('words each count of one state by that state’s label, lower-cased mid-sentence', () => {
    const tasks   = [exampleRow(1, { status: 'in-progress', ticket: '060' }), exampleRow(2, { status: 'paused', ticket: '061' })];
    const tickets = [exampleTicket('060', { status: 'in-progress' }), exampleTicket('061', { status: 'in-progress' })];
    const cards   = KanbanLaneUtil.kanbanCardsFor(pageBoardFixture({ tasks, tickets }).tickets, new Map());

    expect(laneSubCountsOf('progress', cards).map((entry) => `${entry.count} ${entry.label}`)).toEqual(['1 in progress', '1 paused']);
  });

  test('counts every reviewed Done card, before the cap', () => {
    const tickets = Array.from({ length: 20 }, (_unused, index) => exampleTicket(String(index + 1), { status: 'delivered', delivered: at('10:00') }));
    const tasks   = tickets.map((ticket, index) => exampleRow(index + 1, { status: 'delivered', ticket: ticket.id }));

    expect(laneSubCountsOf('done', KanbanLaneUtil.kanbanCardsFor(pageBoardFixture({ tasks, tickets }).tickets, new Map()))).toEqual([{
      count:        20,
      label:        'reviewed first',
      dotState:     null,
      reviewedMark: true,
    }]);
  });
});
