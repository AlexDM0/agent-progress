/**
 * The Progress chart's model. The cases that matter: bars are placed by the geometry as percentages of the range, a range the rows run off
 * clips them, and Fit spans the rows to now; which rows are a ticket's review bars comes from the Board's row facts alone, so a row named
 * like a review but without the fact stays a row of its own; a ticket's review rows are ordered by the round their name gives, never by
 * filing; hidden review rows become segments on their ticket's row in their round's fill; and a waiting to-do row says so.
 */
import { describe, expect, test } from 'bun:test';

import { exampleProgressBoard, exampleProgressTask, exampleProgressTicket } from '../../testing/ProgressBoardFixture.ts';
import { ProgressModel, type ProgressChartChoices }                         from './ProgressModel.ts';

const NOW_EPOCH_MILLISECONDS = Date.parse('2026-09-18T13:00:00+02:00');

const CHOICES: ProgressChartChoices = {
  presetKey:            'fit',
  reviewRowsAreShown:   false,
  nowEpochMilliseconds: NOW_EPOCH_MILLISECONDS,
  todayCalendarDate:    '2026-09-18',
};

const ABSOLUTE_VIEW = {
  kind: 'absolute', from: '2026-09-18T09:00:00+02:00', to: '2026-09-18T13:00:00+02:00', tickMinutes: null
} as const;

const BUILD_ROW = exampleProgressTask(1, {
  name: '#5 Build the example', status: 'delivered', ticket: '5', start: '2026-09-18T09:00:00+02:00', end: '2026-09-18T11:00:00+02:00'
});

function reviewTask(id: number, name: string, start: string, end: string | null) {
  return exampleProgressTask(id, {
    name, status: end === null ? 'in-progress' : 'delivered', reviewOf: '5', start, end
  });
}

function reviewedBoard(firstName: string, secondName: string) {
  return exampleProgressBoard({
    view:  ABSOLUTE_VIEW,
    tasks: [
      BUILD_ROW,
      reviewTask(2, firstName, '2026-09-18T11:00:00+02:00', '2026-09-18T11:30:00+02:00'),
      reviewTask(3, secondName, '2026-09-18T11:40:00+02:00', null),
      reviewTask(4, 'Review 3 #5 — named like a review, but the Board names no ticket row', '2026-09-18T12:00:00+02:00', null),
    ],
    rowFacts:   { 1: { displayState: 'reviewing' }, 2: { reviewsTaskId: 1 }, 3: { reviewsTaskId: 1, displayState: 're-review' } },
    tickets:    [exampleProgressTicket('5', { status: 'in-review' })],
    ticketRows: { 5: { ownTaskId: 1, reviewTaskIds: [2, 3] } },
  });
}

describe('bar placement', () => {
  test('places a row’s bar as percentages of the range and its label from its ticket', () => {
    const chart = ProgressModel.progressChartOf(exampleProgressBoard({ view: ABSOLUTE_VIEW, tasks: [BUILD_ROW] }), CHOICES);
    const [row] = chart.rows;

    expect(row?.bars.map((bar) => [bar.leftPercent, bar.widthPercent, bar.isHidden])).toEqual([[0, 50, false]]);
    expect(row?.labelText).toBe('#5');
    expect(row?.linkedTicketId).toBe('5');
    expect(row?.nameText).toBe('Build the example');
    expect(chart.ticks.length).toBeGreaterThan(1);
    expect(chart.nowPercent).toBe(100);
  });

  test('clips a bar that runs off the range on the edge it runs off', () => {
    const view = {
      kind: 'absolute', from: '2026-09-18T10:00:00+02:00', to: '2026-09-18T13:00:00+02:00', tickMinutes: null
    } as const;
    const [row] = ProgressModel.progressChartOf(exampleProgressBoard({ view, tasks: [BUILD_ROW] }), CHOICES).rows;

    expect([row?.clippedLeft, row?.clippedRight]).toEqual([true, false]);
  });

  test('hides the bar of a task that never started', () => {
    const [row] = ProgressModel.progressChartOf(exampleProgressBoard({ tasks: [exampleProgressTask(1)] }), CHOICES).rows;

    expect(row?.bars.map((bar) => bar.isHidden)).toEqual([true]);
    expect(row?.labelText).toBe('TASK');
  });

  test('fits the range from the earliest start to now, with the margin on both ends', () => {
    const chart = ProgressModel.progressChartOf(exampleProgressBoard({ tasks: [BUILD_ROW] }), CHOICES);
    const [bar] = chart.rows[0]?.bars ?? [];

    expect(bar?.leftPercent).toBeGreaterThan(0);
    expect(chart.nowPercent).toBeLessThan(100);
    expect(chart.rangeNoteText).toContain('ticks');
  });

  test('a preset holds its own span, so a row older than it runs off its left edge where Fit shows it whole', () => {
    const board = exampleProgressBoard({ tasks: [BUILD_ROW] });

    expect(ProgressModel.progressChartOf(board, { ...CHOICES, presetKey: '1h' }).rows[0]?.clippedLeft).toBe(true);
    expect(ProgressModel.progressChartOf(board, CHOICES).rows[0]?.clippedLeft).toBe(false);
  });
});

