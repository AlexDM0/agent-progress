/**
 * The moves under an incident and each kind's default, on the Board (design sections 5.4 and 8.3). What matters: an answer reaches the
 * waiting job and, for a malformed ticket, the ticket's `## Questions`; a note never closes; a park stops the waiting job and keeps the
 * agent's questions in front of User; every kind's default is planted, a merge gate's parking and a big resolution's review included;
 * and a delivered or abandoned ticket's findings open one `findings-delivered` incident that closes once each is readied, triaged or
 * abandoned, the v16 leftovers' incident taking the same moves.
 */
import { describe, expect, test } from 'bun:test';

import { boardFixture, refusalDetailOf, ticketFixture } from '../../testing/BoardFixtures.ts';
import type { DecisionQuestion }                        from './@types/Decision.ts';
import type { IncidentKind, IncidentMove }              from './@types/Incident.ts';
import type { DecisionDraft }                           from './@types/PlaybookStep.ts';
import type { Board }                                   from './Board.ts';

const AT = '2026-10-28T10:00:00+01:00';

const AGENT_WORDS: DecisionQuestion = {
  question:    'The install line needs a missing tool; which one should Example Agency use?',
  header:      'system',
  multiSelect: false,
  options:     [{ label: 'bun', description: 'The repository says so' }, { label: 'npm', description: 'The lock file says so' }],
};

const COMPLETE_BODY = '## Acceptance\n1. It holds.\n\n## Brief\nBuild it.\n';

const wordingOf = (draft: DecisionDraft) => ({
  questions: [{
    question: `Decide ${draft.kind}`, header: draft.kind, multiSelect: false, options: []
  }],
  context: ''
});

/** A board with ticket 001 built by J1, waiting on the question an incident of the given kind carries. */
function boardWithWaitingQuestion(kind: IncidentKind) {
  const fixture = boardFixture({ tickets: [ticketFixture({ id: '001', status: 'in-progress', task: 1 })] });
  fixture.board.launchJob({
    kind: 'build', role: 'builder', ticketIds: ['001'], parentJobId: null, attempt: 1, target: 'main'
  }, AT);
  fixture.board.moveJob('J1', 'running', AT);
  fixture.board.moveJob('J1', 'waiting-for-answer', AT);
  fixture.board.openIncident({
    kind, ticketIds: ['001'], jobId: 'J1', facts: { requestId: 'request-1', questions: JSON.stringify([AGENT_WORDS]) }, defaultMove: 'incident-escalate'
  }, AT);
  fixture.records.length = 0;
  return fixture;
}

function recordKindsOf(records: readonly { kind: string }[]): string[] {
  return records.map((record) => record.kind);
}

describe('incident note and answer', () => {
  test('a note is logged incident-noted and leaves the incident open', () => {
    const { board, records } = boardWithWaitingQuestion('system-question');
    board.noteIncident('I1', 'The tool is on the Overseer image', AT);
    expect(records).toEqual([{
      at: AT, kind: 'incident-noted', incidentId: 'I1', fields: { text: 'The tool is on the Overseer image' }
    }]);
    expect(board.incidentById('I1')).toBeDefined();
  });

  test('an answer closes a system-question, joins the request to the job and runs the waiting job again', () => {
    const { board, records } = boardWithWaitingQuestion('system-question');
    board.answerIncident('I1', 'bun', AT);
    expect(recordKindsOf(records).slice(0, 2)).toEqual(['incident-handled', 'incident-answered']);
    expect(records[1]).toMatchObject({ fields: { answer: { [AGENT_WORDS.question]: 'bun' }, requestId: 'request-1' } });
    expect(board.jobById('J1')).toMatchObject({ state: 'running', answeredRequestIds: ['request-1'] });
    expect(board.incidentById('I1')).toBeUndefined();
  });

  test('a malformed ticket\'s answer is also written under the ticket\'s ## Questions', () => {
    const { board, tickets } = boardWithWaitingQuestion('malformed-ticket');
    board.answerIncident('I1', 'bun', AT);
    expect(tickets[0]?.body).toContain('## Questions');
    expect(tickets[0]?.body).toContain('Answer (I1): bun');
  });

  test('an incident carrying no agent\'s question is refused incident-not-a-question', () => {
    const { board } = boardWithWaitingQuestion('system-question');
    board.openIncident({
      kind: 'blocked', ticketIds: ['001'], jobId: null, facts: {}, defaultMove: 'ticket-park'
    }, AT);
    expect(refusalDetailOf(() => board.answerIncident('I2', 'bun', AT))).toEqual({ reason: 'incident-not-a-question', incidentId: 'I2', kind: 'blocked' });
  });
});

