/**
 * What a move does to a row. What callers rely on: a stamp already written is never moved, a phase is filed only for a real move (every
 * review round excepted), a restart drops the claim's agent key while a resumed pause keeps it, the record handed in is left untouched,
 * and the keys of the new record sit where `progress.json` has always stored them.
 */
import { expect, test } from 'bun:test';

import type { Task, TaskStatus }           from '../@types/Task';
import { TaskFilingUtil, type TaskFiling } from './TaskFilingUtil';
import { TaskTransitionUtil }              from './TaskTransitionUtil';

const { transitionedTaskOf } = TaskTransitionUtil;

const FILED_AT        = '2026-09-18T20:11:03+02:00';
const STARTED_AT      = '2026-09-18T20:40:00+02:00';
const FINISHED_AT     = '2026-09-18T21:05:00+02:00';
const RESTARTED_AT    = '2026-09-18T21:30:00+02:00';
const NEXT_MORNING_AT = '2026-09-19T09:00:00+02:00';
const DELIVERED_AT    = '2026-09-19T10:00:00+02:00';

const EXAMPLE_ROW_ID = 1;

function filed(filing: TaskFiling): Task {
  return TaskFilingUtil.filedTaskOf(EXAMPLE_ROW_ID, filing);
}

function movedThrough(task: Task, moves: ReadonlyArray<readonly [TaskStatus, string]>): Task {
  return moves.reduce((current, [status, at]) => transitionedTaskOf(current, status, at), task);
}

// A reopened bundle ticket started again by hand must not rejoin the agent its old bundle still runs under.
test('a row that starts running anew drops its agent key, and a resumed pause keeps it', () => {
  const restarted = {
    ...filed({
      name:   'Restarted part',
      status: 'in-review',
      start:  STARTED_AT,
      end:    FINISHED_AT,
    }),
    agent: '003,004',
  };
  const resumed = { ...filed({ name: 'Resumed part', status: 'paused', start: STARTED_AT }), agent: '003,004' };

  expect(transitionedTaskOf(restarted, 'in-progress', FINISHED_AT).agent).toBeUndefined();
  expect(transitionedTaskOf(resumed, 'in-progress', FINISHED_AT).agent).toBe('003,004');
});

test('starting a task sets its start and clears any end it had', () => {
  const task = filed({
    name: 'Review pass', status: 'in-review', start: STARTED_AT, end: FINISHED_AT
  });
  const started = transitionedTaskOf(task, 'in-progress', RESTARTED_AT);
  expect(started.start).toBe(STARTED_AT);
  expect(started.end).toBeNull();
  expect(started.status).toBe('in-progress');
});

test('pausing keeps the start and clears the end, and starting again resumes the same bar', () => {
  const paused = transitionedTaskOf(filed({ name: 'Waiting on the user', status: 'in-progress', start: STARTED_AT }), 'paused', FINISHED_AT);
  expect(paused.status).toBe('paused');
  expect(paused.start).toBe(STARTED_AT);
  expect(paused.end).toBeNull();

  const resumed = transitionedTaskOf(paused, 'in-progress', RESTARTED_AT);
  expect(resumed.start).toBe(STARTED_AT);
  expect(resumed.end).toBeNull();
});

test('pausing a task that never ran stamps its start, so the bar is drawn from the pause', () => {
  const paused = transitionedTaskOf(filed({ name: 'Blocked before it began' }), 'paused', STARTED_AT);
  expect(paused.start).toBe(STARTED_AT);
  expect(paused.end).toBeNull();
});

test('starting a task that has never run sets its start to the moment given', () => {
  const started = transitionedTaskOf(filed({ name: 'Review pass' }), 'in-progress', STARTED_AT);
  expect(started.start).toBe(STARTED_AT);
  expect(started.end).toBeNull();
});

test('finishing, reviewing and delivering all close the bar and back-fill a missing start', () => {
  for (const status of ['in-review', 'reviewed', 'delivered'] as const) {
    const moved = transitionedTaskOf(filed({ name: `Row taken straight to ${status}` }), status, FINISHED_AT);
    expect(moved.status, status).toBe(status);
    expect(moved.start, status).toBe(FINISHED_AT);
    expect(moved.end, status).toBe(FINISHED_AT);
  }
});