describe('review bars, from the Board facts', () => {
  test('draws the review rows above their ticket’s row, latest round its name gives first, and a row without the fact at the top level', () => {
    const chart = ProgressModel.progressChartOf(reviewedBoard('Review 1 #5', 'Review 2 #5'), { ...CHOICES, reviewRowsAreShown: true });

    expect(chart.rows.map((row) => [row.taskId, row.nestedWithTicket])).toEqual([[4, null], [3, '5'], [2, '5'], [1, null]]);
  });

  test('orders a ticket’s review rows by the round their name gives, not by when they were filed', () => {
    const chart = ProgressModel.progressChartOf(reviewedBoard('Review 2 #5', 'Review 1 #5'), { ...CHOICES, reviewRowsAreShown: true });

    expect(chart.rows.map((row) => row.taskId)).toEqual([4, 2, 3, 1]);
  });

  test('draws hidden review rows as segments on their ticket’s row, each in its round’s fill and titled with its round', () => {
    const chart = ProgressModel.progressChartOf(reviewedBoard('Review 1 #5', 'Review 2 #5'), CHOICES);
    const ticketRow = chart.rows.find((row) => row.taskId === 1);

    expect(chart.rows.map((row) => row.taskId)).toEqual([4, 1]);
    expect(ticketRow?.stateToken).toBe('reviewing');
    expect(ticketRow?.bars.filter((bar) => bar.isReviewPass).map((bar) => [bar.stateToken, bar.isLive, bar.title?.split(' · ')[0]])).toEqual([
      ['reviewing', false, 'Review 1'],
      ['re-review', true, 'Review 2'],
    ]);
  });

  test('labels a review row by the ticket it reviews, without a link', () => {
    const chart = ProgressModel.progressChartOf(reviewedBoard('Review 1 #5', 'Review 2 #5'), { ...CHOICES, reviewRowsAreShown: true });
    const reviewRow = chart.rows.find((row) => row.taskId === 2);

    expect([reviewRow?.labelText, reviewRow?.linkedTicketId]).toEqual(['#5', null]);
  });
});

describe('the state chip', () => {
  test('reads Waiting on a to-do row with unmet dependencies and names them in the title', () => {
    const board = exampleProgressBoard({
      tasks:      [exampleProgressTask(1, { ticket: '6', name: 'Example dependent work' })],
      tickets:    [exampleProgressTicket('6')],
      ticketRows: { 6: { ownTaskId: 1 } },
      waitingOn:  { 6: ['5'] },
    });
    const [row] = ProgressModel.progressChartOf(board, CHOICES).rows;

    expect(row?.chipText).toBe('Waiting');
    expect(row?.chipTitle).toBe('To do');
    expect(row?.nameTitle).toBe('Example dependent work\nticket\nWaiting on #5');
  });

  test('reads Done ✓ on a delivered row the Board counts as reviewed', () => {
    const board = exampleProgressBoard({
      tasks:    [exampleProgressTask(1, { status: 'delivered', reviewed: '2026-09-18T10:30:00+02:00' })],
      rowFacts: { 1: { deliveredRowCountsAsReviewed: true } },
    });
    const [row] = ProgressModel.progressChartOf(board, CHOICES).rows;

    expect(row?.chipText).toBe('Done ✓');
    expect(row?.chipTitle).toStartWith('Done · Reviewed ');
  });
});

describe('progressBoardStateOf', () => {
  test('reads a document carrying the page payload, and nothing without it', () => {
    expect(ProgressModel.progressBoardStateOf(exampleProgressBoard())).not.toBeNull();
    expect(ProgressModel.progressBoardStateOf({ page: { tickets: [] } })).toBeNull();
    expect(ProgressModel.progressBoardStateOf(null)).toBeNull();
  });
});
