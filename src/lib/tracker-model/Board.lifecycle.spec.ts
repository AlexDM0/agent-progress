/**
 * `Board.advanceLifecycle` over real board records. What matters: the steps the policy derives are applied in the same pass (jobs launched as
 * records, a park held and asked about, decisions and incidents opened, defaults taken), every record stamped with `limits.now`; a ready
 * ticket is any pending, unheld one, a low one and one with an open question alike; failed passes, crashes on one ticket and usage limits
 * are acted on with no incident, and a runner restart counts toward no outage; and a group builds in parallel, each ticket as soon as the
 * group tickets it names are integrated.
 */
import { describe, expect, test } from 'bun:test';

import type { Decision }                  from './@types/Decision.ts';
import type { LifecycleObservations }     from './@types/LifecycleStep.ts';
import type { LogRecord }                 from './@types/LogRecord.ts';
import type { Pipeline }                  from './@types/Pipeline.ts';
import type { Ticket, TicketFrontmatter } from './@types/Ticket.ts';
import type { TrackerProgress }           from './@types/TrackerProgress.ts';
import { Board }                          from './Board.ts';
import { createLogger }                   from './Logger.ts';
import {
  FIXTURE_AT,
  FIXTURE_LIMITS,
  FIXTURE_OBSERVATIONS,
  LIVE_ORCHESTRATOR,
  finishedJobRecords,
  interruptedRecord,
  jobFixture,
  launchedRecord,
  stepKindsOf,
  ticketRecord
}                                            from './testing/LifecycleFixtures.ts';

const WORDING = {
  questions: [{
    question: 'Carry on?', header: 'Carry on', multiSelect: false, options: [{ label: 'Yes', description: 'Carry on' }],
  }],
  context: 'Example context',
};

function ticketWith(id: string, overrides: Partial<TicketFrontmatter> = {}): Ticket {
  return {
    frontmatter: {
      id,
      title:       `Example ticket ${id}`,
      type:        'ticket',
      status:      'pending',
      filed:       FIXTURE_AT,
      updated:     FIXTURE_AT,
      started:     null,
      finished:    null,
      delivered:   null,
      abandonedAt: null,
      task:        null,
      extra:       [],
      ...overrides,
    },
    body:     '',
    filePath: `/example-agency/storefront/.agent-progress/tickets/${id}-example.md`,
  };
}

interface LifecycleBoard {
  board:    Board;
  progress: TrackerProgress;
  records:  LogRecord[];
}

function lifecycleBoardOf(contents: { tickets: Ticket[]; progress?: Partial<TrackerProgress>; storedLogRecords?: LogRecord[]; pipeline?: Pipeline | null }): LifecycleBoard {
  const records: LogRecord[] = [];
  const progress: TrackerProgress = {
    trackerId:        'example-tracker-id',
    project:          'Example Agency',
    startedAt:        FIXTURE_AT,
    view:             { kind: 'auto' },
    nextTaskId:       1,
    concurrencyLimit: 4,
    runnerState:      'running',
    nextJobId:        901,
    jobs:             [{ ...LIVE_ORCHESTRATOR }],
    tasks:            [],
    ...contents.progress,
  };
  const board = new Board({
    progress,
    tickets:          contents.tickets,
    epics:            [],
    logger:           createLogger((record) => records.push(record)),
    storedLogRecords: contents.storedLogRecords ?? [],
    pipeline:         contents.pipeline === undefined ? { prepare: [], gates: [{ name: 'verify', run: 'bun run verify' }], review: { name: 'Review' } } : contents.pipeline,
  });
  return { board, progress, records };
}

function advance(board: Board, observations: LifecycleObservations = FIXTURE_OBSERVATIONS): ReturnType<Board['advanceLifecycle']> {
  return board.advanceLifecycle(FIXTURE_LIMITS, observations, () => WORDING);
}

function questionOn(ticketId: string): Decision {
  return {
    id: 'E1', kind: 'agent-question', ticketIds: [ticketId], jobId: 'J5', askedBy: 'builder', requestId: 'R1', questions: WORDING.questions, context: '', openedAt: FIXTURE_AT,
  };
}

