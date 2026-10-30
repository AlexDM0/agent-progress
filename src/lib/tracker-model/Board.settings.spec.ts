/**
 * Each setting hands back the value it replaced and logs exactly one record, and a dispatcher write without a run id deletes the stored
 * one, which would otherwise be resumed wrongly, as a cleared check command deletes its key.
 */
import { expect, test } from 'bun:test';

import { boardFixture, taskFixture } from '../../testing/BoardFixtures.ts';
import type { ViewRange }            from './@types/TrackerProgress.ts';
import { DEFAULT_DISPATCHER_STATE }  from './constants/DispatcherStates.ts';

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

// The record keeps its run id field, null, so a log holding one written by the retired Workflow dispatcher reads beside it.
test('setting the dispatcher state hands back the state before and logs one record with no run id', () => {
  const { board, progress, records } = boardFixture();
  const changed                      = board.setDispatcherState('running', CHANGED_AT);

  expect(changed.previousState).toBe(DEFAULT_DISPATCHER_STATE);
  expect(progress.dispatcherState).toBe('running');
  expect(records).toEqual([{ at: CHANGED_AT, kind: 'dispatcher-set', fields: { state: 'running', runId: null } }]);
  expect(changed.logged).toEqual(records);
});

test('a tracker that never set a check command reads none', () => {
  const { board, progress } = boardFixture();
  expect('checkCommand' in progress).toBe(false);
  expect(board.checkCommand()).toBeUndefined();
});

test('setting the check command hands back the one before, stores the new one and logs one record', () => {
  const { board, progress, records } = boardFixture();
  const changed                      = board.setCheckCommand('bun run example-checks', false, CHANGED_AT);

  expect(changed.previousCheckCommand).toBeNull();
  expect(progress.checkCommand).toBe('bun run example-checks');
  expect(board.checkCommand()).toBe('bun run example-checks');
  expect(records).toEqual([{ at: CHANGED_AT, kind: 'check-command-set', fields: { command: 'bun run example-checks' } }]);
  expect(changed.logged).toEqual(records);
});

// A cleared setting must leave the file as though it had never been set, so a release runs no check rather than an empty one.
test('clearing the check command deletes the stored key and hands back the one it held', () => {
  const { board, progress } = boardFixture();
  board.setCheckCommand('bun run example-checks', false, CHANGED_AT);
  const changed = board.setCheckCommand(null, false, CHANGED_AT);

  expect(changed.previousCheckCommand).toBe('bun run example-checks');
  expect('checkCommand' in progress).toBe(false);
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