test('a second finish does not quietly extend the bar to now', () => {
  const task = movedThrough(filed({ name: 'Review pass', status: 'in-progress', start: STARTED_AT }), [
    ['in-review', FINISHED_AT],
    ['in-review', NEXT_MORNING_AT],
  ]);
  expect(task.start).toBe(STARTED_AT);
  expect(task.end).toBe(FINISHED_AT);
});

test('abandoning a task that had started closes its bar', () => {
  const task = transitionedTaskOf(filed({ name: 'Review pass', status: 'in-progress', start: STARTED_AT }), 'abandoned', FINISHED_AT);
  expect(task.start).toBe(STARTED_AT);
  expect(task.end).toBe(FINISHED_AT);
  expect(task.status).toBe('abandoned');
});

test('abandoning a task that never started leaves it with no timestamps at all', () => {
  const task = transitionedTaskOf(filed({ name: 'Called off before it began' }), 'abandoned', FINISHED_AT);
  expect(task.start).toBeNull();
  expect(task.end).toBeNull();
  expect(task.status).toBe('abandoned');
});

test('putting a task back to pending clears both timestamps', () => {
  const task = filed({
    name: 'Review pass', status: 'in-review', start: STARTED_AT, end: FINISHED_AT
  });
  const pending = transitionedTaskOf(task, 'pending', NEXT_MORNING_AT);
  expect(pending.start).toBeNull();
  expect(pending.end).toBeNull();
  expect(pending.status).toBe('pending');
});

test('reviewing stamps the review once, and delivery keeps it so the delivered row still says it was reviewed', () => {
  const task = filed({
    name: 'Review pass', status: 'in-review', start: STARTED_AT, end: FINISHED_AT
  });
  const delivered = movedThrough(task, [
    ['reviewed', FINISHED_AT],
    ['reviewed', NEXT_MORNING_AT],
    ['delivered', DELIVERED_AT],
  ]);
  expect(delivered.reviewed).toBe(FINISHED_AT);
});

test('a repeat review counts from the second round upwards and leaves the bar where the first review closed it', () => {
  const task = filed({
    name: 'Review pass', status: 'in-review', start: STARTED_AT, end: FINISHED_AT
  });
  const secondRound = transitionedTaskOf(task, 're-review', NEXT_MORNING_AT);
  expect(secondRound.status).toBe('re-review');
  expect(secondRound.reviewRound).toBe(2);
  expect(secondRound.end).toBe(FINISHED_AT);

  const thirdRound = transitionedTaskOf(secondRound, 're-review', DELIVERED_AT);
  expect(thirdRound.reviewRound).toBe(3);
  expect(thirdRound.end).toBe(FINISHED_AT);
});

test('the round is kept as history once the row is reviewed and delivered', () => {
  const task = filed({
    name: 'Review pass', status: 're-review', start: STARTED_AT, end: FINISHED_AT, reviewRound: 3
  });
  const reviewed = transitionedTaskOf(task, 'reviewed', NEXT_MORNING_AT);
  expect(reviewed.reviewRound).toBe(3);

  expect(transitionedTaskOf(reviewed, 'delivered', DELIVERED_AT).reviewRound).toBe(3);
});

test('putting a row that was on its third pass back to pending drops the round with the review stamp', () => {
  const task = filed({
    name: 'Review pass', status: 're-review', start: STARTED_AT, end: FINISHED_AT, reviewRound: 3
  });
  const pending = transitionedTaskOf(task, 'pending', NEXT_MORNING_AT);
  expect(pending.reviewRound).toBeUndefined();
  expect(pending.status).toBe('pending');
});

test('a task delivered straight from in-review carries no review stamp', () => {
  const task = filed({
    name: 'Review pass', status: 'in-review', start: STARTED_AT, end: FINISHED_AT
  });
  expect(transitionedTaskOf(task, 'delivered', FINISHED_AT).reviewed).toBeUndefined();
});

test('putting a reviewed task back to pending drops its review stamp', () => {
  const task = filed({ name: 'Review pass', status: 'reviewed', reviewed: FINISHED_AT });
  expect(transitionedTaskOf(task, 'pending', NEXT_MORNING_AT).reviewed).toBeUndefined();
});