describe('ticket park', () => {
  test('under a question incident it holds parked:<kind>, stops the waiting job and puts the agent\'s questions to User', () => {
    const { board, records, progress } = boardWithWaitingQuestion('system-question');
    board.parkTicket('001', 'The Overseer image lacks the tool', 'I1', AT);
    expect(records[0]).toMatchObject({ kind: 'incident-handled', fields: { move: 'ticket-park' } });
    expect(board.ticketByReference('001')?.frontmatter.hold).toBe('parked:system-question');
    expect(records.find((record) => record.kind === 'job-ended')).toMatchObject({ jobId: 'J1', fields: { outcome: 'stopped', cause: 'parked' } });
    expect(progress.decisions?.[0]).toMatchObject({
      kind: 'parked', ticketIds: ['001'], questions: [AGENT_WORDS], context: 'The Overseer image lacks the tool'
    });
  });

  test('by User with no incident it holds parked:user and opens a parked decision asking the reason', () => {
    const { board, progress } = boardFixture({ tickets: [ticketFixture({ id: '001' })] });
    board.parkTicket('001', 'Waiting on Alex Example', null, AT);
    expect(board.ticketByReference('001')?.frontmatter.hold).toBe('parked:user');
    expect(progress.decisions?.[0]?.questions[0]?.question).toBe('Waiting on Alex Example');
  });
});

describe('each kind\'s default', () => {
  function defaulted(kind: IncidentKind, defaultMove: IncidentMove, priorDefaults = 0): Board {
    const { board } = boardFixture({ tickets: [ticketFixture({ id: '001', status: 'in-progress', task: 1 })] });
    board.addGate({ name: 'test', run: 'bun test' }, AT);
    for (let i = 0; i <= priorDefaults; i += 1) {
      const { incident } = board.openIncident({
        kind, ticketIds: ['001'], jobId: null, facts: { round: String(i) }, defaultMove
      }, AT);
      board.followPlaybook({
        FAILED_PASSES_BEFORE_PARKING:             2,
        CONSECUTIVE_DEAD_AGENTS_BEFORE_STOPPING:  2,
        ROUND_GRANTED_ON_REWORK_ALONE:            2,
        FINDINGS_SHRINK_FACTOR_PER_ROUND:         2,
        REWORK_ROUND_THRESHOLD_LINES:             750,
        JOB_RESUMES_BEFORE_FRESH:                 2,
        RED_HANDOFF_RESUMES_BEFORE_PARKING:       2,
        REPLACED_JOBS_BEFORE_JOB_LOST:            2,
        FAILED_ASSISTANT_BOOTS_BEFORE_DEFAULTING: 0,
        now:                                      AT,
        usageResetsAt:                            null,
      }, {
        mainLine:                     'main',
        groupTargetPrefix:            'group-',
        installVersionChanged:        false,
        targetsHoldingManagedBlock:   [],
        ticketIdsTouchingAgentConfig: [],
        closedDeliveryTurns:          [],
        budgetSpentDeliveryTurns:     [],
        orchestratorHasAnswered:      false,
        orchestratorBootRetryDue:     false,
      }, wordingOf);
      expect(board.incidentById(incident?.id ?? '')).toBeUndefined();
      if (i < priorDefaults && board.ticketByReference('001')?.frontmatter.hold !== undefined) board.unholdTicket('001', AT);
    }
    return board;
  }

  test.each([
    ['merge-gate-failed', 'merge-abort', 'parked:merge-gate-failed'],
    ['blocked', 'ticket-park', 'parked:blocked'],
    ['job-lost', 'ticket-park', 'parked:job-lost'],
  ] as const)('a %s takes %s and parks the ticket %s with a parked decision', (kind, move, hold) => {
    const board = defaulted(kind, move);
    expect(board.ticketByReference('001')?.frontmatter.hold).toBe(hold);
    expect(board.decisions().map((decision) => decision.kind)).toEqual(['parked']);
    expect(board.logRecordsSoFar().find((record) => record.kind === 'incident-defaulted')).toMatchObject({ fields: { move, cause: 'no-assistant' } });
  });

  test.each([
    ['resolution-over-threshold', 'merge-review'],
    ['resume-failed', 'job-fresh'],
    ['setup-failed', 'worktree-repair'],
    ['gate-cannot-run', 'gate-retry'],
    ['out-of-calls', 'job-fresh'],
  ] as const)('a %s takes %s the first time and parks nothing', (kind, move) => {
    const board = defaulted(kind, move);
    expect(board.ticketByReference('001')?.frontmatter.hold).toBeUndefined();
    expect(board.logRecordsSoFar().find((record) => record.kind === 'incident-defaulted')).toMatchObject({ fields: { move } });
  });

  test.each([
    ['setup-failed', 'worktree-repair'],
    ['gate-cannot-run', 'gate-retry'],
    ['out-of-calls', 'job-fresh'],
  ] as const)('a second %s on the ticket parks instead of taking %s again', (kind, move) => {
    expect(defaulted(kind, move, 1).ticketByReference('001')?.frontmatter.hold).toBe(`parked:${kind}`);
  });

  test('a quiet-job opens the quiet-job decision to User', () => {
    expect(defaulted('quiet-job', 'open-quiet-job-decision').decisions().map((decision) => decision.kind)).toEqual(['quiet-job']);
  });
});

