/**
 * Open drafts on the Kanban: every one a dashed card at the top of To do, above every ticket card in both lane orders, in draft-number
 * order, with no lane of their own; each card names its id, title and state, and counts the questions it waits on. These matter because
 * a draft may appear and vanish between two renders, and nothing else on the board knows it exists.
 */

import { describe, expect, test } from 'bun:test';

import type { Draft }            from '../../src/lib/tracker-model/@types/Draft.ts';
import type { PageTicket }       from '../../src/shared/@types/PagePayload.ts';
import type { TodoOrderChoice }  from '../@types/ViewerChoices.ts';
import { exampleDraft }          from '../testing/DraftFixture.ts';
import { exampleQuestion }       from '../testing/DraftFixture.ts';
import { pageBoardFixture }      from '../testing/PageBoardFixture.ts';
import { EXAMPLE_PAGE_LIMITS }   from '../testing/PageLimitsFixture.ts';
import { DependencyGraphUtil }   from '../utils/DependencyGraphUtil.ts';
import type { KanbanBoardInput } from './@types/KanbanBoardInput.ts';
import { kanbanBoardMarkup }     from './KanbanMarkup.ts';
import { KanbanLaneUtil }        from './utils/KanbanLaneUtil.ts';

const EXAMPLE_NOW   = Date.parse('2026-09-25T13:36:00+02:00');
const EXAMPLE_TODAY = '2026-09-25';
const BOARD_SLOTS   = 3;

function exampleTicket(id: string, changes: Partial<PageTicket> = {}): PageTicket {
  return {
    id,
    title:       `Example ticket ${id}`,
    type:        'ticket',
    status:      'pending',
    filed:       '2026-09-25T08:00:00+02:00',
    updated:     '2026-09-25T08:00:00+02:00',
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

/** Filed high first, so the tickets' usual order is high then normal in both lane orders: by wave orders a wave by id, not priority. */
const TICKETS = [exampleTicket('001', { title: 'Urgent work', priority: 'high' }), exampleTicket('002', { title: 'Normal work' })];

const DRAFTS = [
  exampleDraft('D2', { title: 'Second <draft>', questions: [exampleQuestion('Q1')], nextQuestionNumber: 2 }),
  exampleDraft('D1', { title: 'First draft' }),
];

function boardInputOf(tickets: readonly PageTicket[], drafts: readonly Draft[], todoOrder: TodoOrderChoice): KanbanBoardInput {
  const board = pageBoardFixture({ tasks: [], tickets, drafts });
  return {
    cards:                   KanbanLaneUtil.kanbanCardsFor(board.tickets, new Map()),
    drafts:                  board.drafts,
    todoOrder,
    dependencyGraph:         DependencyGraphUtil.dependencyGraphOf(board.tickets, BOARD_SLOTS),
    readyTicketIds:          board.readyTicketIds,
    nowEpochMilliseconds:    EXAMPLE_NOW,
    todayCalendarDate:       EXAMPLE_TODAY,
    slices:                  EXAMPLE_PAGE_LIMITS,
    finishedWork:            '1d',
    hiddenCountByClosedLane: { done: 0, abandoned: 0 },
    shownCountByClosedLane:  { done: 15, abandoned: 15 },
    abandonedLaneIsOpen:     false,
  };
}

/** Each lane's own markup, keyed by its `data-lane`. */
function laneMarkupByKeyOf(boardMarkup: string): Map<string, string> {
  return new Map(boardMarkup.split('<section ').slice(1).map((lane) => [/data-lane="([^"]+)"/u.exec(lane)?.[1] ?? '', lane]));
}

function cardIdsOf(markup: string): string[] {
  return [...markup.matchAll(/<article class="ap-kanban-card" id="[^"]*" data-(?:draft|ticket)-id="([^"]+)"/gu)].map((match) => match[1] ?? '');
}

function draftCardOf(boardMarkup: string, draftId: string): string {
  return new RegExp(`<article [^>]*data-draft-id="${draftId}"[\\s\\S]*?</article>`, 'u').exec(boardMarkup)?.[0] ?? '';
}

describe('open drafts on the Kanban', () => {
  for (const todoOrder of ['filed', 'by-wave'] as const) {
    test(`To do reads every draft first by number, then high before normal, ordered ${todoOrder}`, () => {
      const todo = laneMarkupByKeyOf(kanbanBoardMarkup(boardInputOf(TICKETS, DRAFTS, todoOrder))).get('todo') ?? '';

      expect(cardIdsOf(todo)).toEqual(['D1', 'D2', '001', '002']);
    });
  }

  test('no lane is the drafts\' own and no other lane holds a draft card', () => {
    const lanes = laneMarkupByKeyOf(kanbanBoardMarkup(boardInputOf(TICKETS, DRAFTS, 'filed')));

    expect([...lanes.keys()]).toEqual(['todo', 'progress', 'review', 'merge', 'done', 'abandoned']);
    expect([...lanes.values()].map((lane) => cardIdsOf(lane).filter((id) => id.startsWith('D')).length)).toEqual([DRAFTS.length, 0, 0, 0, 0, 0]);
  });

  test('a draft card names its id, its title escaped once and its state, counting the open questions it waits on', () => {
    const boardMarkup = kanbanBoardMarkup(boardInputOf(TICKETS, DRAFTS, 'filed'));
    const waiting     = draftCardOf(boardMarkup, 'D2');

    expect(waiting).toContain('data-state="draft" data-row="none" tabindex="0"');
    expect(waiting).toContain('<span class="ap-ticket-id">D2</span>');
    expect(waiting).toContain('>Second &lt;draft&gt;</p>');
    expect(waiting).toContain('<p class="ap-kanban-note">Waiting on you · 1 open question</p>');
    expect(draftCardOf(boardMarkup, 'D1')).toContain('<p class="ap-kanban-note">Researching</p>');
  });

  test('a draft card carries no priority, type, held, token or waiting mark', () => {
    const card = draftCardOf(kanbanBoardMarkup(boardInputOf(TICKETS, DRAFTS, 'filed')), 'D1');

    expect(card).toContain('<div class="ap-kanban-card-head"><span class="ap-ticket-id">D1</span></div>');
    expect(card).not.toContain('ap-kanban-marks');
  });

  test('a To do holding only drafts shows them instead of its empty text', () => {
    const todo = laneMarkupByKeyOf(kanbanBoardMarkup(boardInputOf([], DRAFTS, 'by-wave'))).get('todo') ?? '';

    expect(cardIdsOf(todo)).toEqual(['D1', 'D2']);
    expect(todo).not.toContain('ap-empty');
  });
});
