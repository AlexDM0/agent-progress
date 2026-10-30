/**
 * The Kanban's view model against small synthetic boards. What matters: each ticket lands in the lane its status and the merge queue put
 * it in, ready tickets keep the Board's order, closed lanes read newest first; a draft ticket offers Ready and its lane a multi-select of
 * exactly its draft tickets, a ready ticket offers Hold or Unhold and the other priorities, and no other card offers anything; the card
 * carries the static page's marks (size, priority, type, tokens, epics, waiting-on, hold); filing drafts keep their own card; and the epic
 * chips filter, count and drop a stored chip whose epic went, as `page/chips/` does.
 */
import { describe, expect, test } from 'bun:test';

import type { KanbanBoardState }                   from '../../@types/KanbanBoardState.ts';
import { exampleBoard, exampleTicket }             from '../../testing/KanbanBoardFixture.ts';
import { KANBAN_LANES, KanbanModel, NO_EPIC_CHIP } from './KanbanModel.ts';

function laneIdsOf(state: KanbanBoardState, pressedChips: readonly string[] = []): Record<string, string[]> {
  const model = KanbanModel.kanbanModelOf(state, pressedChips);
  return Object.fromEntries(model.lanes.map((lane) => [lane.key, lane.cards.map((card) => card.idText)]));
}

describe('the lanes', () => {
  test('the seven lanes come in order, titled as the design names them', () => {
    const model = KanbanModel.kanbanModelOf(exampleBoard({ tickets: [] }), []);
    expect(model.lanes.map((lane) => lane.key)).toEqual([...KANBAN_LANES]);
    expect(model.lanes.map((lane) => lane.title)).toEqual(['Drafts', 'Ready', 'Building', 'In review', 'Merge queue', 'Done', 'Abandoned']);
  });

  test('each ticket sits in the lane of its status, and a queued in-review ticket in the merge queue', () => {
    const board = exampleBoard({
      tickets: [
        exampleTicket('001', { status: 'draft' }),
        exampleTicket('002'),
        exampleTicket('003', { status: 'in-progress' }),
        exampleTicket('004', { status: 'in-review' }),
        exampleTicket('005', { status: 'in-review' }),
        exampleTicket('006', { status: 'reviewed' }),
        exampleTicket('007', { status: 'delivered', delivered: '2026-10-20T10:00:00+02:00' }),
        exampleTicket('008', { status: 'abandoned', abandonedAt: '2026-10-21T10:00:00+02:00' }),
      ],
      queuedTicketIds: ['005'],
    });
    expect(laneIdsOf(board)).toEqual({
      'drafts':      ['#001', 'D7'],
      'ready':       ['#002'],
      'building':    ['#003'],
      'in-review':   ['#004'],
      'merge-queue': ['#005', '#006'],
      'done':        ['#007'],
      'abandoned':   ['#008'],
    });
  });

  test('ready tickets keep the Board\'s order to take them, then the waiting ones by priority; closed lanes read newest first', () => {
    const board = exampleBoard({
      tickets: [
        exampleTicket('010'),
        exampleTicket('011', { priority: 'high' }),
        exampleTicket('012'),
        exampleTicket('013'),
        exampleTicket('020', { status: 'delivered', delivered: '2026-10-01T10:00:00+02:00' }),
        exampleTicket('021', { status: 'delivered', delivered: '2026-10-09T10:00:00+02:00' }),
      ],
      readyTicketIds: ['013', '010'],
    });
    expect(laneIdsOf(board)['ready']).toEqual(['#013', '#010', '#011', '#012']);
    expect(laneIdsOf(board)['done']).toEqual(['#021', '#020']);
  });

  test('an empty lane says so in its own words', () => {
    const building = KanbanModel.kanbanModelOf(exampleBoard({ tickets: [] }), []).lanes.find((lane) => lane.key === 'building');
    expect(building?.emptyText).toBe('Nothing being built.');
  });
});

describe('the actions', () => {
  const board = exampleBoard({
    tickets: [
      exampleTicket('030', { status: 'draft' }),
      exampleTicket('031', { status: 'draft' }),
      exampleTicket('032', { priority: 'low' }),
      exampleTicket('033', { hold: 'waiting on the example vendor' }),
      exampleTicket('034', { status: 'in-progress' }),
    ],
  });
  const model = KanbanModel.kanbanModelOf(board, []);
  const cardOf = (idText: string) => model.lanes.flatMap((lane) => lane.cards).find((card) => card.idText === idText);

  test('a draft ticket offers Ready, and the Drafts lane may ready exactly its draft tickets, never a filing draft', () => {
    expect(cardOf('#030')?.actions).toEqual({ readies: true, holdMove: null, priorityChoices: [] });
    expect(model.lanes.find((lane) => lane.key === 'drafts')?.readyableTicketIds).toEqual(['030', '031']);
    expect(cardOf('D7')?.actions).toEqual({ readies: false, holdMove: null, priorityChoices: [] });
    expect(model.lanes.filter((lane) => lane.readyableTicketIds.length > 0).map((lane) => lane.key)).toEqual(['drafts']);
  });

  test('a ready ticket offers Hold, or Unhold once held, and every priority but its own', () => {
    expect(cardOf('#032')?.actions).toEqual({ readies: false, holdMove: 'hold', priorityChoices: ['high', 'normal'] });
    expect(cardOf('#033')?.actions).toEqual({ readies: false, holdMove: 'unhold', priorityChoices: ['high', 'low'] });
  });

  test('a card in any other lane offers nothing', () => {
    expect(cardOf('#034')?.actions).toEqual({ readies: false, holdMove: null, priorityChoices: [] });
  });
});

