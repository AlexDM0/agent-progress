/**
 * Epics on the Board. What matters: a refused change (a malformed or taken key, an unknown epic, removing one a ticket still names) changes
 * nothing; a new epic takes the colour slot the fewest epics use, lowest on a tie; a ticket's list keeps its order, since the first key is
 * its primary epic; and the roll-up counts a ticket in two epics in both, its tokens from its own row plus its review rows, its span from
 * the first start to the last end and open while a counted row runs.
 */
import { describe, expect, test } from 'bun:test';

import {
  boardFixture,
  epicFixture,
  refusalDetailOf,
  taskFixture,
  ticketFixture
} from '../../testing/BoardFixtures.ts';

const AT = '2026-10-01T12:00:00+02:00';

function additionOf(key: string): { key: string; title: string; body: string; filePath: string } {
  return {
    key, title: `Example ${key}`, body: '', filePath: `/example-agency/.agent-progress/epics/${key}.md`
  };
}

describe('adding an epic', () => {
  test('takes the slot the fewest epics use, the lowest on a tie, and logs one record', () => {
    const { board, records } = boardFixture({ epics: [epicFixture({ key: 'example-a', slot: 1 }), epicFixture({ key: 'example-b', slot: 3 })] });

    expect(board.addEpic(additionOf('example-c'), AT).epic.frontmatter.slot).toBe(2);
    expect(board.addEpic(additionOf('example-d'), AT).epic.frontmatter.slot).toBe(4);
    expect(records.map((record) => record.kind)).toEqual(['epic-added', 'epic-added']);
    expect(board.epics().map((epic) => epic.frontmatter.key)).toEqual(['example-a', 'example-b', 'example-c', 'example-d']);
  });

  test('refuses a malformed key and a key already taken, changing nothing', () => {
    const { board, records } = boardFixture({ epics: [epicFixture({ key: 'example-a' })] });

    expect(refusalDetailOf(() => board.addEpic(additionOf('Example_A'), AT))).toEqual({ reason: 'malformed-epic-key', epicKey: 'Example_A' });
    expect(refusalDetailOf(() => board.addEpic(additionOf('example-'), AT))).toEqual({ reason: 'malformed-epic-key', epicKey: 'example-' });
    expect(refusalDetailOf(() => board.addEpic(additionOf('example-a'), AT))).toEqual({ reason: 'epic-already-exists', epicKey: 'example-a' });
    expect(board.epics()).toHaveLength(1);
    expect(board.changedEpics()).toEqual([]);
    expect(records).toEqual([]);
  });
});

describe('editing and removing an epic', () => {
  test('an edit that changes nothing logs and marks nothing', () => {
    const { board, records } = boardFixture({ epics: [epicFixture({ key: 'example-a', title: 'Example A' })] });

    expect(board.editEpic('example-a', { title: 'Example A' }, AT).changed).toBe(false);
    expect(board.changedEpics()).toEqual([]);
    expect(records).toEqual([]);
  });

  test('a body append and a new title are one change and one record', () => {
    const { board, records } = boardFixture({ epics: [epicFixture({ key: 'example-a' })] });
    const epic = board.epicByKey('example-a');
    if (epic === undefined) throw new Error('the fixture epic is missing');

    board.editEpic('example-a', { title: 'Example renamed', body: { text: 'More.', appends: true } }, AT);

    expect(epic.frontmatter.title).toBe('Example renamed');
    expect(epic.body).toBe('More.');
    expect(records).toEqual([{
      at: AT, kind: 'epic-edited', epicKey: 'example-a', fields: { title: 'Example renamed' }
    }]);
  });

  test('a removal is refused while any ticket names the epic, a delivered one included', () => {
    const { board } = boardFixture({
      epics:   [epicFixture({ key: 'example-a' })],
      tickets: [ticketFixture({ id: '001', status: 'delivered', epics: ['example-a'] })],
    });

    expect(refusalDetailOf(() => board.removeEpic('example-a', AT))).toEqual({ reason: 'epic-still-named', epicKey: 'example-a', ticketIds: ['001'] });
    expect(board.epics()).toHaveLength(1);
  });

  test('a removed epic leaves the records for the removed list, and an unknown one is refused', () => {
    const { board } = boardFixture({ epics: [epicFixture({ key: 'example-a' })] });

    board.removeEpic('example-a', AT);

    expect(board.epics()).toEqual([]);
    expect(board.removedEpics().map((epic) => epic.frontmatter.key)).toEqual(['example-a']);
    expect(refusalDetailOf(() => board.removeEpic('example-a', AT))).toEqual({ reason: 'unknown-epic', missingEpicKeys: ['example-a'] });
  });
});

