/**
 * The signature the reload snapshot carries and its difference. The cases that matter: a moved item and a new one are told apart from an
 * unchanged one, a review round change counts as a change although the state stays, a vanished item is never answered, and a stored
 * signature that is not two records reads as none, so it highlights nothing instead of everything.
 */

import { describe, expect, test } from 'bun:test';
import type { Task }              from '../../../src/lib/tracker-model/@types/Task.ts';
import type { ScreenSignature }   from '../../@types/ViewerChoices.ts';
import { pageBoardFixture }       from '../../testing/PageBoardFixture.ts';
import { ScreenSignatureUtil }    from './ScreenSignatureUtil.ts';

const {
  changesBetween, highlightedIdsOf, screenSignatureFrom, screenSignatureOf
} = ScreenSignatureUtil;

function exampleTask(changes: Partial<Task> = {}): Task {
  return {
    id:     1,
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

const PREVIOUS_SIGNATURE: ScreenSignature = {
  tasks:   { 1: 'in-progress', 2: 'pending', 3: 'reviewing' },
  tickets: { '001': 'in-progress', '002': 'pending', '003': 'reviewing round 2' },
};

describe('changesBetween', () => {
  test('tells new, changed and unchanged ids apart, tasks and tickets each on their own', () => {
    const current: ScreenSignature = {
      tasks: {
        1: 'in-review', 2: 'pending', 3: 'reviewing', 4: 'pending'
      },
      tickets: {
        '001': 'in-review', '002': 'pending', '003': 'reviewing round 2', '004': 'pending'
      },
    };

    expect(changesBetween(PREVIOUS_SIGNATURE, current)).toEqual({
      tasks:   { newIds: ['4'], changedIds: ['1'], unchangedIds: ['2', '3'] },
      tickets: { newIds: ['004'], changedIds: ['001'], unchangedIds: ['002', '003'] },
    });
  });

  test('counts a review round change as a change although the state is the same', () => {
    const current: ScreenSignature = { ...PREVIOUS_SIGNATURE, tickets: { ...PREVIOUS_SIGNATURE.tickets, '003': 'reviewing round 3' } };

    expect(changesBetween(PREVIOUS_SIGNATURE, current).tickets.changedIds).toEqual(['003']);
  });

  test('answers nothing about an item that disappeared, and nothing changed between equal signatures', () => {
    const current: ScreenSignature = { tasks: { 2: 'pending' }, tickets: {} };

    expect(changesBetween(PREVIOUS_SIGNATURE, current)).toEqual({
      tasks:   { newIds: [], changedIds: [], unchangedIds: ['2'] },
      tickets: { newIds: [], changedIds: [], unchangedIds: [] },
    });
    expect(highlightedIdsOf(changesBetween(PREVIOUS_SIGNATURE, PREVIOUS_SIGNATURE).tickets).size).toBe(0);
  });

  // A ticket id is outside text: one named like a prototype key is new, not already present.
  test('reads a previous id through its own keys only', () => {
    const current: ScreenSignature = { tasks: {}, tickets: { constructor: 'pending' } };

    expect(changesBetween(PREVIOUS_SIGNATURE, current).tickets.newIds).toEqual(['constructor']);
  });
});

describe('highlightedIdsOf', () => {
  test('highlights the new and the changed ids', () => {
    expect([...highlightedIdsOf({ newIds: ['4'], changedIds: ['1'], unchangedIds: ['2'] })]).toEqual(['4', '1']);
  });
});

describe('screenSignatureOf', () => {
  test('keys each row by its id with its display state, and adds the review round once the row has one', () => {
    const board = pageBoardFixture({ tasks: [exampleTask(), exampleTask({ id: 2, status: 'in-review', reviewRound: 2 })] });

    expect(screenSignatureOf(board)).toEqual({ tasks: { 1: 'in-progress', 2: 'in-review round 2' }, tickets: {} });
  });
});

describe('screenSignatureFrom', () => {
  test('reads back a stored signature, dropping any entry that is not text', () => {
    expect(screenSignatureFrom(JSON.parse(JSON.stringify(PREVIOUS_SIGNATURE)))).toEqual(PREVIOUS_SIGNATURE);
    expect(screenSignatureFrom({ tasks: { 1: 'pending', 2: 7 }, tickets: {} })).toEqual({ tasks: { 1: 'pending' }, tickets: {} });
  });

  test('reads no signature unless both halves are records', () => {
    expect(screenSignatureFrom(null)).toBeNull();
    expect(screenSignatureFrom('signature')).toBeNull();
    expect(screenSignatureFrom({ tasks: {} })).toBeNull();
    expect(screenSignatureFrom({ tasks: 'none', tickets: {} })).toBeNull();
  });
});
