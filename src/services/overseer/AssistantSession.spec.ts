/**
 * The Assistant's turns on a board, with its session's readings given as values. What matters: incidents go out only while it is idle, as
 * the next numbered chat; the n-th `result` closes chat n and its open incidents default after the hold's moves were applied; the open
 * turn's call budget defaults them too; past the context-token count its input closes; one that went down ends, never resumes, and what it
 * was delivered goes to the fresh one; a boot past the failed-boot bound waits for a sweep; User's message waits for an idle point; and
 * every move outside its incidents is refused at the Hatch.
 */
import { describe, expect, test } from 'bun:test';

import type { IncidentOpening }                                              from '../../lib/tracker-model/@types/Incident.ts';
import type { Job }                                                          from '../../lib/tracker-model/@types/Job.ts';
import type { LogRecord }                                                    from '../../lib/tracker-model/@types/LogRecord.ts';
import type { PlaybookObservations }                                         from '../../lib/tracker-model/@types/PlaybookStep.ts';
import { Board }                                                             from '../../lib/tracker-model/Board.ts';
import { createLogger }                                                      from '../../lib/tracker-model/Logger.ts';
import type { ControlCommand }                                               from '../../shared/@types/ControlCommand.ts';
import { LIFECYCLE_LIMITS }                                                  from '../../shared/constants/LifecycleLimits.ts';
import { ASSISTANT_CONTEXT_TOKENS_BEFORE_FRESH, ASSISTANT_TURN_CALL_BUDGET } from '../../shared/constants/OverseerLimits.ts';
import { ticketFixture }                                                     from '../../testing/BoardFixtures.ts';
import { createScratchDirectory, removeScratchDirectory }                    from '../../testing/ScratchWorkspace.ts';
import { Bouncer }                                                           from '../control/Bouncer.ts';
import { type AssistantReading, AssistantSession }                           from './AssistantSession.ts';

const FIXTURE_AT = '2026-10-28T10:00:00+01:00';

const FIXTURE_LIMITS = { ...LIFECYCLE_LIMITS, now: FIXTURE_AT, usageResetsAt: null };

const FIXTURE_OBSERVATIONS: PlaybookObservations = {
  mainLine:                     'main',
  groupTargetPrefix:            'group-',
  installVersionChanged:        false,
  targetsHoldingManagedBlock:   [],
  ticketIdsTouchingAgentConfig: [],
  closedDeliveryTurns:          [],
  budgetSpentDeliveryTurns:     [],
  assistantHasAnswered:         false,
  assistantBootRetryDue:        false,
};

const ASSISTANT_ID = 'J900';

const LIVE_ASSISTANT: Job = {
  id:                 ASSISTANT_ID,
  kind:               'assistant',
  role:               'assistant',
  ticketIds:          [],
  parentJobId:        null,
  attempt:            1,
  target:             null,
  state:              'running',
  watcherInstance:    1,
  eventCursor:        { instance: 1, sequence: 0 },
  answeredRequestIds: [],
  crashResumes:       0,
};

function failedBootRecords(jobId: string): LogRecord[] {
  return [
    {
      kind:   'job-launched',
      jobId,
      fields: {
        kind: 'assistant', role: 'assistant', ticketIds: [], attempt: 1, target: null, parentJobId: null
      },
      at: FIXTURE_AT,
    },
    {
      kind: 'job-ended', jobId, fields: { outcome: 'failed', deniedPermissions: [] }, at: FIXTURE_AT
    },
  ];
}

const WORDING = {
  questions: [{
    question: 'Carry on?', header: 'Carry on', multiSelect: false, options: []
  }],
  context: ''
};

const BLOCKED: IncidentOpening = {
  kind: 'blocked', ticketIds: ['001'], jobId: null, facts: {}, defaultMove: 'ticket-park'
};

function assistantBoard(storedLogRecords: LogRecord[] = [], jobs: Job[] = [{ ...LIVE_ASSISTANT }]): { board: Board; records: LogRecord[] } {
  const records: LogRecord[] = [];
  const board = new Board({
    progress: {
      trackerId:        'example-tracker-id',
      project:          'Example Agency',
      startedAt:        FIXTURE_AT,
      view:             { kind: 'auto' },
      nextTaskId:       1,
      concurrencyLimit: 4,
      overseerState:    'paused',
      nextJobId:        901,
      jobs,
      tasks:            [],
    },
    tickets:  [ticketFixture({ id: '001', status: 'in-progress' }), ticketFixture({ id: '002', status: 'in-progress' })],
    epics:    [],
    logger:   createLogger((record) => records.push(record)),
    storedLogRecords,
    pipeline: { prepare: [], gates: [{ name: 'verify', run: 'bun run verify' }] },
  });
  return { board, records };
}

function readingOf(results: number, overrides: Partial<AssistantReading> = {}): AssistantReading {
  return {
    jobId: ASSISTANT_ID, instance: 1, results, callsSinceLastResult: 0, lastContextTokens: null, ...overrides
  };
}

