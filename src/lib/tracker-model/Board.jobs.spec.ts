/**
 * The runner's jobs on the Board. What matters: a job's ids are never reused or gap-filled, since a log line and a host folder name it for
 * good; the record holds what a restart needs and no process identity; every move goes through the one legality table, an illegal one
 * refused `job-move-illegal` from every state; a job is finished only by `job-ended`, after which every move is refused `job-finished`;
 * only the launch, an interruption, a resume and the end are logged; and the merge-queue mark lives on in-review rows only.
 */
import { describe, expect, test } from 'bun:test';

import {
  boardFixture,
  refusalDetailOf,
  taskFixture,
  ticketFixture
} from '../../testing/BoardFixtures.ts';
import type { JobLaunch, JobMoveTarget, JobState } from './@types/Job.ts';
import type { Board }                              from './Board.ts';
import type { SteppedJobState }                    from './Jobs.ts';
import { LEGAL_SOURCE_STATES_FOR_JOB_MOVE }        from './constants/JobMoveLegality.ts';
import { JOB_STATES }                              from './constants/JobStates.ts';

const AT = '2026-09-26T10:15:00+02:00';

const BUILD_LAUNCH: JobLaunch = {
  kind:        'build',
  role:        'builder',
  ticketIds:   ['001'],
  parentJobId: null,
  attempt:     1,
  target:      'main',
};

const MERGE_LAUNCH: JobLaunch = {
  kind:        'merge',
  role:        null,
  ticketIds:   ['001'],
  parentJobId: null,
  attempt:     1,
  target:      'main',
};

/** A path from `launching` to each state, through legal moves only. */
const PATH_TO_STATE: Readonly<Record<JobState, readonly JobMoveTarget[]>> = {
  'launching':          [],
  'preparing':          ['preparing'],
  'running':            ['running'],
  'waiting-for-answer': ['running', 'waiting-for-answer'],
  'interrupted':        ['running', 'interrupted'],
  'awaiting-answer':    ['running', 'interrupted', 'awaiting-answer'],
  'verifying':          ['running', 'verifying'],
  'gating':             ['running', 'verifying', 'gating'],
  'merging':            ['merging'],
  'landing':            ['merging', 'gating', 'landing'],
  'stopping':           ['stopping'],
};

function boardWithTicket(): ReturnType<typeof boardFixture> {
  return boardFixture({ tickets: [ticketFixture({ id: '001', status: 'in-progress' })] });
}

function stepJob(board: Board, jobId: string, target: JobMoveTarget): void {
  if (target === 'interrupted') board.interruptJob(jobId, 'host-lost', AT);
  else if (target === 'ended') board.endJob(jobId, { outcome: 'failed' }, AT);
  else board.moveJob(jobId, target, AT);
}

function jobInState(board: Board, state: JobState): string {
  const { job } = board.launchJob(PATH_TO_STATE[state][0] === 'merging' ? MERGE_LAUNCH : BUILD_LAUNCH, AT);
  for (const target of PATH_TO_STATE[state]) stepJob(board, job.id, target);
  expect(board.jobById(job.id)?.state).toBe(state);
  return job.id;
}

describe('a launch', () => {
  test('stores the job with what a restart reads, and no process identity', () => {
    const { board, records } = boardWithTicket();
    const { job, logged }    = board.launchJob(BUILD_LAUNCH, AT);

    expect(Object.keys(job)).toEqual([
      'id',
      'kind',
      'role',
      'ticketIds',
      'parentJobId',
      'attempt',
      'target',
      'state',
      'hostInstance',
      'eventCursor',
      'answeredRequestIds',
      'crashResumes',
    ]);
    expect(job).toMatchObject({
      id: 'J1', state: 'launching', hostInstance: 1, eventCursor: { instance: 1, sequence: 0 }, answeredRequestIds: []
    });
    expect(board.jobs()).toEqual([job]);
    expect(logged).toEqual(records);
    expect(records.map((record) => record.kind)).toEqual(['job-launched']);
  });

  test('takes the next J number, never one an ended job held and never a gap', () => {
    const { board, progress } = boardFixture();
    board.launchJob(BUILD_LAUNCH, AT);
    board.launchJob(BUILD_LAUNCH, AT);
    board.endJob('J2', { outcome: 'failed' }, AT);

    expect(board.launchJob(BUILD_LAUNCH, AT).job.id).toBe('J3');
    expect(progress.nextJobId).toBe(4);
  });

  test('leaves a board that never launched a job without `jobs` or `nextJobId`', () => {
    const { board, progress } = boardWithTicket();
    expect(refusalDetailOf(() => board.moveJob('J1', 'running', AT))).toEqual({ reason: 'unknown-job', jobId: 'J1' });
    expect(Object.hasOwn(progress, 'jobs')).toBe(false);
    expect(Object.hasOwn(progress, 'nextJobId')).toBe(false);
  });
});

