/**
 * Each setting hands back the value it replaced and logs exactly one record, and a dispatcher write without a run id deletes the stored
 * one, which would otherwise be resumed wrongly.
 */
import { expect, test } from 'bun:test';

import { boardFixture, taskFixture } from '../../testing/BoardFixtures';
import type { ViewRange }            from './@types/ProgressFile';
import { DEFAULT_DISPATCHER_STATE }  from './constants/DispatcherStates';

const CHANGED_AT = '2026-09-18T20:40:00+02:00';

const EXAMPLE_VIEW: ViewRange = {
  kind:        'relative',
  from:        '-2h',
  to:          'now',
  tickMinutes: 15,
};

test('a tracker that never set a dispatcher state reads the default one', () => {
  const { board, progress } = boardFixture();
  expect(progress.dispatcherState).toBeUndefined();
  expect(board.dispatcherState()).toBe(DEFAULT_DISPATCHER_STATE);
});

test('setting the dispatcher state hands back the state before, stores the run id given and logs one record', () => {
  const { board, progress, records } = boardFixture();
  const changed                      = board.setDispatcherState('running', 'example-run', CHANGED_AT);

  expect(changed.previousState).toBe(DEFAULT_DISPATCHER_STATE);
  expect(progress.dispatcherState).toBe('running');
  expect(progress.dispatcherRunId).toBe('example-run');
  expect(records).toEqual([{ at: CHANGED_AT, kind: 'dispatcher-set', fields: { state: 'running', runId: 'example-run' } }]);
  expect(changed.logged).toEqual(records);
});

// A stored run id outliving the run it named would be resumed by the next orchestrator, so no write may leave it behind.
test('a state written without a run id deletes the stored one', () => {
  const { board, progress } = boardFixture();
  board.setDispatcherState('running', 'example-run', CHANGED_AT);
  const changed = board.setDispatcherState('finished', null, CHANGED_AT);

  expect(changed.previousState).toBe('running');
  expect(progress.dispatcherState).toBe('finished');
  expect('dispatcherRunId' in progress).toBe(false);
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