function advance(board: Board, readings: readonly AssistantReading[], overrides: Partial<PlaybookObservations> = {}): void {
  board.followPlaybook(FIXTURE_LIMITS, { ...FIXTURE_OBSERVATIONS, ...AssistantSession.turnObservationsOf(board, readings), ...overrides }, () => WORDING);
}

const scratch = createScratchDirectory('assistant-session');

function deliverWhenIdle(board: Board, readings: readonly AssistantReading[]): void {
  AssistantSession.deliverIncidentsWhenIdle(board, readings, scratch, FIXTURE_AT);
}

describe('delivery only when idle (A2)', () => {
  test('an Assistant that answered its first message takes the undelivered incidents as chat 2; a busy one takes none', () => {
    const { board } = assistantBoard();
    const { incident } = board.openIncident(BLOCKED, FIXTURE_AT);

    deliverWhenIdle(board, [readingOf(0)]);
    expect(board.incidentById(incident?.id ?? '')?.deliveredInTurn).toBeNull();

    deliverWhenIdle(board, [readingOf(1)]);
    expect(board.incidentById(incident?.id ?? '')?.deliveredInTurn).toEqual({ jobId: ASSISTANT_ID, chatSequence: 2 });
  });

  test('the second result after the first message closes chat 2, and only then', () => {
    const { board } = assistantBoard();
    const { incident } = board.openIncident(BLOCKED, FIXTURE_AT);
    board.markIncidentDelivered(incident?.id ?? '', { jobId: ASSISTANT_ID, chatSequence: 2 });

    expect(AssistantSession.turnObservationsOf(board, [readingOf(1)]).closedDeliveryTurns).toEqual([]);
    expect(AssistantSession.turnObservationsOf(board, [readingOf(2)]).closedDeliveryTurns).toEqual([{ jobId: ASSISTANT_ID, chatSequence: 2 }]);
  });
});

describe('defaults on a turn end (A3)', () => {
  test('a move applied earlier in the hold that reads the result handles its incident; only the other one defaults', () => {
    const { board, records } = assistantBoard();
    const handled = board.openIncident(BLOCKED, FIXTURE_AT).incident;
    const left    = board.openIncident({ ...BLOCKED, ticketIds: ['002'] }, FIXTURE_AT).incident;
    for (const incident of [handled, left]) board.markIncidentDelivered(incident?.id ?? '', { jobId: ASSISTANT_ID, chatSequence: 2 });

    board.handleIncident(handled?.id ?? '', 'ticket-park', FIXTURE_AT);
    advance(board, [readingOf(2)]);

    expect(board.incidents()).toEqual([]);
    const incidentRecords = records.flatMap((record) => ('incidentId' in record ? [`${record.kind} ${record.incidentId}`] : []));
    expect(incidentRecords).toEqual([
      `incident-opened ${handled?.id}`, `incident-opened ${left?.id}`, `incident-handled ${handled?.id}`, `incident-defaulted ${left?.id}`,
    ]);
  });
});

describe('bounded turns and a fresh one past the token count (A4)', () => {
  test('the open turn at its call budget defaults its incidents, cause turn-budget', () => {
    const { board, records } = assistantBoard();
    const { incident } = board.openIncident(BLOCKED, FIXTURE_AT);
    board.markIncidentDelivered(incident?.id ?? '', { jobId: ASSISTANT_ID, chatSequence: 2 });

    advance(board, [readingOf(1, { callsSinceLastResult: ASSISTANT_TURN_CALL_BUDGET - 1 })]);
    expect(board.incidents()).toHaveLength(1);

    advance(board, [readingOf(1, { callsSinceLastResult: ASSISTANT_TURN_CALL_BUDGET })]);
    expect(records.find((record) => record.kind === 'incident-defaulted')).toMatchObject({ fields: { cause: 'turn-budget' } });
  });

  test('an idle Assistant past the context-token count has its input closed and is delivered nothing', () => {
    const { board } = assistantBoard();
    board.openIncident(BLOCKED, FIXTURE_AT);

    deliverWhenIdle(board, [readingOf(1, { lastContextTokens: ASSISTANT_CONTEXT_TOKENS_BEFORE_FRESH })]);

    expect(board.jobById(ASSISTANT_ID)?.state).toBe('stopping');
    expect(board.incidents()[0]?.deliveredInTurn).toBeNull();
  });
});

