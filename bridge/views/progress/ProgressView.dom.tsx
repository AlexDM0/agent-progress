/**
 * The Progress tab in a happy-dom document. What matters: each row draws its bars where the model places them, through the style prop; the
 * review-rows choice draws a ticket's review rows above it, latest round first, and is stored under the static page's key; a range preset
 * is pressed and Fit is the default; a row's label opens its ticket; a planted title shows as text; and the dependencies view follows the
 * chart only on a board where a ticket depends on another.
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

import { PRODUCT_NAMES }                                                    from '../../../src/shared/constants/ProductNames.ts';
import type { ProgressBoardState }                                          from '../../@types/ProgressBoardState.ts';
import { boardPreferenceStoreOf }                                           from '../../preferences/PreferenceStore.ts';
import { exampleProgressBoard, exampleProgressTask, exampleProgressTicket } from '../../testing/ProgressBoardFixture.ts';
import { ProgressView }                                                     from './ProgressView.tsx';

const PLANTED_NAME = '<img src=x onerror="window.plantedRan = true">';
const REVIEW_ROWS_KEY = `${PRODUCT_NAMES.STORAGE_PREFIX}:example-tracker:review-rows`;

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

function renderProgress(boardState: ProgressBoardState = BOARD, storedEntries: readonly [string, string][] = []) {
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

    fireEvent.click(screen.getByRole('checkbox', { name: 'Review rows' }));

    expect(rowTaskIds(container)).toEqual(['4', '2', '3', '1']);
    expect(container.querySelector('[data-task-id="2"]')?.getAttribute('data-review-of')).toBe('5');
    expect(storage.get(REVIEW_ROWS_KEY)).toBe('rows');
  });

  test('reads a stored choice', () => {
    const { container } = renderProgress(BOARD, [[REVIEW_ROWS_KEY, 'rows']]);

    expect(rowTaskIds(container)).toEqual(['4', '2', '3', '1']);
  });
});

test('presses Fit by default and the preset chosen', () => {
  renderProgress();
  expect(screen.getByRole('button', { name: 'Fit' }).getAttribute('aria-pressed')).toBe('true');

  fireEvent.click(screen.getByRole('button', { name: '4h' }));

  expect(screen.getByRole('button', { name: '4h' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('button', { name: 'Fit' }).getAttribute('aria-pressed')).toBe('false');
});

test('follows the chart with the dependencies view only where a ticket depends on another', () => {
  expect(renderProgress().container.querySelector('.bridge-dependencies')).not.toBeNull();
  cleanup();

  const withoutDependencies = exampleProgressBoard({ tickets: [exampleProgressTicket('5')] });
  expect(renderProgress(withoutDependencies).container.querySelector('.bridge-dependencies')).toBeNull();
});
