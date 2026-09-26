/** A new tracker's state: the caller's id and names, an automatic view, the default limit, and an unused id counter. */
import { expect, test } from 'bun:test';

import { EmptyProgressUtil } from './EmptyProgressUtil.ts';

const STARTED_AT = '2026-09-18T20:11:03+02:00';

test('a new tracker starts with the caller\'s id, an automatic view and an unused id counter', () => {
  const progress = EmptyProgressUtil.emptyProgressFor({ project: 'Example Agency', startedAt: STARTED_AT, trackerId: 'example-tracker-id' });
  expect(progress.trackerId).toBe('example-tracker-id');
  expect(progress.project).toBe('Example Agency');
  expect(progress.startedAt).toBe(STARTED_AT);
  expect(progress.view).toEqual({ kind: 'auto' });
  expect(progress.nextTaskId).toBe(1);
  expect(progress.concurrencyLimit).toBe(2);
  expect(progress.tasks).toEqual([]);
});

test('its keys come in the order a fresh progress.json stores them', () => {
  const progress = EmptyProgressUtil.emptyProgressFor({ project: 'Example Agency', startedAt: STARTED_AT, trackerId: 'example-tracker-id' });
  expect(Object.keys(progress)).toEqual(['trackerId', 'project', 'startedAt', 'view', 'nextTaskId', 'concurrencyLimit', 'tasks']);
});
