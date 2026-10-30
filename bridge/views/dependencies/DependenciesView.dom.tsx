/**
 * The dependencies view in a happy-dom document. What matters: the waves render as columns with their heads, nodes and edges; pointing at a
 * ticket lights its lineage and the edges inside it and dims the rest; leaving the canvas clears the lineage only after the grace; a node
 * opens its ticket's detail panel; and a planted title shows as text.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen
} from '@testing-library/react';
import {
  afterEach,
  describe,
  expect,
  test
} from 'bun:test';

import { exampleProgressBoard, exampleProgressTicket }        from '../../testing/ProgressBoardFixture.ts';
import { DependenciesModel }                                  from './DependenciesModel.ts';
import { DependenciesView, LINEAGE_CLEAR_GRACE_MILLISECONDS } from './DependenciesView.tsx';

const PLANTED_TITLE = '<img src=x onerror="window.plantedRan = true">';

const BOARD = exampleProgressBoard({
  tickets: [
    exampleProgressTicket('1', { status: 'delivered' }),
    exampleProgressTicket('2', { dependsOn: ['1'] }),
    exampleProgressTicket('3', { dependsOn: ['1'], title: PLANTED_TITLE }),
    exampleProgressTicket('4', { dependsOn: ['2'] }),
  ],
  readyTicketIds: ['2', '3'],
});

function renderDependencies() {
  const canvas = DependenciesModel.dependenciesModelOf(BOARD, Date.parse('2026-09-18T13:00:00+02:00'));
  if (canvas === null) throw new Error('the board has dependencies');
  return render(<DependenciesView canvas={canvas} />).container;
}

function litTicketIds(container: HTMLElement): (string | null)[] {
  return [...container.querySelectorAll('.bridge-dependency-node[data-lit]')].map((node) => node.getAttribute('data-ticket-id')).sort();
}

function nodeOf(container: HTMLElement, ticketId: string): Element {
  const node = container.querySelector(`.bridge-dependency-node[data-ticket-id="${ticketId}"]`);
  if (node === null) throw new Error(`no node for #${ticketId}`);
  return node;
}

afterEach(cleanup);

test('renders the waves as columns with their heads, nodes and edges', () => {
  const container = renderDependencies();

  expect([...container.querySelectorAll('.bridge-dependency-head-name')].map((head) => head.textContent)).toEqual(['Done', 'Now', 'Wave 2']);
  expect(container.querySelectorAll('.bridge-dependency-node')).toHaveLength(4);
  expect(container.querySelectorAll('.bridge-dependency-edge')).toHaveLength(3);
  expect((nodeOf(container, '4') as HTMLElement).style.left).not.toBe('');
});

test('opens a ticket’s detail panel from its node, and shows a planted title as text', () => {
  const container = renderDependencies();

  expect(nodeOf(container, '2').getAttribute('href')).toBe('#tickets/2');
  expect(screen.getByText(PLANTED_TITLE)).not.toBeNull();
  expect((window as { plantedRan?: boolean }).plantedRan).toBeUndefined();
});

describe('lineage', () => {
  test('lights the pointed ticket, its upstream and what waits on it, with the edges between them', () => {
    const container = renderDependencies();

    fireEvent.pointerOver(nodeOf(container, '2'));

    expect(container.querySelector('.bridge-dependency-canvas')?.hasAttribute('data-lineage-shown')).toBe(true);
    expect(litTicketIds(container)).toEqual(['1', '2', '4']);
    expect([...container.querySelectorAll('.bridge-dependency-edge[data-lit]')].map((edge) => `${edge.getAttribute('data-from')}>${edge.getAttribute('data-to')}`).sort())
      .toEqual(['1>2', '2>4']);
  });

  test('switches to a neighbour’s lineage at once, and clears only after the grace once the pointer leaves', async () => {
    const container = renderDependencies();
    fireEvent.pointerOver(nodeOf(container, '2'));
    fireEvent.pointerOver(nodeOf(container, '3'));
    expect(litTicketIds(container)).toEqual(['1', '3']);

    const canvas = container.querySelector('.bridge-dependency-canvas');
    if (canvas === null) throw new Error('no canvas');
    fireEvent.pointerOut(nodeOf(container, '3'), { relatedTarget: document.body });
    expect(litTicketIds(container)).toEqual(['1', '3']);

    await act(() => new Promise((resolve) => setTimeout(resolve, LINEAGE_CLEAR_GRACE_MILLISECONDS * 2)));

    expect(litTicketIds(container)).toEqual([]);
    expect(canvas.hasAttribute('data-lineage-shown')).toBe(false);
  });
});