test('every move a row really makes is appended as a phase, oldest first', () => {
  const task = movedThrough(filed({ name: 'Review pass' }), [
    ['in-progress', STARTED_AT],
    ['in-review', FINISHED_AT],
    ['reviewed', NEXT_MORNING_AT],
  ]);

  expect(task.history).toEqual([
    { status: 'in-progress', at: STARTED_AT },
    { status: 'in-review', at: FINISHED_AT },
    { status: 'reviewed', at: NEXT_MORNING_AT },
  ]);
});

// The re-run that keeps a stamp from moving must not file a second phase either: nothing happened.
test('repeating a move files no second phase, because the row did not move', () => {
  const task = movedThrough(filed({ name: 'Review pass' }), [
    ['in-review', FINISHED_AT],
    ['in-review', NEXT_MORNING_AT],
  ]);

  expect(task.history).toEqual([{ status: 'in-review', at: FINISHED_AT }]);
});

// The one exception: a row stays in `re-review` between rounds, so counting only status changes would lose every round after the second.
test('a further review round is a phase of its own although the status does not change', () => {
  const task = movedThrough(filed({ name: 'Review pass' }), [
    ['in-review', FINISHED_AT],
    ['re-review', NEXT_MORNING_AT],
    ['re-review', DELIVERED_AT],
  ]);

  expect(task.history?.map((phase) => phase.status)).toEqual(['in-review', 're-review', 're-review']);
  expect(task.reviewRound).toBe(3);
});

// The phases are the record of what happened; a row sent back to pending went back, which is itself something that happened.
test('sending a row back to pending files that as a phase and keeps the phases that led there', () => {
  const task = movedThrough(filed({ name: 'Review pass', filedAt: FILED_AT }), [
    ['in-progress', STARTED_AT],
    ['pending', FINISHED_AT],
  ]);

  expect(task.history).toEqual([
    { status: 'pending', at: FILED_AT },
    { status: 'in-progress', at: STARTED_AT },
    { status: 'pending', at: FINISHED_AT },
  ]);
});

// The Board writes the result back into the record its callers hold; an input changed on the way would leave a caller's copy half-moved.
test('returns a new record and leaves the one it was given untouched', () => {
  const task     = { ...filed({ name: 'Review pass', filedAt: FILED_AT }), agent: '003,004' };
  const snapshot = structuredClone(task);

  const moved = transitionedTaskOf(task, 'reviewed', FINISHED_AT);

  expect(moved).not.toBe(task);
  expect(moved.history).not.toBe(task.history);
  expect(task).toEqual(snapshot);
});

// `progress.json` is written with the record's own key order, so a move that reordered keys would rewrite every row it touched.
test('a claimed row keeps its keys in place through its moves, and a restart drops only its agent key', () => {
  const claimed = { ...transitionedTaskOf(filed({ name: 'Bundle part', filedAt: FILED_AT }), 'in-progress', STARTED_AT), agent: '003,004' };
  const storedKeys = ['id', 'name', 'status', 'start', 'end', 'owner', 'note', 'ticket', 'tokens', 'history'];
  expect(Object.keys(claimed)).toEqual([...storedKeys, 'agent']);

  const reviewed = movedThrough(claimed, [['in-review', FINISHED_AT], ['reviewed', NEXT_MORNING_AT]]);
  expect(Object.keys(reviewed)).toEqual([...storedKeys, 'agent', 'reviewed']);

  const restarted = transitionedTaskOf(reviewed, 'in-progress', RESTARTED_AT);
  expect(Object.keys(restarted)).toEqual([...storedKeys, 'reviewed']);

  expect(Object.keys(transitionedTaskOf(restarted, 're-review', DELIVERED_AT))).toEqual([...storedKeys, 'reviewed', 'reviewRound']);
});

// A row filed before phases existed gains its round or review stamp before the history it gains, which is the order a move assigns them in.
test('a row without history gains the review round or the review stamp ahead of its first phase', () => {
  const unstamped = filed({ name: 'Older row' });
  const rowKeys = ['id', 'name', 'status', 'start', 'end', 'owner', 'note', 'ticket', 'tokens'];

  expect(unstamped.history).toBeUndefined();
  expect(Object.keys(transitionedTaskOf(unstamped, 're-review', NEXT_MORNING_AT))).toEqual([...rowKeys, 'reviewRound', 'history']);
  expect(Object.keys(transitionedTaskOf(unstamped, 'reviewed', NEXT_MORNING_AT))).toEqual([...rowKeys, 'reviewed', 'history']);
});