describe('the card', () => {
  test('a ticket card carries its size, priority, type, tokens, epics, waiting-on and hold, as the static page\'s card does', () => {
    const board = exampleBoard({
      tickets: [exampleTicket('040', {
        size: 'L', priority: 'high', type: 'bug', epics: ['billing', 'gone'], hold: ''
      })],
      waitingOn:  { '040': ['039'] },
      tokensById: { '040': 12_345 },
    });
    const [card] = KanbanModel.kanbanModelOf(board, []).lanes.find((lane) => lane.key === 'ready')?.cards ?? [];
    expect(card).toEqual({
      key:        'ticket:040',
      ticketId:   '040',
      idText:     '#040',
      title:      'Example ticket 040',
      stateToken: 'pending',
      draftLabel: null,
      size:       'L',
      priority:   'high',
      ticketType: 'bug',
      tokensText: '12.3k tokens',
      epics:      [{ key: 'billing', title: 'Example billing', slot: 4 }],
      waitingOn:  ['#039'],
      heldTitle:  'Held',
      note:       null,
      ariaLabel:  '#040 Example ticket 040, high priority',
      actions:    { readies: false, holdMove: 'unhold', priorityChoices: ['normal', 'low'] },
    });
  });

  test('a draft ticket is labelled "draft ticket" and a filing draft "filing draft", the filing draft with its state line', () => {
    const drafts = KanbanModel.kanbanModelOf(exampleBoard({ tickets: [exampleTicket('050', { status: 'draft' })] }), []).lanes[0]?.cards ?? [];
    expect(drafts.map((card) => [card.idText, card.stateToken, card.draftLabel, card.note])).toEqual([
      ['#050', 'draft', 'draft ticket', null],
      ['D7', 'draft', 'filing draft', 'Waiting on you · 2 open questions'],
    ]);
  });
});

describe('the epic chips', () => {
  const board = exampleBoard({
    tickets: [
      exampleTicket('060', { epics: ['checkout'] }),
      exampleTicket('061', { epics: ['checkout', 'billing'] }),
      exampleTicket('062'),
      exampleTicket('063', { status: 'delivered', delivered: '2026-10-02T10:00:00+02:00', epics: ['billing'] }),
    ],
  });

  test('an epic holding an open ticket gets a chip, the no-epic chip comes last, and each counts every ticket answering to it', () => {
    const model = KanbanModel.kanbanModelOf(board, []);
    expect(model.epicChips).toEqual([
      { value: 'checkout', label: 'Example checkout', slot: 2 },
      { value: 'billing', label: 'Example billing', slot: 4 },
      { value: NO_EPIC_CHIP, label: 'No epic' },
    ]);
    expect([...model.countByChip]).toEqual([['checkout', 2], ['billing', 2], [NO_EPIC_CHIP, 1]]);
  });

  test('pressed chips are alternatives: a ticket in any pressed epic stays, every other ticket leaves its lane', () => {
    expect(laneIdsOf(board, ['billing'])['ready']).toEqual(['#061']);
    expect(laneIdsOf(board, ['billing', NO_EPIC_CHIP])['ready']).toEqual(['#061', '#062']);
    expect(laneIdsOf(board, ['billing'])['done']).toEqual(['#063']);
  });

  test('a stored chip whose epic has no chip any more presses nothing, so it cannot narrow the board unseen', () => {
    const model = KanbanModel.kanbanModelOf(board, ['retired-epic']);
    expect(model.pressedChips).toEqual([]);
    expect(laneIdsOf(board, ['retired-epic'])['ready']).toEqual(['#060', '#061', '#062']);
  });
});

describe('reading the state document', () => {
  test('a document lacking the page payload or the merge queue reads as no Kanban board, and a full one reads as itself', () => {
    const board = exampleBoard({ tickets: [] });
    expect(KanbanModel.kanbanBoardStateOf(null)).toBeNull();
    expect(KanbanModel.kanbanBoardStateOf({ page: board.page })).toBeNull();
    expect(KanbanModel.kanbanBoardStateOf({ mergeQueue: board.mergeQueue, page: { tickets: [] } })).toBeNull();
    expect(KanbanModel.kanbanBoardStateOf(board)).toBe(board);
  });
});