// Unset and empty differ: no pipeline means nobody chose the gates, an empty one was chosen on purpose.
describe('no pipeline and no gates on purpose are told apart', () => {
  test('with no pipeline the board opens checks-not-set, launches no ticket and one onboarder, and a second pass launches no other', () => {
    const { board } = lifecycleBoardOf({ tickets: [ticketWith('001')], pipeline: null });

    advance(board);
    advance(board);

    expect(board.decisions().map((decision) => decision.kind)).toEqual(['checks-not-set']);
    expect(board.jobs().map((job) => [job.kind, job.role, job.target, job.ticketIds])).toEqual([['orchestrator', 'orchestrator', null, []], ['onboarder', 'onboarder', null, []]]);
  });

  test('after gate none the board opens no checks-not-set, launches the ready ticket and logged the choice once', () => {
    const { board, records } = lifecycleBoardOf({ tickets: [ticketWith('001')], pipeline: null });
    board.setNoGates(FIXTURE_AT);

    advance(board);

    expect(board.decisions()).toEqual([]);
    expect(board.jobs().map((job) => job.kind)).toEqual(['orchestrator', 'build']);
    expect(records.filter((record) => record.kind === 'pipeline-gates-none')).toHaveLength(1);
    expect(board.pipeline()).toEqual({ prepare: [], gates: [] });
    expect(board.checksLine()).toBe('true');
  });
});

describe('advancing the lifecycle applies what the policy derives', () => {
  test('a ready ticket is launched as a build job record on its target, every record stamped now', () => {
    const { board, records } = lifecycleBoardOf({ tickets: [ticketWith('001')] });

    const advanced = advance(board);

    expect(advanced.steps).toEqual([{
      kind: 'launch-build', ticketId: '001', attempt: 1, base: 'main'
    }]);
    expect(board.jobs().map((job) => [job.kind, job.ticketIds, job.target, job.state])).toEqual([['orchestrator', [], null, 'running'], ['build', ['001'], 'main', 'launching']]);
    expect(advanced.logged).toEqual(records);
    expect(records.every((record) => record.at === FIXTURE_AT)).toBe(true);
  });

  test('a second failed pass holds the ticket parked and opens a parked decision worded by the caller', () => {
    const storedLogRecords = [
      ticketRecord('ticket-started', '001'),
      ...finishedJobRecords('J1', 'build', '001', 'failed'),
      ...finishedJobRecords('J2', 'build', '001', 'failed', 2),
    ];
    const { board } = lifecycleBoardOf({ tickets: [ticketWith('001', { status: 'in-progress' })], storedLogRecords });

    advance(board);

    expect(board.tickets()[0]?.frontmatter.hold).toBe('parked:failed-passes');
    expect(board.decisions().map((decision) => [decision.kind, decision.ticketIds, decision.askedBy, decision.context]))
      .toEqual([['parked', ['001'], 'runner', 'Example context']]);
    expect(board.incidents()).toEqual([]);
  });

  test('an outage stops dispatching and opens the outage decision, with no incident', () => {
    const storedLogRecords = [
      launchedRecord('J1', 'build', ['001']),
      launchedRecord('J2', 'build', ['002']),
      interruptedRecord('J1', 'host-lost'),
      interruptedRecord('J2', 'agent-crashed'),
    ];
    const { board } = lifecycleBoardOf({ tickets: [], storedLogRecords });

    advance(board);

    expect(board.runnerState()).toBe('paused');
    expect(board.decisions().map((decision) => decision.kind)).toEqual(['outage']);
    expect(board.incidents()).toEqual([]);
  });

  test('an interrupted job is resumed on its next host instance, and one past its crash bound is ended replaced', () => {
    const { board } = lifecycleBoardOf({
      tickets:  [ticketWith('001', { status: 'in-progress' }), ticketWith('002', { status: 'in-progress' })],
      progress: {
        jobs: [
          { ...LIVE_ORCHESTRATOR },
          jobFixture({
            id: 'J1', ticketIds: ['001'], state: 'interrupted', interruption: 'usage-limit'
          }),
          jobFixture({
            id: 'J2', ticketIds: ['002'], state: 'interrupted', interruption: 'agent-crashed', crashResumes: FIXTURE_LIMITS.JOB_RESUMES_BEFORE_FRESH
          }),
        ],
      },
    });

    const advanced = advance(board);

    expect(stepKindsOf(advanced.steps)).toEqual(['resume-job', 'replace-job']);
    expect(board.jobById('J1')).toMatchObject({ state: 'running', hostInstance: 2 });
    expect(board.jobById('J2')).toBeUndefined();
    expect(board.incidents()).toEqual([]);
  });

  test('an incident delivered in a closed turn takes its default move', () => {
    const { board, records } = lifecycleBoardOf({
      tickets:  [],
      progress: {
        nextIncidentId: 2,
        incidents:      [{
          id: 'I1', kind: 'blocked', ticketIds: [], jobId: null, facts: {}, defaultMove: 'ticket-park', deliveredInTurn: { jobId: 'J900', chatSequence: 1 }, openedAt: FIXTURE_AT,
        }],
      },
    });

    advance(board, { ...FIXTURE_OBSERVATIONS, closedDeliveryTurns: [{ jobId: 'J900', chatSequence: 1 }] });

    expect(board.incidents()).toEqual([]);
    expect(records.map((record) => record.kind)).toEqual(['incident-defaulted']);
  });
});

