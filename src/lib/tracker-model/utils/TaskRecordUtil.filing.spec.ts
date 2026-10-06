/**
 * What a new row looks like. What callers rely on: the defaults of a fresh row, `null` tokens rather than `0`, a first phase only when the
 * filing says when it happened, and the optional fields written only when given, in the key order `progress.json` stores.
 */
import { expect, test } from 'bun:test';

import { TaskFilingUtil } from './TaskFilingUtil.ts';

const { filedTaskOf } = TaskFilingUtil;

const FILED_AT    = '2026-09-18T20:11:03+02:00';
const STARTED_AT  = '2026-09-18T20:40:00+02:00';
const FINISHED_AT = '2026-09-18T21:05:00+02:00';

test('a task filed with nothing but a name gets the defaults a fresh row has', () => {
  expect(filedTaskOf(1, { name: 'Review pass' })).toEqual({
    id:     1,
    name:   'Review pass',
    status: 'pending',
    start:  null,
    end:    null,
    owner:  '',
    note:   '',
    ticket: null,
    tokens: null,
  });
});

test('a task filed with everything keeps everything', () => {
  const task = filedTaskOf(1, {
    name:   'Double-click a role to edit it',
    owner:  'Alex Example',
    note:   'driven by ticket 003',
    ticket: '003',
    status: 'in-progress',
    start:  STARTED_AT,
    end:    null,
  });
  expect(task.ticket).toBe('003');
  expect(task.status).toBe('in-progress');
  expect(task.start).toBe(STARTED_AT);
});

/**
 * How long a row sat in the queue before anybody picked it up is the interval an orchestrator most wants, and it is
 * measurable only if the filing is a phase of its own. Without a stamp to file it at there is still nothing to record.
 */
test('a row filed as pending records that it was filed, at the moment it was filed', () => {
  expect(filedTaskOf(1, { name: 'Queued', filedAt: FILED_AT }).history).toEqual([{ status: 'pending', at: FILED_AT }]);
  expect(filedTaskOf(2, { name: 'Queued explicitly', status: 'pending', filedAt: FILED_AT }).history).toEqual([{ status: 'pending', at: FILED_AT }]);
  expect(filedTaskOf(3, { name: 'Filed by a caller that said nothing' }).history).toBeUndefined();
});

// A row filed straight into a later status was in that status from the stamp it was filed with; without a stamp there is nothing to record.
test('a row filed into a status it is already in records that as its first phase, at the stamp that status is kept at', () => {
  const running = filedTaskOf(1, {
    name: 'Already going', status: 'in-progress', start: STARTED_AT, end: FINISHED_AT
  });
  const closed  = filedTaskOf(2, {
    name: 'Filed closed', status: 'reviewed', start: STARTED_AT, end: FINISHED_AT
  });

  expect(running.history, 'an in-progress row opened its interval at its start, whatever end it was handed').toEqual([{ status: 'in-progress', at: STARTED_AT }]);
  expect(closed.history, 'the row reached that status when it closed, not when it opened').toEqual([{ status: 'reviewed', at: FINISHED_AT }]);
  expect(filedTaskOf(3, { name: 'No stamp at all', status: 'in-progress' }).history).toBeUndefined();
});

// Every row filed before these fields existed has none of them, so a row that was not given one must not gain the key either.
test('reviewed, reviewRound, reviewOf and reviewBarRound are written only when given, after tokens and around the history as the file stores them', () => {
  const rowKeys = ['id', 'name', 'status', 'start', 'end', 'owner', 'note', 'ticket', 'tokens'];
  const plain   = filedTaskOf(1, { name: 'Review 1 #003 — Example ticket' });
  const full    = filedTaskOf(2, {
    name:           'Review 3 #003 — Example ticket',
    status:         'reviewed',
    end:            FINISHED_AT,
    reviewed:       FINISHED_AT,
    reviewRound:    3,
    reviewOf:       '003',
    reviewBarRound: 2,
  });

  expect(Object.keys(plain)).toEqual(rowKeys);
  expect(Object.keys(full)).toEqual([...rowKeys, 'reviewed', 'reviewRound', 'history', 'reviewOf', 'reviewBarRound']);
  expect(full).toMatchObject({
    reviewed:       FINISHED_AT,
    reviewRound:    3,
    reviewOf:       '003',
    reviewBarRound: 2,
  });
});