describe('down means fresh (A5)', () => {
  test('an interrupted Assistant that answered ends replaced, cause assistant-down, its delivered incident waits for the fresh one', () => {
    const { board, records } = assistantBoard();
    const { incident } = board.openIncident(BLOCKED, FIXTURE_AT);
    board.markIncidentDelivered(incident?.id ?? '', { jobId: ASSISTANT_ID, chatSequence: 2 });
    board.interruptJob(ASSISTANT_ID, 'agent-crashed', FIXTURE_AT);

    const down = AssistantSession.endDownAssistants(board, [readingOf(1)], [], FIXTURE_AT);
    advance(board, []);

    expect(down.bootFailed).toBe(false);
    expect(records.find((record) => record.kind === 'job-ended')).toMatchObject({ jobId: ASSISTANT_ID, fields: { outcome: 'replaced', cause: 'assistant-down' } });
    expect(records.filter((record) => record.kind === 'job-resumed')).toEqual([]);
    expect(board.jobs().map((job) => [job.kind, job.state])).toEqual([['assistant', 'launching']]);
    expect(board.incidents().map((open) => open.deliveredInTurn)).toEqual([null]);
  });

  test('one quiet mid-turn is down too; one that never answered ends failed, a failed boot', () => {
    const { board, records } = assistantBoard();

    const down = AssistantSession.endDownAssistants(board, [readingOf(0)], [ASSISTANT_ID], FIXTURE_AT);

    expect(down.bootFailed).toBe(true);
    expect(records.find((record) => record.kind === 'job-ended')).toMatchObject({ fields: { outcome: 'failed', cause: 'assistant-down' } });
  });

  test('past two failed boots no boot comes but on a sweep, every incident defaults, and a fresh session\'s first result ends that', () => {
    const failedBoots = ['J1', 'J2'].flatMap(failedBootRecords);
    const { board: stored, records } = assistantBoard(failedBoots, []);
    stored.openIncident(BLOCKED, FIXTURE_AT);

    advance(stored, []);
    expect(stored.jobs()).toEqual([]);
    expect(records.find((record) => record.kind === 'incident-defaulted')).toMatchObject({ fields: { cause: 'no-assistant' } });

    advance(stored, [], { assistantBootRetryDue: true });
    expect(stored.jobs().map((job) => job.kind)).toEqual(['assistant']);

    stored.openIncident(BLOCKED, FIXTURE_AT);
    advance(stored, [], { assistantHasAnswered: true });
    expect(stored.incidents()).toHaveLength(1);
  });
});

describe('User\'s message waits for an idle point (A7)', () => {
  test('a job message to a busy Assistant is no chat yet; once idle it is the next numbered chat', () => {
    const { board } = assistantBoard();
    board.messageJob(ASSISTANT_ID, 'Example question for the Assistant', FIXTURE_AT);
    const assistant = board.jobById(ASSISTANT_ID) ?? LIVE_ASSISTANT;

    expect(AssistantSession.chatsToWriteOf(board, assistant, readingOf(0), [])).toEqual([]);
    expect(AssistantSession.chatsToWriteOf(board, assistant, readingOf(1), [])).toEqual([{ sequence: 2, incidentIds: [], messageNumber: 1 }]);
    expect(AssistantSession.chatsToWriteOf(board, assistant, readingOf(1), [{ sequence: 2, incidentIds: [], messageNumber: 1 }]))
      .toEqual([{ sequence: 2, incidentIds: [], messageNumber: 1 }]);
  });
});

describe('the Hatch refuses the Assistant everything but its incident moves (A8)', () => {
  const findings = {
    id: 'I4', kind: 'findings-delivered' as const, ticketIds: ['011'], jobId: null
  };
  const assistant = {
    id: ASSISTANT_ID, role: 'assistant' as const, filedTickets: [], deliveredIncidents: [findings]
  };
  const refused: readonly [string, ControlCommand][] = [
    ['filing', {
      kind: 'ticket-add', title: 'Example finding', type: 'bug', priority: 'low', dependsOn: [], epics: [], network: [], introducedBy: null, foundInReview: null, bodyText: null
    } as ControlCommand],
    ['readying an unlisted ticket', { kind: 'ticket-ready', ticketReferences: ['12'], incidentId: 'I4' }],
    ['readying with no incident', { kind: 'ticket-ready', ticketReferences: ['11'] }],
    ['a priority', { kind: 'ticket-priority', ticketReference: '11', priority: 'high' }],
    ['a waiver, written into the Acceptance', {
      kind: 'ticket-edit', ticketReference: '11', bodyText: 'Waived: A1', appendsBody: true, allowsPastPending: false
    }],
    ['a setting', { kind: 'concurrency-set', limit: 2 }],
    ['a gate', { kind: 'pipeline-gate-add', gate: { name: 'verify', run: 'true' } }],
    ['pausing the overseer', { kind: 'overseer-pause' }],
    ['an answer to User\'s decision', { kind: 'decision-answer', decisionId: 'E1', answer: { form: 'letters', choices: ['A'] } }],
  ];

  test.each(refused)('%s is refused', (_what, command) => {
    expect(Bouncer.verdictOf(assistant, command).verdict).toBe('refused');
  });

  test('readying a finding its incident lists is admitted', () => {
    expect(Bouncer.verdictOf(assistant, { kind: 'ticket-ready', ticketReferences: ['11'], incidentId: 'I4' }).verdict).toBe('admitted');
  });
});

test('the scratch folder goes', () => {
  removeScratchDirectory(scratch);
});
