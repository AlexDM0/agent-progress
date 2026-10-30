/**
 * The Progress rows grouped by epic. The cases that matter: a board without epics is drawn ungrouped; a ticket's rows, its review rows
 * included, go under its primary epic only, and the head counts the epic's other tickets as shared; open epics come first and "No epic"
 * last; a group with no rows is left out; a folded group keeps its head and draws no rows; the span is placed on the axis with the bars'
 * minimum width and left out wholly outside the range; and toggling a head folds or unfolds it.
 */
import { describe, expect, test } from 'bun:test';

import { EXAMPLE_PAGE_LIMITS }                        from '../../testing/PageLimitsFixture.ts';
import { exampleProgressEpic, exampleProgressTicket } from '../../testing/ProgressBoardFixture.ts';
import {
  EpicRowGrouping,
  NO_EPIC_GROUP_KEY,
  type EpicGroupingAxis,
  type EpicGroupingSource
} from './EpicRowGrouping.ts';

const AXIS: EpicGroupingAxis = {
  fromEpochMilliseconds:   Date.parse('2026-09-18T09:00:00+02:00'),
  toEpochMilliseconds:     Date.parse('2026-09-18T13:00:00+02:00'),
  nowEpochMilliseconds:    Date.parse('2026-09-18T12:00:00+02:00'),
  minimumSpanWidthPercent: 2,
  todayCalendarDate:       '2026-09-18',
  slices:                  EXAMPLE_PAGE_LIMITS,
};

const CHECKOUT = exampleProgressEpic('checkout', {
  title: 'Checkout redesign', slot: 2, ticketIds: ['5', '6', '7'], ticketCountByStatus: { delivered: 1, pending: 2 }, span: { start: '2026-09-18T10:00:00+02:00', end: null },
});
const SETTLED = exampleProgressEpic('settled', {
  title: 'Settled work', slot: 1, ticketIds: ['8'], ticketCountByStatus: { delivered: 1 }, span: { start: '2026-09-18T09:00:00+02:00', end: '2026-09-18T10:00:00+02:00' },
});

const TICKETS = [
  exampleProgressTicket('5', { epics: ['checkout'] }),
  exampleProgressTicket('6', { epics: ['settled', 'checkout'] }),
  exampleProgressTicket('8', { epics: ['settled'] }),
];

function row(taskId: number, groupTicketId: string | null) {
  return { taskId, groupTicketId };
}

const ROWS = [row(1, '5'), row(2, '5'), row(3, '8'), row(4, null), row(5, '6')];

function sourceWith(changes: Partial<EpicGroupingSource> = {}): EpicGroupingSource {
  return {
    epics: [SETTLED, CHECKOUT], tickets: TICKETS, foldedGroupKeys: new Set(), axis: AXIS, ...changes
  };
}

describe('epicRowGroupsOf', () => {
  test('draws a board without epics ungrouped', () => {
    expect(EpicRowGrouping.epicRowGroupsOf(ROWS, sourceWith({ epics: undefined }))).toBeNull();
    expect(EpicRowGrouping.epicRowGroupsOf(ROWS, sourceWith({ epics: [] }))).toBeNull();
  });

  test('files each row, review rows included, under its ticket\'s primary epic, open epics first and No epic last', () => {
    const groups = EpicRowGrouping.epicRowGroupsOf(ROWS, sourceWith()) ?? [];

    expect(groups.map((group) => [group.head.key, group.rows.map((placed) => placed.taskId)])).toEqual([
      ['checkout', [1, 2]],
      ['settled', [3, 5]],
      [NO_EPIC_GROUP_KEY, [4]],
    ]);
    expect(groups[0]?.head).toMatchObject({
      label: 'Checkout redesign', slot: 2, doneText: '1 / 3 done', sharedMemberCount: 2, memberCount: 2
    });
    expect(groups[2]?.head).toMatchObject({
      label: 'No epic', slot: null, doneText: null, memberCount: 1
    });
  });

  test('leaves out a group with no rows', () => {
    const groups = EpicRowGrouping.epicRowGroupsOf([row(1, '5')], sourceWith()) ?? [];

    expect(groups.map((group) => group.head.key)).toEqual(['checkout']);
  });

  test('keeps a folded group\'s head and draws none of its rows', () => {
    const groups = EpicRowGrouping.epicRowGroupsOf(ROWS, sourceWith({ foldedGroupKeys: new Set(['checkout', NO_EPIC_GROUP_KEY]) })) ?? [];

    expect(groups.map((group) => [group.head.key, group.head.isFolded, group.rows.length])).toEqual([
      ['checkout', true, 0],
      ['settled', false, 2],
      [NO_EPIC_GROUP_KEY, true, 0],
    ]);
    expect(groups[0]?.head.memberCount).toBe(2);
  });

  test('places the span on the axis, open to now while the epic has open tickets', () => {
    const groups = EpicRowGrouping.epicRowGroupsOf(ROWS, sourceWith()) ?? [];

    expect(groups[0]?.head.span).toEqual({
      leftPercent: 25, widthPercent: 50, title: 'Checkout redesign · 10:00 → now', isOpen: true
    });
    expect(groups[1]?.head.span).toMatchObject({ leftPercent: 0, widthPercent: 25, isOpen: false });
  });

  test('gives a short span the minimum width and leaves out one wholly outside the range or never started', () => {
    const instant = exampleProgressEpic('instant', { ticketIds: ['5'], span: { start: '2026-09-18T13:00:00+02:00', end: '2026-09-18T13:00:00+02:00' } });
    const before = exampleProgressEpic('before', { ticketIds: ['5'], span: { start: '2026-09-17T09:00:00+02:00', end: '2026-09-17T10:00:00+02:00' } });
    const unstarted = exampleProgressEpic('unstarted', { ticketIds: ['5'] });
    const tickets = [exampleProgressTicket('5', { epics: ['instant'] }), exampleProgressTicket('6', { epics: ['before'] }), exampleProgressTicket('7', { epics: ['unstarted'] })];
    const groups = EpicRowGrouping.epicRowGroupsOf([row(1, '5'), row(2, '6'), row(3, '7')], sourceWith({ epics: [instant, before, unstarted], tickets })) ?? [];

    expect(groups.map((group) => group.head.span?.leftPercent ?? null)).toEqual([98, null, null]);
    expect(groups[0]?.head.span?.widthPercent).toBe(2);
  });
});

describe('foldedGroupKeysAfterToggle', () => {
  test('folds an unfolded head and unfolds a folded one', () => {
    expect(EpicRowGrouping.foldedGroupKeysAfterToggle(['settled'], 'checkout')).toEqual(['settled', 'checkout']);
    expect(EpicRowGrouping.foldedGroupKeysAfterToggle(['settled', 'checkout'], 'settled')).toEqual(['checkout']);
  });
});
