/**
 * Each setting hands back the value it replaced and logs exactly one record, and a board that never set the runner state reads the
 * default, which starts nothing before the user's go.
 */
import { expect, test } from 'bun:test';

import { boardFixture, taskFixture } from '../../testing/BoardFixtures.ts';
import type { ViewRange }            from './@types/TrackerProgress.ts';
import { DEFAULT_RUNNER_STATE }      from './constants/RunnerStates.ts';

const CHANGED_AT = '2026-09-18T20:40:00+02:00';

const EXAMPLE_VIEW: ViewRange = {
  kind:        'relative',
  from:        '-2h',
  to:          'now',
  tickMinutes: 15,
};

test('a tracker that never set a runner state reads the default one', () => {
  const { board, progress } = boardFixture();
  expect(progress.runnerState).toBeUndefined();
  expect(board.runnerState()).toBe(DEFAULT_RUNNER_STATE);
});

test('setting the runner state hands back the state before and logs one runner-set record', () => {
  const { board, progress, records } = boardFixture();
  const changed                      = board.setRunnerState('running', CHANGED_AT);

  expect(changed.previousState).toBe(DEFAULT_RUNNER_STATE);
  expect(progress.runnerState).toBe('running');
  expect(records).toEqual([{ at: CHANGED_AT, kind: 'runner-set', fields: { state: 'running' } }]);
  expect(changed.logged).toEqual(records);
});

test('setting the concurrency limit hands back the limit before and the concurrency after, and logs one record', () => {
  const { board, progress, records } = boardFixture({
    tasks:            [taskFixture({ id: 1, status: 'in-progress' }), taskFixture({ id: 2, status: 'in-progress' })],
    concurrencyLimit: 2,
  });
  const changed = board.setConcurrencyLimit(5, CHANGED_AT);

  expect(changed.previousLimit).toBe(2);
  expect(progress.concurrencyLimit).toBe(5);
  expect(changed.concurrency).toEqual({ limit: 5, agentsInFlight: 2, freeSlots: 3 });
  expect(records).toEqual([{ at: CHANGED_AT, kind: 'concurrency-limit-set', fields: { limit: 5 } }]);
  expect(changed.logged).toEqual(records);
});

test('setting the chart range stores the view and logs one record', () => {
  const { board, progress, records } = boardFixture();
  const changed                      = board.setChartRange(EXAMPLE_VIEW, CHANGED_AT);

  expect(progress.view).toEqual(EXAMPLE_VIEW);
  expect(records).toEqual([{ at: CHANGED_AT, kind: 'chart-range-set', fields: { view: EXAMPLE_VIEW } }]);
  expect(changed.logged).toEqual(records);
});

test('a note is logged as given and changes nothing else', () => {
  const { board, progress, records } = boardFixture();
  const progressBefore               = structuredClone(progress);
  const changed                      = board.recordNote('  Example note, spaces kept  ', CHANGED_AT);

  expect(records).toEqual([{ at: CHANGED_AT, kind: 'note', fields: { text: '  Example note, spaces kept  ' } }]);
  expect(changed.logged).toEqual(records);
  expect(progress).toEqual(progressBefore);
});
