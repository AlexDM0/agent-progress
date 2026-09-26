/**
 * The migration replaces the retired task words on copies, so the parsed document a caller holds is never changed under it; current words
 * and every other key, unknown ones included, come through as they were, in their order.
 */
import { expect, test } from 'bun:test';

import { documentInRetiredWords }    from '../../../testing/ProgressFileFixtures.ts';
import type { StoredTask }           from '../@types/StoredProgressFile.ts';
import { ProgressFileMigrationUtil } from './ProgressFileMigrationUtil.ts';

test('running and finished come back as in-progress and in-review, in the row and in its history', () => {
  const migrated = ProgressFileMigrationUtil.tasksInCurrentWords(documentInRetiredWords().tasks);
  expect(migrated.map((task) => task.status)).toEqual(['in-progress', 'in-review']);
  expect(migrated.map((task) => task.history?.map((phase) => phase.status))).toEqual([['pending', 'in-progress'], ['in-progress', 'in-review']]);
});

test('the tasks and history arrays handed in are left exactly as they were', () => {
  const stored               = documentInRetiredWords().tasks;
  const storedBeforeMigrating = structuredClone(stored);
  const migrated             = ProgressFileMigrationUtil.tasksInCurrentWords(stored);

  expect(stored).toEqual(storedBeforeMigrating);
  expect(migrated[0]).not.toBe(stored[0]);
  expect(migrated[0]?.history).not.toBe(stored[0]?.history);
});

test('a key the tool does not know survives on a row and on a phase, in the order the file had', () => {
  const storedRow = JSON.parse(`{
    "id": 1, "name": "Example build", "status": "running", "unknownRowKey": "kept", "start": null, "end": null, "owner": "", "note": "",
    "ticket": null, "tokens": null, "history": [{ "status": "running", "unknownPhaseKey": "kept", "at": "2026-09-18T20:40:00+02:00" }]
  }`) as StoredTask;

  const [migrated] = ProgressFileMigrationUtil.tasksInCurrentWords([storedRow]);
  expect(Object.keys(migrated ?? {})).toEqual(Object.keys(storedRow));
  expect(Object.keys(migrated?.history?.[0] ?? {})).toEqual(['status', 'unknownPhaseKey', 'at']);
});

test('a row without history is not given one', () => {
  const [storedRow] = documentInRetiredWords().tasks;
  if (storedRow === undefined) throw new Error('expected a stored row');
  const withoutHistory: StoredTask = { ...storedRow };
  delete withoutHistory.history;
  const [migrated] = ProgressFileMigrationUtil.tasksInCurrentWords([withoutHistory]);
  expect(migrated === undefined ? [] : Object.keys(migrated)).not.toContain('history');
});