describe('ready is pending and unheld', () => {
  test('a low-priority ticket launches with no triage', () => {
    const { board } = lifecycleBoardOf({ tickets: [ticketWith('001', { priority: 'low' })] });

    expect(stepKindsOf(advance(board).steps)).toEqual(['launch-build']);
  });

  test('an open builder question on a ticket is no hold', () => {
    const { board } = lifecycleBoardOf({ tickets: [ticketWith('001')], progress: { decisions: [questionOn('001')], nextDecisionId: 2 } });

    expect(stepKindsOf(advance(board).steps)).toEqual(['launch-build']);
  });

  test('a draft is never ready', () => {
    const { board } = lifecycleBoardOf({ tickets: [ticketWith('001', { status: 'draft' })] });

    expect(advance(board).steps).toEqual([]);
  });
});

describe('what code counts and acts on alone', () => {
  test('a runner restart between two crashes is not counted: the outage still pauses the runner', () => {
    const storedLogRecords = [
      launchedRecord('J1', 'build', ['001']),
      launchedRecord('J2', 'build', ['002']),
      interruptedRecord('J1', 'host-lost'),
      { kind: 'runner-started', fields: { codeVersion: 'example', installVersion: 17 }, at: FIXTURE_AT } satisfies LogRecord,
      interruptedRecord('J2', 'host-lost'),
    ];
    const { board } = lifecycleBoardOf({ tickets: [], storedLogRecords });

    expect(stepKindsOf(advance(board).steps)).toContain('pause-runner');
  });

  test('one failed pass rebuilds on the next attempt and opens nothing', () => {
    const storedLogRecords = [ticketRecord('ticket-started', '001'), ...finishedJobRecords('J1', 'build', '001', 'failed')];
    const { board } = lifecycleBoardOf({ tickets: [ticketWith('001', { status: 'in-progress' })], storedLogRecords });

    expect(advance(board).steps).toEqual([{
      kind: 'launch-build', ticketId: '001', attempt: 2, base: 'main'
    }]);
    expect(board.decisions()).toEqual([]);
    expect(board.incidents()).toEqual([]);
  });
});

describe('a group builds in parallel', () => {
  const GROUP = { group: 'example' } as const;

  function groupOfFour(firstStatus: TicketFrontmatter['status']): Ticket[] {
    return [
      ticketWith('001', { ...GROUP, status: firstStatus }),
      ticketWith('002', GROUP),
      ticketWith('003', { ...GROUP, dependsOn: ['001'] }),
      ticketWith('004', { ...GROUP, dependsOn: ['001'] }),
    ];
  }

  test('the two independent tickets launch together on the group branch, the dependants wait', () => {
    const { board } = lifecycleBoardOf({ tickets: groupOfFour('pending') });

    expect(advance(board).steps).toEqual([
      {
        kind: 'launch-build', ticketId: '001', attempt: 1, base: 'group-example'
      },
      {
        kind: 'launch-build', ticketId: '002', attempt: 1, base: 'group-example'
      },
    ]);
  });

  test('the dependants wait while their dependency is only built', () => {
    const { board } = lifecycleBoardOf({ tickets: groupOfFour('in-review'), progress: { concurrencyLimit: 2 } });

    expect(advance(board).steps.map((step) => ('ticketId' in step ? step.ticketId : step.kind))).toEqual(['001', '002']);
  });

  test('once the first is integrated both dependants launch, bounded only by the board limit', () => {
    const { board } = lifecycleBoardOf({ tickets: groupOfFour('reviewed') });

    expect(advance(board).steps.flatMap((step) => (step.kind === 'launch-build' ? [step.ticketId] : []))).toEqual(['002', '003', '004']);
  });
});
