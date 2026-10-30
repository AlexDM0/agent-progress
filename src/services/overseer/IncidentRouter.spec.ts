/**
 * The Overseer's incident routing outside the policy. What matters: a running build or review whose event cursor stands still for
 * `QUIET_JOB_SWEEPS` sweeps opens one `quiet-job` incident, a count and never a clock, while a moving cursor or a job waiting on an answer
 * never does; and the defaults taken since the Overseer last started are the warning state `jobs` and the Overseer's notices show.
 */
import { describe, expect, test } from 'bun:test';

import type { Job }                    from '../../lib/tracker-model/@types/Job.ts';
import type { LogRecord }              from '../../lib/tracker-model/@types/LogRecord.ts';
import { QUIET_JOB_SWEEPS }            from '../../shared/constants/OverseerLimits.ts';
import { boardFixture, ticketFixture } from '../../testing/BoardFixtures.ts';
import { IncidentRouter }              from './IncidentRouter.ts';

const FIXTURE_AT = '2026-10-28T10:00:00+01:00';

function jobFixture(overrides: Partial<Job> & Pick<Job, 'id'>): Job {
  return {
    kind:               'build',
    role:               'builder',
    ticketIds:          [],
    parentJobId:        null,
    attempt:            1,
    target:             'main',
    state:              'running',
    watcherInstance:    1,
    eventCursor:        { instance: 1, sequence: 0 },
    answeredRequestIds: [],
    crashResumes:       0,
    ...overrides,
  };
}

const QUIET_BUILD = jobFixture({ id: 'J1', ticketIds: ['001'] });

function sweepsUntilDue(jobs: readonly ReturnType<typeof jobFixture>[][], quietSweeps: number): number | null {
  const watch = IncidentRouter.createQuietJobWatch(quietSweeps);
  for (const [i, sweepJobs] of jobs.entries()) {
    if (watch.sweep(sweepJobs).length > 0) return i;
  }
  return null;
}

describe('the quiet-job watch', () => {
  test(`a running build whose cursor stands still is due on the ${QUIET_JOB_SWEEPS}th sweep after the first, and counts again from there`, () => {
    const watch = IncidentRouter.createQuietJobWatch(QUIET_JOB_SWEEPS);
    const dueAt = Array.from({ length: (2 * QUIET_JOB_SWEEPS) + 2 }, () => watch.sweep([QUIET_BUILD]).length > 0)
      .flatMap((due, i) => (due ? [i] : []));
    expect(dueAt).toEqual([QUIET_JOB_SWEEPS, 2 * QUIET_JOB_SWEEPS]);
  });

  test('a job\'s silent sweeps count each still sweep, fall to 0 when its cursor moves or it comes due, and are 0 for an unwatched job', () => {
    const watch = IncidentRouter.createQuietJobWatch(QUIET_JOB_SWEEPS);
    watch.sweep([QUIET_BUILD]);
    watch.sweep([QUIET_BUILD]);
    expect(watch.silentSweepsOf(QUIET_BUILD.id)).toBe(1);
    watch.sweep([{ ...QUIET_BUILD, eventCursor: { instance: 1, sequence: 99 } }]);
    expect(watch.silentSweepsOf(QUIET_BUILD.id)).toBe(0);
    expect(watch.silentSweepsOf('J404')).toBe(0);
  });

  test('a cursor that moves, or a job waiting for an answer, is never due', () => {
    const moving = Array.from({ length: 10 }, (_unused, i) => [jobFixture({ id: 'J1', eventCursor: { instance: 1, sequence: i } })]);
    expect(sweepsUntilDue(moving, 2)).toBeNull();
    expect(sweepsUntilDue(Array.from({ length: 10 }, () => [{ ...QUIET_BUILD, state: 'waiting-for-answer' as const }]), 2)).toBeNull();
  });

  test('opens one quiet-job incident whose default asks User, and none while one is open for the job', () => {
    const { board } = boardFixture({ tickets: [ticketFixture({ id: '001', status: 'in-progress' })] });
    board.launchJob({
      kind: 'build', role: 'builder', ticketIds: ['001'], parentJobId: null, attempt: 1, target: 'main'
    }, FIXTURE_AT);
    board.moveJob('J1', 'running', FIXTURE_AT);
    IncidentRouter.openQuietJobIncidents(board, ['J1'], QUIET_JOB_SWEEPS, FIXTURE_AT);
    IncidentRouter.openQuietJobIncidents(board, ['J1'], QUIET_JOB_SWEEPS, FIXTURE_AT);
    expect(board.incidents()).toMatchObject([{
      kind: 'quiet-job', jobId: 'J1', ticketIds: ['001'], defaultMove: 'open-quiet-job-decision'
    }]);
  });
});

describe('defaultedIncidentsOf', () => {
  test('lists the defaults since the latest runner start only', () => {
    const records: LogRecord[] = [
      {
        at: FIXTURE_AT, kind: 'incident-defaulted', incidentId: 'I1', fields: { move: 'ticket-park', cause: 'turn-closed' }
      },
      { at: FIXTURE_AT, kind: 'overseer-started', fields: { generation: 2, codeVersion: 'a1b2c3d', pid: 10 } } as unknown as LogRecord,
      {
        at: FIXTURE_AT, kind: 'incident-defaulted', incidentId: 'I2', fields: { move: 'merge-abort', cause: 'no-assistant' }
      },
    ];
    expect(IncidentRouter.defaultedIncidentsOf(records)).toEqual([{
      incidentId: 'I2', move: 'merge-abort', cause: 'no-assistant', at: FIXTURE_AT
    }]);
  });
});