describe('a ticket\'s epics', () => {
  const epics = (): ReturnType<typeof epicFixture>[] => [epicFixture({ key: 'example-a' }), epicFixture({ key: 'example-b', slot: 2 })];

  test('keep the order given, a repeat at its first place, and --add appends after the primary epic', () => {
    const { board } = boardFixture({ epics: epics(), tickets: [ticketFixture({ id: '001' })] });

    expect(board.setTicketEpics('001', ['example-b', 'example-b'], AT).ticket.frontmatter.epics).toEqual(['example-b']);
    const added = board.addTicketEpics('001', ['example-a', 'example-b'], AT);
    expect(added.ticket.frontmatter.epics).toEqual(['example-b', 'example-a']);
    expect(added.addedEpicKeys).toEqual(['example-a']);
  });

  test('an emptied list deletes the key rather than storing an empty one', () => {
    const { board } = boardFixture({ epics: epics(), tickets: [ticketFixture({ id: '001', epics: ['example-a'] })] });

    const removed = board.removeTicketEpics('001', ['example-a'], AT);

    expect(Object.hasOwn(removed.ticket.frontmatter, 'epics')).toBe(false);
    expect(removed.droppedEpicKeys).toEqual(['example-a']);
  });

  test('a key the ticket already holds whose epic is gone is kept, and may be removed, rather than blocking every change', () => {
    const { board } = boardFixture({ epics: epics(), tickets: [ticketFixture({ id: '001', epics: ['example-gone'] })] });

    expect(board.addTicketEpics('001', ['example-a'], AT).ticket.frontmatter.epics).toEqual(['example-gone', 'example-a']);
    expect(board.removeTicketEpics('001', ['example-gone'], AT).ticket.frontmatter.epics).toEqual(['example-a']);
    expect(refusalDetailOf(() => board.removeTicketEpics('001', ['example-gone'], AT))).toEqual({ reason: 'unknown-epic', missingEpicKeys: ['example-gone'] });
  });

  test('an unknown epic is refused, on a set and on a filing, changing nothing', () => {
    const { board, records } = boardFixture({ epics: epics(), tickets: [ticketFixture({ id: '001' })] });

    expect(refusalDetailOf(() => board.setTicketEpics('001', ['example-a', 'example-z'], AT))).toEqual({ reason: 'unknown-epic', missingEpicKeys: ['example-z'] });
    expect(refusalDetailOf(() => board.fileTicket(ticketFixture({ id: '002', epics: ['example-z'] }), AT))).toEqual({ reason: 'unknown-epic', missingEpicKeys: ['example-z'] });
    expect(board.tickets()).toHaveLength(1);
    expect(board.changedTickets()).toEqual([]);
    expect(records).toEqual([]);
  });
});

describe('the roll-up', () => {
  test('counts a ticket in two epics in both, with its own row and its review rows', () => {
    const { board } = boardFixture({
      epics:   [epicFixture({ key: 'example-a' }), epicFixture({ key: 'example-b', slot: 2 })],
      tickets: [
        ticketFixture({
          id: '001', status: 'in-review', task: 1, epics: ['example-a', 'example-b']
        }),
        ticketFixture({
          id: '002', status: 'delivered', task: 3, epics: ['example-a']
        }),
        ticketFixture({ id: '003', status: 'pending', epics: ['example-b'] }),
      ],
      tasks: [
        taskFixture({
          id: 1, ticket: '001', status: 'in-review', start: '2026-10-01T09:00:00+02:00', end: '2026-10-01T10:00:00+02:00', tokens: 100
        }),
        taskFixture({
          id: 2, reviewOf: '001', status: 'delivered', start: '2026-10-01T10:00:00+02:00', end: '2026-10-01T11:30:00+02:00', tokens: 40
        }),
        taskFixture({
          id: 3, ticket: '002', status: 'delivered', start: '2026-10-01T07:30:00Z', end: '2026-10-01T09:45:00Z', tokens: null
        }),
      ],
    });

    const [rollupA, rollupB] = board.epicRollups();

    expect(rollupA).toEqual({
      key:                 'example-a',
      title:               'Example checkout redesign',
      slot:                1,
      ticketIds:           ['001', '002'],
      ticketCountByStatus: {
        'pending': 0, 'in-progress': 0, 'in-review': 1, 'reviewed': 0, 'delivered': 1, 'abandoned': 0
      },
      tokens: 140,
      // Text order would pick the other stamp each time: 07:30Z is 09:30+02:00, after the 09:00 start; 09:45Z is 11:45+02:00, the last end.
      span:   { start: '2026-10-01T09:00:00+02:00', end: '2026-10-01T09:45:00Z' },
    });
    expect(rollupB?.ticketIds).toEqual(['001', '003']);
    expect(rollupB?.tokens).toBe(140);
    expect(rollupB?.span).toEqual({ start: '2026-10-01T09:00:00+02:00', end: '2026-10-01T11:30:00+02:00' });
  });

  test('has no span before anything starts, and an open one while a counted row runs', () => {
    const { board } = boardFixture({
      epics:   [epicFixture({ key: 'example-a' })],
      tickets: [ticketFixture({
        id: '001', status: 'in-progress', task: 1, epics: ['example-a']
      }), ticketFixture({ id: '002', epics: ['example-a'] })],
      tasks: [taskFixture({
        id: 1, ticket: '001', status: 'in-progress', start: '2026-10-01T09:00:00+02:00'
      })],
    });
    const { board: emptyBoard } = boardFixture({ epics: [epicFixture({ key: 'example-a' })] });

    expect(board.epicRollups()[0]?.span).toEqual({ start: '2026-10-01T09:00:00+02:00', end: null });
    expect(emptyBoard.epicRollups()[0]?.span).toBeNull();
    expect(emptyBoard.epicRollups()[0]?.ticketIds).toEqual([]);
  });
});