describe('findings-delivered', () => {
  function boardWithFindings() {
    const fixture = boardFixture({
      tickets: [
        ticketFixture({ id: '001', status: 'reviewed', task: 1 }),
        ticketFixture({
          id: '002', status: 'draft', filedByJob: 'J1', findingRoute: 'assistant'
        }),
        ticketFixture({
          id: '003', status: 'draft', filedByJob: 'J1', findingRoute: 'assistant'
        }),
        ticketFixture({
          id: '004', status: 'draft', filedByJob: 'J1', findingRoute: 'user'
        }),
        ticketFixture({
          id: '005', status: 'draft', filedByJob: 'J9', findingRoute: 'assistant'
        }),
      ],
    });
    fixture.board.launchJob({
      kind: 'build', role: 'builder', ticketIds: ['001'], parentJobId: null, attempt: 1, target: 'main'
    }, AT);
    fixture.board.endJob('J1', { outcome: 'built' }, AT);
    const body = fixture.tickets.find((ticket) => ticket.frontmatter.id === '002');
    if (body !== undefined) body.body = COMPLETE_BODY;
    return fixture;
  }

  test('delivering a ticket lists every orchestrator-route draft its jobs filed, in the delivering hold', () => {
    const { board } = boardWithFindings();
    const moved = board.moveTicket('001', 'delivered', { checksLegality: false }, AT);
    expect(moved.logged.at(-1)).toMatchObject({ kind: 'incident-opened', fields: { kind: 'findings-delivered', ticketIds: ['002', '003'] } });
  });

  test('a ticket whose jobs filed no such finding opens nothing', () => {
    const { board } = boardFixture({ tickets: [ticketFixture({ id: '001', status: 'reviewed', task: 1 })] });
    board.moveTicket('001', 'abandoned', { checksLegality: false, reason: 'Superseded by an example' }, AT);
    expect(board.incidents()).toEqual([]);
  });

  test('it closes once every listed finding is readied, triaged or abandoned, by the move that settled the last', () => {
    const { board } = boardWithFindings();
    board.moveTicket('001', 'delivered', { checksLegality: false }, AT);
    board.readyFindings(['002'], () => [], AT);
    expect(board.incidentById('I1')?.ticketIds).toEqual(['003']);
    board.triageTickets(['003'], AT);
    expect(board.incidentById('I1')).toBeUndefined();
    expect(board.ticketByReference('003')?.frontmatter.findingRoute).toBe('user');
    expect(board.logRecordsSoFar().at(-1)).toMatchObject({ kind: 'incident-handled', fields: { move: 'ticket-triage' } });
  });

  test('its default triages every finding still listed', () => {
    const { board } = boardWithFindings();
    board.moveTicket('001', 'delivered', { checksLegality: false }, AT);
    board.followPlaybook({
      FAILED_PASSES_BEFORE_PARKING:             2,
      CONSECUTIVE_DEAD_AGENTS_BEFORE_STOPPING:  2,
      ROUND_GRANTED_ON_REWORK_ALONE:            2,
      FINDINGS_SHRINK_FACTOR_PER_ROUND:         2,
      REWORK_ROUND_THRESHOLD_LINES:             750,
      JOB_RESUMES_BEFORE_FRESH:                 2,
      RED_HANDOFF_RESUMES_BEFORE_PARKING:       2,
      REPLACED_JOBS_BEFORE_JOB_LOST:            2,
      FAILED_ASSISTANT_BOOTS_BEFORE_DEFAULTING: 0,
      now:                                      AT,
      usageResetsAt:                            null,
    }, {
      mainLine:                     'main',
      groupTargetPrefix:            'group-',
      installVersionChanged:        false,
      targetsHoldingManagedBlock:   [],
      ticketIdsTouchingAgentConfig: [],
      closedDeliveryTurns:          [],
      budgetSpentDeliveryTurns:     [],
      orchestratorHasAnswered:      false,
      orchestratorBootRetryDue:     false,
    }, wordingOf);
    expect(['002', '003'].map((ticketId) => board.ticketByReference(ticketId)?.frontmatter.findingRoute)).toEqual(['user', 'user']);
  });

  test('the first run\'s leftovers take the same moves: ready lifts first-run review, triage keeps it', () => {
    const { board } = boardFixture({ tickets: [ticketFixture({ id: '001', priority: 'low', task: 1 }), ticketFixture({ id: '002', priority: 'low', task: 2 })], });
    board.holdFirstRunLeftovers(AT);
    board.readyFindings(['001'], () => [], AT);
    board.triageTickets(['002'], AT);
    expect(board.ticketByReference('001')?.frontmatter.hold).toBeUndefined();
    expect(board.ticketByReference('002')?.frontmatter.hold).toBe('first-run review');
    expect(board.incidents()).toEqual([]);
  });
});