describe('the legality table', () => {
  test('names every state once as a key, beside `ended`', () => {
    expect(Object.keys(LEGAL_SOURCE_STATES_FOR_JOB_MOVE).sort()).toEqual([...JOB_STATES, 'ended'].sort());
  });

  // Written from design section 3.2's job diagram, not from the table, so a wrong entry in the table fails here.
  test('allows from each state exactly the moves the design draws', () => {
    const DESIGNED_TARGETS_FROM_STATE: Readonly<Record<JobState, readonly JobMoveTarget[]>> = {
      'launching':          ['preparing', 'running', 'merging', 'stopping', 'ended'],
      'preparing':          ['running', 'interrupted', 'stopping', 'ended'],
      'running':            ['waiting-for-answer', 'interrupted', 'verifying', 'stopping', 'ended'],
      'waiting-for-answer': ['running', 'interrupted', 'stopping', 'ended'],
      'interrupted':        ['running', 'awaiting-answer', 'stopping', 'ended'],
      'awaiting-answer':    ['running', 'stopping', 'ended'],
      'verifying':          ['gating', 'stopping', 'ended'],
      'gating':             ['awaiting-answer', 'landing', 'stopping', 'ended'],
      'merging':            ['gating', 'stopping', 'ended'],
      'landing':            ['stopping', 'ended'],
      'stopping':           ['interrupted', 'ended'],
    };
    for (const state of JOB_STATES) {
      const allowedTargets = (Object.keys(LEGAL_SOURCE_STATES_FOR_JOB_MOVE) as JobMoveTarget[])
        .filter((target) => LEGAL_SOURCE_STATES_FOR_JOB_MOVE[target].includes(state));
      expect(allowedTargets.sort(), state).toEqual([...DESIGNED_TARGETS_FROM_STATE[state]].sort());
    }
  });

  // Planted from each state: every target the table does not list for it is refused, and nothing changes.
  test.each(JOB_STATES.map((state) => [state]))('from %s, every move the table does not allow is refused job-move-illegal', (state) => {
    const illegalTargets = (Object.keys(LEGAL_SOURCE_STATES_FOR_JOB_MOVE) as JobMoveTarget[])
      .filter((target) => !LEGAL_SOURCE_STATES_FOR_JOB_MOVE[target].includes(state));
    expect(illegalTargets.length).toBeGreaterThan(0);
    for (const target of illegalTargets) {
      const { board } = boardWithTicket();
      const jobId     = jobInState(board, state);
      expect(refusalDetailOf(() => stepJob(board, jobId, target)), `${state} → ${target}`).toEqual({
        reason:      'job-move-illegal',
        jobId,
        state,
        targetState: target,
      });
      expect(board.jobById(jobId)?.state).toBe(state);
    }
  });

  test.each(JOB_STATES.map((state) => [state]))('from %s, every move the table allows is taken', (state) => {
    const legalTargets = (Object.keys(LEGAL_SOURCE_STATES_FOR_JOB_MOVE) as JobMoveTarget[])
      .filter((target) => LEGAL_SOURCE_STATES_FOR_JOB_MOVE[target].includes(state));
    for (const target of legalTargets) {
      const { board } = boardWithTicket();
      const jobId     = jobInState(board, state);
      stepJob(board, jobId, target);
      expect(board.jobById(jobId)?.state, `${state} → ${target}`).toBe(target === 'ended' ? undefined : target);
    }
  });
});

describe('the moves a job logs', () => {
  test('a move between live states logs nothing: the state lives in progress.json', () => {
    const { board, records } = boardWithTicket();
    const { job }            = board.launchJob(BUILD_LAUNCH, AT);
    for (const target of ['preparing', 'running', 'waiting-for-answer', 'running', 'verifying', 'gating'] as const satisfies readonly SteppedJobState[]) {
      expect(board.moveJob(job.id, target, AT).logged).toEqual([]);
    }
    expect(records.map((record) => record.kind)).toEqual(['job-launched']);
  });

  test('an interruption records its cause; the resume spawns the next host instance and counts only a crash', () => {
    const { board, records } = boardWithTicket();
    const { job }            = board.launchJob(BUILD_LAUNCH, AT);
    board.moveJob(job.id, 'running', AT);
    board.interruptJob(job.id, 'reboot', AT);
    board.moveJob(job.id, 'running', AT);
    board.interruptJob(job.id, 'agent-crashed', AT);
    board.moveJob(job.id, 'running', AT);

    expect(board.jobById(job.id)).toMatchObject({ hostInstance: 3, crashResumes: 1, interruption: 'agent-crashed' });
    expect(records.slice(1).map(({ kind, fields }) => [kind, fields])).toEqual([
      ['job-interrupted', { cause: 'reboot', hostInstance: 1 }],
      ['job-resumed', { hostInstance: 2, cause: 'reboot' }],
      ['job-interrupted', { cause: 'agent-crashed', hostInstance: 2 }],
      ['job-resumed', { hostInstance: 3, cause: 'agent-crashed' }],
    ]);
  });

  test('a job awaiting an answer resumes into running in the next host instance', () => {
    const { board } = boardWithTicket();
    const jobId     = jobInState(board, 'awaiting-answer');
    expect(board.moveJob(jobId, 'running', AT).logged.map((record) => record.kind)).toEqual(['job-resumed']);
    expect(board.jobById(jobId)?.hostInstance).toBe(2);
  });
});

