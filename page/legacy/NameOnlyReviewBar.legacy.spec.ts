/**
 * How the page draws review rows known only by their `Review <N> #<id>` name once ingestion has linked them: nested above their ticket
 * among flagged rounds, a bundle once above the first ticket it names, and found by a Kanban card for its round note.
 * It reads the older input `src/adapters/legacy/` links, and is deleted with that folder.
 */

import { describe, expect, test } from 'bun:test';

import type { Task }            from '../../src/lib/tracker-model/@types/Task.ts';
import type { PageTicket }      from '../../src/shared/@types/PagePayload.ts';
import { ReviewBarNameUtil }    from '../../src/shared/legacy/utils/ReviewBarNameUtil.ts';
import { subStateNoteOf }       from '../kanban/KanbanLaneText.ts';
import { kanbanCardsFor }       from '../kanban/KanbanLanes.ts';
import { taskRowsMarkup }       from '../progress/ProgressMarkup.ts';
import { pageBoardFixture }     from '../testing/PageBoardFixture.ts';
import type { TimelineBar }     from '../utils/GeometryUtil.ts';
import type { TimestampSlices } from '../utils/TimeUtil.ts';

const EXAMPLE_TODAY = '2026-09-25';
const EXAMPLE_NOW   = Date.parse('2026-09-25T13:36:00+02:00');

const EXAMPLE_SLICES: TimestampSlices = {
  dateAndClockLength:    16,
  calendarDateLength:    10,
  monthAndDaySliceStart: 5,
  clockSliceStart:       11,
  clockSliceEnd:         16,
};

const PLACED_BAR: TimelineBar = {
  taskId:       1,
  leftPercent:  10,
  widthPercent: 25,
  clippedLeft:  false,
  clippedRight: false,
  visible:      true,
};

function at(clock: string, day = EXAMPLE_TODAY): string {
  return `${day}T${clock}:00+02:00`;
}

function exampleTask(changes: Partial<Task> & { id: number }): Task {
  return {
    name:   'Split the exporter into two passes',
    status: 'in-progress',
    start:  '2026-09-18T20:05:00+02:00',
    end:    null,
    owner:  'Alex Example',
    note:   '',
    ticket: null,
    tokens: null,
    ...changes,
  };
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

/** The rows as ingestion hands them over: a name-only bar linked by its name before the page sees it. */
function linkedAsIngestionLinksThem(tasks: readonly Task[]): Task[] {
  return tasks.map((task) => ReviewBarNameUtil.linkedReviewBarOf(task));
}

function rowsFiled(tasks: readonly Task[]): Parameters<typeof taskRowsMarkup>[0] {
  return pageBoardFixture({ tasks: linkedAsIngestionLinksThem(tasks) }).rows.map((task) => ({ task, bar: PLACED_BAR, waitingOn: [] }));
}

function drawnOrderOf(markup: string): Array<[taskId: string, reviewOf: string | null]> {
  return [...markup.matchAll(/data-task-id="(\d+)" data-state="[^"]+"(?: data-review-of="(\d+)")?/g)].map((match) => [match[1] ?? '', match[2] ?? null]);
}

describe('review rows known only by their name', () => {
  test('draws a name-only review row among the flagged rounds directly above the ticket, newest filed first', () => {
    const markup = taskRowsMarkup(rowsFiled([
      exampleTask({ id: 1, name: 'Split the exporter', ticket: '003' }),
      exampleTask({ id: 2, name: 'Regenerate the fixtures' }),
      exampleTask({ id: 3, name: 'Review 1 #3 — Split the exporter' }),
      exampleTask({ id: 4, name: 'Brighter colours', ticket: '004' }),
      exampleTask({ id: 5, name: 'Review 2 #3 — Split the exporter', reviewOf: '003' }),
      exampleTask({ id: 6, name: 'Review 3 #3 — Split the exporter', reviewOf: '003' }),
    ]), EXAMPLE_SLICES);

    expect(drawnOrderOf(markup)).toEqual([
      ['4', null],
      ['2', null],
      ['6', '003'],
      ['5', '003'],
      ['3', '003'],
      ['1', null],
    ]);
  });

  test('draws a name-only bundle review once, above the first ticket it names', () => {
    const markup = taskRowsMarkup(rowsFiled([
      exampleTask({ id: 1, ticket: '013' }),
      exampleTask({ id: 2, ticket: '005' }),
      exampleTask({ id: 3, name: 'Review 1 #13, #5 — the bundle' }),
    ]), EXAMPLE_SLICES);

    expect(drawnOrderOf(markup)).toEqual([['2', null], ['3', '013'], ['1', null]]);
    expect(markup.match(/data-task-id="3"/g)?.length).toBe(1);
  });

  test('names the round and the newest reviewer on a repeat review, finding a review row by its name', () => {
    const tasks = linkedAsIngestionLinksThem([
      exampleTask({
        id: 1, status: 're-review', start: null, ticket: '059', reviewRound: 3
      }),
      exampleTask({
        id:     2,
        name:   'Review 1 #059 — Accent-blind search',
        status: 'delivered',
        start:  at('10:50'),
        end:    at('11:30'),
      }),
      exampleTask({
        id:     3,
        name:   'Review 2 #059 — Accent-blind search',
        status: 'in-progress',
        start:  at('11:34', '2026-09-24'),
      }),
    ]);
    const ticket = exampleTicket('059', { status: 'in-review' });
    const [card] = kanbanCardsFor(pageBoardFixture({ tasks, tickets: [ticket] }).tickets, new Map([[ticket.id, []]]));
    if (card === undefined) throw new Error('no card was built');

    expect(subStateNoteOf(card, { nowEpochMilliseconds: EXAMPLE_NOW, todayCalendarDate: EXAMPLE_TODAY, slices: EXAMPLE_SLICES }))
      .toBe('round 3 reviewer since 09-24 11:34');
  });
});
