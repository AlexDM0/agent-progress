/**
 * The Progress tab in a happy-dom document. What matters: each row draws its bars where the model places them, through the style prop; the
 * review-rows choice draws a ticket's review rows above it, latest round first, and is stored under the static page's key; the range
 * menu presses Fit by default and the preset chosen, and the chosen range, a custom one included, survives a reload for the same viewer;
 * the wide-titles choice is stored; on a board with epics the rows are grouped under head rows that fold and stay folded across a reload;
 * a tick label near the right edge sits left of its line; a row's label opens its ticket; a planted title shows as text; and the
 * dependencies view follows the chart only on a board where a ticket depends on another.
 */
import {
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

import { PRODUCT_NAMES }           from '../../../src/shared/constants/ProductNames.ts';
import type { ProgressBoardState } from '../../@types/ProgressBoardState.ts';
import { boardPreferenceStoreOf }  from '../../preferences/PreferenceStore.ts';
import {
  exampleProgressBoard,
  exampleProgressEpic,
  exampleProgressTask,
  exampleProgressTicket
} from '../../testing/ProgressBoardFixture.ts';
import { ProgressView } from './ProgressView.tsx';

const PLANTED_NAME = '<img src=x onerror="window.plantedRan = true">';
const BOARD_KEY = `${PRODUCT_NAMES.STORAGE_PREFIX}:example-tracker`;
const REVIEW_ROWS_KEY = `${BOARD_KEY}:review-rows`;

const BOARD = exampleProgressBoard({
  view: {
    kind: 'absolute', from: '2026-09-18T09:00:00+02:00', to: '2026-09-18T13:00:00+02:00', tickMinutes: null
  },
  tasks: [
    exampleProgressTask(1, {
      name: '#5 Build the example', status: 'delivered', ticket: '5', start: '2026-09-18T09:00:00+02:00', end: '2026-09-18T11:00:00+02:00'
    }),
    exampleProgressTask(2, {
      name: 'Review 2 #5', status: 'delivered', reviewOf: '5', start: '2026-09-18T11:00:00+02:00', end: '2026-09-18T11:30:00+02:00'
    }),
    exampleProgressTask(3, {
      name: 'Review 1 #5', status: 'delivered', reviewOf: '5', start: '2026-09-18T11:30:00+02:00', end: '2026-09-18T12:00:00+02:00'
    }),
    exampleProgressTask(4, { name: PLANTED_NAME }),
  ],
  rowFacts:   { 2: { reviewsTaskId: 1 }, 3: { reviewsTaskId: 1 } },
  tickets:    [exampleProgressTicket('5', { status: 'delivered' }), exampleProgressTicket('6', { dependsOn: ['5'] })],
  ticketRows: { 5: { ownTaskId: 1, reviewTaskIds: [2, 3] } },
});

function renderProgress(boardState: ProgressBoardState = BOARD, storedEntries: Iterable<readonly [string, string]> = []) {
  const storage = new Map<string, string>(storedEntries);
  const boardStore = boardPreferenceStoreOf('example-tracker', () => ({
    getItem:    (key) => storage.get(key) ?? null,
    setItem:    (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  }));
  const rendered = render(
    <ProgressView boardState={boardState} boardStore={boardStore} nowEpochMilliseconds={Date.parse('2026-09-18T13:00:00+02:00')} todayCalendarDate="2026-09-18" />,
  );
  return { storage, container: rendered.container };
}

function rowTaskIds(container: HTMLElement): (string | null)[] {
  return [...container.querySelectorAll('.bridge-progress-rows .bridge-progress-row')].map((row) => row.getAttribute('data-task-id'));
}

function openMenu(name: string): void {
  fireEvent.click(screen.getByRole('button', { name }));
}

function rangeButton(): HTMLElement {
  return screen.getByRole('button', { name: /▾$/ });
}

afterEach(cleanup);

describe('the chart', () => {
  test('draws each bar where the model places it, through the style prop', () => {
    const { container } = renderProgress();
    const ownBar = container.querySelector('[data-task-id="1"] .bridge-progress-bar') as HTMLElement | null;

    expect(ownBar?.style.left).toBe('0%');
    expect(ownBar?.style.width).toBe('50%');
    expect(container.querySelectorAll('[data-task-id="1"] .bridge-progress-bar[data-review-pass]')).toHaveLength(2);
    expect(container.querySelector('.bridge-progress-now')).not.toBeNull();
  });

  test('links a row’s label to its ticket’s detail panel', () => {
    renderProgress();

    expect(screen.getByRole('link', { name: '#5' }).getAttribute('href')).toBe('#tickets/5');
  });

  test('shows a planted name as text', () => {
    renderProgress();

    expect(screen.getByText(PLANTED_NAME)).not.toBeNull();
    expect((window as { plantedRan?: boolean }).plantedRan).toBeUndefined();
  });
});

describe('the review-rows choice', () => {
  test('draws the review rows above their ticket, latest round first, and stores the choice under the static page’s key', () => {
    const { container, storage } = renderProgress();
    expect(rowTaskIds(container)).toEqual(['4', '1']);

    openMenu('Row options');
    fireEvent.click(screen.getByRole('button', { name: 'Review passes as rows' }));

    expect(rowTaskIds(container)).toEqual(['4', '2', '3', '1']);
    expect(container.querySelector('[data-task-id="2"]')?.getAttribute('data-review-of')).toBe('5');
    expect(storage.get(REVIEW_ROWS_KEY)).toBe('rows');
  });

  test('reads a stored choice', () => {
    const { container } = renderProgress(BOARD, [[REVIEW_ROWS_KEY, 'rows']]);

    expect(rowTaskIds(container)).toEqual(['4', '2', '3', '1']);
  });
});

describe('the range menu', () => {
  test('presses Fit by default and the preset chosen, closing the menu and naming the preset on its button', () => {
    renderProgress();
    expect(rangeButton().textContent).toBe('Fit ▾');
    openMenu('Fit ▾');
    expect(screen.getByRole('button', { name: 'Fit' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: '4h' }));

    expect(rangeButton().textContent).toBe('4h ▾');
    expect(screen.queryByRole('button', { name: 'Fit' })).toBeNull();
    openMenu('4h ▾');
    expect(screen.getByRole('button', { name: '4h' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Fit' }).getAttribute('aria-pressed')).toBe('false');
  });

  test('keeps the chosen range across a reload for the same viewer, under the static page\'s key', () => {
    const { storage } = renderProgress();
    openMenu('Fit ▾');
    fireEvent.click(screen.getByRole('button', { name: '4h' }));
    expect(storage.get(BOARD_KEY)).toBe('{"presetKey":"4h","fromText":"-4h","toText":"now","tickMinutes":null}');
    cleanup();

    renderProgress(BOARD, storage);

    expect(rangeButton().textContent).toBe('4h ▾');
  });

  test('applies a custom range from its popover, which survives a reload as Custom', () => {
    const { storage } = renderProgress();
    openMenu('Fit ▾');
    fireEvent.click(screen.getByRole('button', { name: 'Custom…' }));
    const popover = screen.getByRole('dialog', { name: 'Custom range' });
    fireEvent.change(screen.getByRole('textbox', { name: /From/ }), { target: { value: '-90m' } });
    fireEvent.click(screen.getByRole('button', { name: '15m' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(popover.isConnected).toBe(false);
    expect(document.activeElement).toBe(rangeButton());
    expect(JSON.parse(storage.get(BOARD_KEY) ?? 'null')).toEqual({
      presetKey: null, fromText: '-90m', toText: 'now', tickMinutes: 15
    });
    cleanup();

    renderProgress(BOARD, storage);
    expect(rangeButton().textContent).toBe('Custom ▾');
  });
});

test('stores the wide-titles choice and marks the view with it', () => {
  const { storage, container } = renderProgress();
  openMenu('Row options');
  fireEvent.click(screen.getByRole('button', { name: 'Wide titles' }));

  expect(container.querySelector('.bridge-progress-view')?.getAttribute('data-name-column')).toBe('wide');
  expect(storage.get(`${BOARD_KEY}:name-column`)).toBe('wide');
});

describe('the epic grouping', () => {
  const EPIC_BOARD = exampleProgressBoard({
    tasks: [
      exampleProgressTask(1, { ticket: '5', start: '2026-09-18T09:00:00+02:00' }),
      exampleProgressTask(2, { start: '2026-09-18T10:00:00+02:00' }),
    ],
    tickets: [exampleProgressTicket('5', { epics: ['checkout'] })],
    epics:   [exampleProgressEpic('checkout', { title: 'Checkout redesign', ticketIds: ['5'], ticketCountByStatus: { pending: 1 } })],
  });

  test('draws the rows under their epic\'s head and No epic, and folds a group across a reload', () => {
    const { container, storage } = renderProgress(EPIC_BOARD);
    expect(rowTaskIds(container)).toEqual([null, '1', null, '2']);

    fireEvent.click(screen.getByRole('button', { name: /Checkout redesign/ }));

    expect(rowTaskIds(container)).toEqual([null, null, '2']);
    expect(screen.getByRole('button', { name: /Checkout redesign/ }).getAttribute('aria-expanded')).toBe('false');
    expect(storage.get(`${BOARD_KEY}:progress-folded-epics`)).toBe('["checkout"]');
    cleanup();

    expect(rowTaskIds(renderProgress(EPIC_BOARD, storage).container)).toEqual([null, null, '2']);
  });

  test('folds and unfolds a head from the keyboard', () => {
    const { container } = renderProgress(EPIC_BOARD);
    fireEvent.keyDown(screen.getByRole('button', { name: /No epic/ }), { key: 'Enter' });
    expect(rowTaskIds(container)).toEqual([null, '1', null]);

    fireEvent.keyDown(screen.getByRole('button', { name: /No epic/ }), { key: ' ' });
    expect(rowTaskIds(container)).toEqual([null, '1', null, '2']);
  });
});

test('moves a tick label near the right edge to the left of its line', () => {
  const { container } = renderProgress();
  const ticks = [...container.querySelectorAll('.bridge-progress-tick')];

  expect(ticks.at(0)?.hasAttribute('data-label-side')).toBe(false);
  expect(ticks.at(-1)?.getAttribute('data-label-side')).toBe('left');
});

test('follows the chart with the dependencies view only where a ticket depends on another', () => {
  expect(renderProgress().container.querySelector('.bridge-dependencies')).not.toBeNull();
  cleanup();

  const withoutDependencies = exampleProgressBoard({ tickets: [exampleProgressTicket('5')] });
  expect(renderProgress(withoutDependencies).container.querySelector('.bridge-dependencies')).toBeNull();
});
