/**
 * The dependencies view's model, laid out as the static page laid out its waves. The cases that matter: a diamond lays out a Done
 * column of what the open tickets build on and one column per wave, the pace path first; Ready comes only from the Board's ready list and a
 * held ticket wears Held; edges mark the pace path and a settled dependency; nodes and heads are placed in pixels on one canvas; a ticket's
 * lineage is itself, everything upstream and everything waiting on it; a forecast is asked only while the Overseer is running; and a
 * board where nothing depends on anything draws no view.
 */
import { describe, expect, test } from 'bun:test';

import { exampleProgressBoard, exampleProgressTask, exampleProgressTicket } from '../../testing/ProgressBoardFixture.ts';
import { DependenciesModel, NODE_WIDTH_PIXELS }                             from './DependenciesModel.ts';

const NOW_EPOCH_MILLISECONDS = Date.parse('2026-09-18T13:00:00+02:00');

const DIAMOND = exampleProgressBoard({
  tickets: [
    exampleProgressTicket('1', { status: 'delivered' }),
    exampleProgressTicket('2', { dependsOn: ['1'] }),
    exampleProgressTicket('3', { dependsOn: ['1'], status: 'in-progress' }),
    exampleProgressTicket('4', { dependsOn: ['2', '3'], hold: 'waiting on the example vendor' }),
  ],
  readyTicketIds: ['2'],
  displayStates:  { 3: 'in-progress' },
});

function diamondCanvas() {
  const canvas = DependenciesModel.dependenciesModelOf(DIAMOND, NOW_EPOCH_MILLISECONDS);
  if (canvas === null) throw new Error('the diamond has dependencies');
  return canvas;
}

describe('the waves', () => {
  test('lays out a Done column of what the open tickets build on, then one column per wave', () => {
    const canvas = diamondCanvas();

    expect(canvas.columns.map((column) => [column.label, column.countText, column.isNarrow])).toEqual([
      ['Done', '1 delivered', false],
      ['Now', '2 side by side', false],
      ['Wave 2', 'one at a time', true],
    ]);
    expect(canvas.columns[0]?.slotsFilled).toEqual([]);
    expect(canvas.columns[1]?.slotsFilled).toEqual([true, true, false]);
    expect(canvas.columns[1]?.slotsLabel).toBe('2 of 3 slots in use');
  });

  test('places every node in pixels, a column apart, the pace-path node first in its wave', () => {
    const canvas = diamondCanvas();
    const placeOf = (ticketId: string) => canvas.nodes.find((node) => node.ticketId === ticketId);

    expect(placeOf('2')?.top).toBeLessThan(placeOf('3')?.top ?? 0);
    expect((placeOf('4')?.left ?? 0) - (placeOf('2')?.left ?? 0)).toBeGreaterThan(NODE_WIDTH_PIXELS);
    expect(canvas.width).toBeGreaterThan(3 * NODE_WIDTH_PIXELS);
  });

  test('says Ready only for a ticket the Board lists, Held for a held one, and the state while it is built', () => {
    const chipsOf = (ticketId: string) => diamondCanvas().nodes.find((node) => node.ticketId === ticketId)?.chips;

    expect(chipsOf('2')).toEqual([{ kind: 'ready' }]);
    expect(chipsOf('3')).toEqual([{ kind: 'state', displayState: 'in-progress', label: 'In progress' }]);
    expect(chipsOf('4')).toEqual([{ kind: 'held', title: 'Held: waiting on the example vendor' }]);
    expect(chipsOf('1')).toEqual([]);
  });

  test('counts what waits on each open ticket, and nothing on a done one', () => {
    const heldCountOf = (ticketId: string) => diamondCanvas().nodes.find((node) => node.ticketId === ticketId)?.heldCount;

    expect([heldCountOf('1'), heldCountOf('2'), heldCountOf('3'), heldCountOf('4')]).toEqual([0, 1, 1, 0]);
  });

  test('marks the pace path’s edges and the edges from a settled dependency', () => {
    const edges = diamondCanvas().edges.map((edge) => [`${edge.fromTicketId}>${edge.toTicketId}`, edge.isPace, edge.isSettled]);

    expect(edges.toSorted()).toEqual([['1>2', false, true], ['1>3', false, true], ['2>4', true, false], ['3>4', false, false]]);
  });

  test('asks for no forecast while the Overseer is not running', () => {
    expect(diamondCanvas().columns.map((column) => column.forecastText)).toEqual([null, null, null]);
  });

  test('forecasts each open wave from the delivered history while the Overseer is running, and none while it is paused', () => {
    const deliveredBuildRow = exampleProgressTask(1, {
      status:  'delivered',
      history: [{ status: 'in-progress', at: '2026-09-18T10:00:00+02:00' }, { status: 'in-review', at: '2026-09-18T10:30:00+02:00' }],
    });
    const boardWhileOverseer = (overseerState: string) => exampleProgressBoard({
      tasks:   [deliveredBuildRow],
      tickets: [
        exampleProgressTicket('1', { status: 'delivered' }),
        exampleProgressTicket('2', { dependsOn: ['1'] }),
        exampleProgressTicket('3', { dependsOn: ['2'] }),
      ],
      ticketRows:     { 1: { ownTaskId: 1 } },
      readyTicketIds: ['2'],
      overseerState,
    });
    const forecastTextsWhile = (overseerState: string) => DependenciesModel.dependenciesModelOf(boardWhileOverseer(overseerState), NOW_EPOCH_MILLISECONDS)
      ?.columns.map((column) => column.forecastText);

    expect(forecastTextsWhile('running')?.slice(1)).toEqual([expect.stringMatching(/^ETA /), expect.stringMatching(/^ETA /)]);
    expect(forecastTextsWhile('paused')).toEqual([null, null, null]);
  });
});

describe('lineage', () => {
  test('is the ticket, everything it depends on and everything waiting on it', () => {
    const canvas = diamondCanvas();

    expect([...DependenciesModel.lineageOf(canvas.graph, '2')].sort()).toEqual(['1', '2', '4']);
    expect([...DependenciesModel.lineageOf(canvas.graph, '4')].sort()).toEqual(['1', '2', '3', '4']);
  });
});

test('draws no view on a board where no ticket depends on another', () => {
  const board = exampleProgressBoard({ tickets: [exampleProgressTicket('1'), exampleProgressTicket('2')] });

  expect(DependenciesModel.dependenciesModelOf(board, NOW_EPOCH_MILLISECONDS)).toBeNull();
});
