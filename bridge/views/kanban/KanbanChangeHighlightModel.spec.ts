/**
 * The change highlight as a diff of two consecutive boards. What matters: the first board marks nothing; a new card and a card whose state
 * moved are marked, an unchanged one is not; a hold or a draft readied counts as a move; a card that went is not answered; the keys are the
 * Kanban model's card keys, so the view marks the right card.
 */
import { describe, expect, test } from 'bun:test';

import { exampleBoard, exampleTicket } from '../../testing/KanbanBoardFixture.ts';
import { KanbanChangeHighlightModel }  from './KanbanChangeHighlightModel.ts';
import { KanbanModel }                 from './KanbanModel.ts';

const { changedCardKeysBetween } = KanbanChangeHighlightModel;

describe('the change highlight', () => {
  test('the first board marks nothing, since there is nothing it changed from', () => {
    expect([...changedCardKeysBetween(null, exampleBoard({ tickets: [exampleTicket('001')] }))]).toEqual([]);
  });

  test('a new card and a moved card are marked, an unchanged one and one that went are not', () => {
    const previous = exampleBoard({ tickets: [exampleTicket('001'), exampleTicket('002'), exampleTicket('003')] });
    const current = exampleBoard({ tickets: [exampleTicket('001'), exampleTicket('002', { status: 'in-progress' }), exampleTicket('004')] });
    expect([...changedCardKeysBetween(previous, current)].sort()).toEqual(['ticket:002', 'ticket:004']);
  });

  test('a hold placed, a draft readied and a filing draft whose state moved each count as a move', () => {
    const previous = exampleBoard({ tickets: [exampleTicket('010'), exampleTicket('011', { status: 'draft' })] });
    const current = exampleBoard({ tickets: [exampleTicket('010', { hold: '' }), exampleTicket('011')] });
    const withDraftMoved = {
      ...current,
      page: {
        ...current.page,
        payload: {
          ...current.page.payload,
          boardFacts: {
            ...current.page.payload.boardFacts,
            drafts: [{
              id: 'D7', title: 'Example filing draft', state: 'resumable' as const, openQuestionCount: 0
            }]
          },
        },
      },
    };
    expect([...changedCardKeysBetween(previous, withDraftMoved)].sort()).toEqual(['draft:D7', 'ticket:010', 'ticket:011']);
  });

  test('every key it marks is a card key of the Kanban model', () => {
    const previous = exampleBoard({ tickets: [] });
    const current = exampleBoard({ tickets: [exampleTicket('020'), exampleTicket('021', { status: 'draft' })] });
    const cardKeys = new Set(KanbanModel.kanbanModelOf(current, []).lanes.flatMap((lane) => lane.cards.map((card) => card.key)));
    const changed = [...changedCardKeysBetween(previous, current)];
    expect(changed.sort()).toEqual(['ticket:020', 'ticket:021']);
    expect(changed.every((cardKey) => cardKeys.has(cardKey))).toBe(true);
  });
});