describe('the end of a job', () => {
  test('takes it off the board in the same change, hands back its outcome and logs job-ended', () => {
    const { board, progress } = boardWithTicket();
    const { job: launched }   = board.launchJob(BUILD_LAUNCH, AT);
    const { job, logged }     = board.endJob(launched.id, { outcome: 'replaced', deniedPermissions: ['WebFetch'] }, AT);

    expect(job.outcome).toBe('replaced');
    expect(progress.jobs).toEqual([]);
    expect(logged.map(({ kind, fields }) => [kind, fields])).toEqual([['job-ended', { outcome: 'replaced', deniedPermissions: ['WebFetch'] }]]);
  });

  test('a finished job refuses every move, every interruption, every end and every record change job-finished', () => {
    const { board } = boardWithTicket();
    board.launchJob(BUILD_LAUNCH, AT);
    board.endJob('J1', { outcome: 'resolved' }, AT);
    const finished = { reason: 'job-finished', jobId: 'J1' } as const;

    for (const target of Object.keys(LEGAL_SOURCE_STATES_FOR_JOB_MOVE) as JobMoveTarget[]) {
      expect(refusalDetailOf(() => stepJob(board, 'J1', target)), target).toEqual(finished);
    }
    expect(refusalDetailOf(() => board.setJobEventCursor('J1', { instance: 1, sequence: 4 }))).toEqual(finished);
    expect(refusalDetailOf(() => board.addAnsweredRequestId('J1', 'request-1'))).toEqual(finished);
    expect(refusalDetailOf(() => board.setJobSlot('J1', null))).toEqual(finished);
  });

  test('an id the board never handed out is unknown, not finished', () => {
    const { board } = boardWithTicket();
    board.launchJob(BUILD_LAUNCH, AT);
    expect(refusalDetailOf(() => board.moveJob('J2', 'running', AT))).toEqual({ reason: 'unknown-job', jobId: 'J2' });
    expect(refusalDetailOf(() => board.moveJob('job-1', 'running', AT))).toEqual({ reason: 'unknown-job', jobId: 'job-1' });
  });
});

describe('what a job carries', () => {
  test('the event cursor, the answered request ids once each, and a slot only while it holds one', () => {
    const { board } = boardWithTicket();
    const { job }   = board.launchJob(MERGE_LAUNCH, AT);
    board.setJobEventCursor(job.id, { instance: 1, sequence: 7 });
    board.addAnsweredRequestId(job.id, 'request-1');
    board.addAnsweredRequestId(job.id, 'request-1');
    board.setJobSlot(job.id, {
      target:    'main',
      targetTip: 'a1b2c3d',
      branchTip: 'b2c3d4e',
      phase:     'merge-in',
    });

    expect(board.jobById(job.id)).toMatchObject({
      eventCursor:        { instance: 1, sequence: 7 },
      answeredRequestIds: ['request-1'],
      slot:               {
        target: 'main', targetTip: 'a1b2c3d', branchTip: 'b2c3d4e', phase: 'merge-in'
      },
    });
    board.setJobSlot(job.id, null);
    expect(Object.hasOwn(board.jobById(job.id) ?? {}, 'slot')).toBe(false);
  });
});

describe('the merge-queue mark', () => {
  test('is set on an in-review ticket\'s row and cleared when the row leaves in-review', () => {
    const { board } = boardFixture({
      tasks:   [taskFixture({ id: 1, status: 'in-review', ticket: '001' })],
      tickets: [ticketFixture({ id: '001', status: 'in-review', task: 1 })],
    });
    expect(board.setTicketMergeQueued('001', true, AT)?.mergeQueued).toBe(true);
    expect(board.ticketIsMergeQueued('001')).toBe(true);

    board.moveTicket('001', 'reviewed', { checksLegality: true }, AT);
    expect(board.ticketIsMergeQueued('001')).toBe(false);
    expect(Object.hasOwn(board.tasks()[0] ?? {}, 'mergeQueued')).toBe(false);
  });

  test('is refused on a ticket outside in-review, and clearing it is never refused', () => {
    const { board, progress } = boardWithTicket();
    expect(refusalDetailOf(() => board.setTicketMergeQueued('001', true, AT))).toEqual({
      reason:   'merge-queue-of-a-ticket-not-in-review',
      ticketId: '001',
      status:   'in-progress',
    });
    expect(board.setTicketMergeQueued('001', false, AT)).toBeNull();
    expect(progress.tasks).toEqual([]);
  });
});

describe('the runner state', () => {
  test('the stored state is the one the Board and its dispatch capacity read', () => {
    const { board, progress } = boardFixture();
    progress.runnerState      = 'running';
    expect(board.runnerState()).toBe('running');
    expect(board.dispatchCapacity().runnerState).toBe('running');
  });
});
