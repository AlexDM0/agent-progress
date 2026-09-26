/**
 * How many agents the in-progress rows amount to, against which limit. What callers rely on: a slot is an agent rather than a row, so the
 * rows one claim started count once and a row with no key counts alone; the limit reads the default or the ceiling; no free slot count
 * goes below zero.
 */
import { expect, test } from 'bun:test';

import type { Task }                                                          from '../@types/Task';
import { CONCURRENCY_LIMIT_CEILING_AGENTS, DEFAULT_CONCURRENCY_LIMIT_AGENTS } from '../constants/ConcurrencyLimits';
import { ConcurrencyUtil }                                                    from './ConcurrencyUtil';
import { TaskFilingUtil, type TaskFiling }                                    from './TaskFilingUtil';
import { TaskTransitionUtil }                                                 from './TaskTransitionUtil';

const { agentsInFlightOf, concurrencyOf } = ConcurrencyUtil;

const STARTED_AT  = '2026-09-18T20:40:00+02:00';
const FINISHED_AT = '2026-09-18T21:05:00+02:00';

const BUNDLE_AGENT_KEY  = '003,004,005';
const BUNDLE_PART_NAMES = ['Bundle part one', 'Bundle part two', 'Bundle part three'];

function rowsFiled(filings: readonly TaskFiling[]): Task[] {
  return filings.map((filing, index) => TaskFilingUtil.filedTaskOf(index + 1, filing));
}

function inProgressFilingOf(name: string): TaskFiling {
  return { name, status: 'in-progress', start: STARTED_AT };
}

function claimedBy(agentKey: string, task: Task): Task {
  return { ...task, agent: agentKey };
}

test('only in-progress rows are in flight, and the free slots never go below zero', () => {
  const tasks = rowsFiled([
    { name: 'Review pass one', status: 'in-progress', start: STARTED_AT },
    { name: 'Review pass two', status: 'in-progress', start: STARTED_AT },
    { name: 'Paused chore', status: 'paused', start: STARTED_AT },
    { name: 'Queued chore' },
  ]);
  expect(concurrencyOf(tasks, 1)).toEqual({ limit: 1, agentsInFlight: 2, freeSlots: 0 });
});

// A slot is an agent: three rows one claim started are one agent, and a row with no key beside them is another.
test('in-progress rows sharing an agent key count once, and an in-progress row with no key counts on its own', () => {
  const bundleRows = rowsFiled(BUNDLE_PART_NAMES.map(inProgressFilingOf)).map((row) => claimedBy(BUNDLE_AGENT_KEY, row));
  const reviewPass = TaskFilingUtil.filedTaskOf(bundleRows.length + 1, inProgressFilingOf('Review pass'));

  expect(concurrencyOf([...bundleRows, reviewPass], 2)).toEqual({ limit: 2, agentsInFlight: 2, freeSlots: 0 });
});

// The builder finishes and hands off one ticket at a time, and the slot stays held until its last row stops.
test('a bundle whose rows finish one at a time counts as one agent until its last row stops running', () => {
  const tasks = rowsFiled(BUNDLE_PART_NAMES.map(inProgressFilingOf)).map((row) => claimedBy(BUNDLE_AGENT_KEY, row));

  const agentsInFlightAfterEachFinish = tasks.map((row, index) => {
    tasks[index] = TaskTransitionUtil.transitionedTaskOf(row, 'in-review', FINISHED_AT);
    return agentsInFlightOf(tasks);
  });

  expect(agentsInFlightAfterEachFinish).toEqual([1, 1, 0]);
});

// Every tracker filed before the limit existed stores none, and must still read a limit that lets a claim through.
test('a tracker that never stored a limit reads the default one', () => {
  expect(concurrencyOf([], undefined)).toEqual({ limit: DEFAULT_CONCURRENCY_LIMIT_AGENTS, agentsInFlight: 0, freeSlots: DEFAULT_CONCURRENCY_LIMIT_AGENTS });
});

// An older tracker may hold a limit the `concurrency` command would now refuse; it reads as the ceiling rather than failing.
test('a stored limit above the ceiling reads as the ceiling', () => {
  expect(concurrencyOf([], CONCURRENCY_LIMIT_CEILING_AGENTS + 1).limit).toBe(CONCURRENCY_LIMIT_CEILING_AGENTS);
});
