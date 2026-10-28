/**
 * The runner's orchestrator's incidents on the Board. What matters: an incident starts undelivered and carries its facts and default
 * move; it closes exactly once, by a move (`incident-handled`), by its own default with the cause the warning state reads
 * (`incident-defaulted`), or by an escalation that puts the agent's questions to the user unchanged as an `agent-question` decision on the
 * same tickets, job and request; a closed one refuses every later close; and a replayed question request opens no second incident.
 */
import { describe, expect, test } from 'bun:test';

import { boardFixture, refusalDetailOf, ticketFixture } from '../../testing/BoardFixtures.ts';
import type { DecisionQuestion }                        from './@types/Decision.ts';
import type { IncidentOpening }                         from './@types/Incident.ts';
import type { Board }                                   from './Board.ts';

const AT = '2026-09-26T10:15:00+02:00';

const SYSTEM_QUESTION = {
  kind:        'system-question',
  ticketIds:   ['001'],
  jobId:       'J1',
  facts:       { requestId: 'request-1', tool: 'bun' },
  defaultMove: 'incident-escalate',
} satisfies IncidentOpening;

const AGENT_WORDS: DecisionQuestion = {
  question:    'The install line fails on a missing bun; install it?',
  header:      'system',
  multiSelect: false,
  options:     [{ label: 'Install', description: 'Run the setup script' }, { label: 'Stop', description: 'Leave it' }],
};

function freshBoard(): ReturnType<typeof boardFixture> {
  return boardFixture({ tickets: [ticketFixture({ id: '001' })] });
}

const CLOSES: readonly (readonly [string, (board: Board) => unknown])[] = [
  ['a move', (board) => board.handleIncident('I1', 'job-fresh', AT)],
  ['its default', (board) => board.defaultIncident('I1', 'turn-closed', AT)],
  ['an escalation', (board) => board.escalateIncident('I1', { askedBy: 'builder', questions: [AGENT_WORDS], context: '' }, AT)],
];

describe('opening an incident', () => {
  test('numbers it from I1, starts it undelivered and logs incident-opened with its tickets', () => {
    const { board, progress, records } = freshBoard();
    const { incident } = board.openIncident(SYSTEM_QUESTION, AT);

    expect(incident).toEqual({
      ...SYSTEM_QUESTION, id: 'I1', deliveredInTurn: null, openedAt: AT
    });
    expect(progress.incidents).toHaveLength(1);
    expect(progress.nextIncidentId).toBe(2);
    expect(records).toEqual([{
      at: AT, kind: 'incident-opened', incidentId: 'I1', fields: { kind: 'system-question', ticketIds: ['001'] }
    }]);
  });

  test('a replayed request still open gives the incident back and logs nothing', () => {
    const { board, records } = freshBoard();
    board.openIncident(SYSTEM_QUESTION, AT);
    expect(board.openIncident(SYSTEM_QUESTION, AT)).toEqual({ incident: board.incidentById('I1') ?? null, logged: [] });
    expect(records).toHaveLength(1);
  });

  test('a replayed request escalated to a decision opens nothing', () => {
    const { board } = freshBoard();
    board.openIncident(SYSTEM_QUESTION, AT);
    board.escalateIncident('I1', { askedBy: 'builder', questions: [AGENT_WORDS], context: '' }, AT);
    expect(board.openIncident(SYSTEM_QUESTION, AT)).toEqual({ incident: null, logged: [] });
    expect(board.incidents()).toEqual([]);
  });

  test('an incident no question opened opens every time', () => {
    const { board } = freshBoard();
    const blocked   = {
      ...SYSTEM_QUESTION, kind: 'blocked', facts: {}, defaultMove: 'ticket-park',
    } as const;
    board.openIncident(blocked, AT);
    board.openIncident(blocked, AT);
    expect(board.incidents().map((incident) => incident.id)).toEqual(['I1', 'I2']);
  });
});

test('marking an incident delivered stores the turn and logs nothing', () => {
  const { board, records } = freshBoard();
  board.openIncident(SYSTEM_QUESTION, AT);
  records.length = 0;
  board.markIncidentDelivered('I1', { jobId: 'J9', chatSequence: 3 });
  expect(board.incidentById('I1')?.deliveredInTurn).toEqual({ jobId: 'J9', chatSequence: 3 });
  expect(records).toEqual([]);
});

describe('closing an incident', () => {
  test('by a move logs incident-handled with the move and takes it off the board', () => {
    const { board, progress, records } = freshBoard();
    board.openIncident(SYSTEM_QUESTION, AT);
    records.length = 0;
    board.handleIncident('I1', 'incident-answer', AT);
    expect(progress.incidents).toEqual([]);
    expect(records).toEqual([{
      at: AT, kind: 'incident-handled', incidentId: 'I1', fields: { move: 'incident-answer' }
    }]);
  });

  test.each(['turn-closed', 'turn-budget', 'no-orchestrator'] as const)('by its default for %s logs its own default move and the cause', (cause) => {
    const { board, records } = freshBoard();
    board.openIncident({ ...SYSTEM_QUESTION, kind: 'merge-gate-failed', defaultMove: 'merge-abort' }, AT);
    records.length = 0;
    board.defaultIncident('I1', cause, AT);
    expect(records).toEqual([{
      at: AT, kind: 'incident-defaulted', incidentId: 'I1', fields: { move: 'merge-abort', cause }
    }]);
  });

  test('by an escalation opens an agent-question decision with exactly the agent\'s questions on the same tickets, job and request', () => {
    const { board, progress, records } = freshBoard();
    board.openIncident(SYSTEM_QUESTION, AT);
    records.length = 0;
    const { decision } = board.escalateIncident('I1', { askedBy: 'builder', questions: [AGENT_WORDS], context: 'Example cart' }, AT);

    expect(decision).toEqual({
      id:        'E1',
      kind:      'agent-question',
      ticketIds: ['001'],
      jobId:     'J1',
      askedBy:   'builder',
      requestId: 'request-1',
      questions: [AGENT_WORDS],
      context:   'Example cart',
      openedAt:  AT,
    });
    expect(progress.incidents).toEqual([]);
    expect(records).toEqual([
      {
        at: AT, kind: 'decision-opened', decisionId: 'E1', fields: { kind: 'agent-question', ticketIds: ['001'] }
      },
      {
        at: AT, kind: 'incident-escalated', incidentId: 'I1', fields: { decisionId: 'E1' }
      },
    ]);
  });

  test('an escalated incident no question opened carries no request', () => {
    const { board } = freshBoard();
    board.openIncident({ ...SYSTEM_QUESTION, facts: {} }, AT);
    expect(board.escalateIncident('I1', { askedBy: 'orchestrator', questions: [AGENT_WORDS], context: '' }, AT).decision.requestId).toBeNull();
  });

  test.each(CLOSES)('a closed incident refuses being closed again by %s', (_close, close) => {
    for (const [, firstClose] of CLOSES) {
      const { board, records } = freshBoard();
      board.openIncident(SYSTEM_QUESTION, AT);
      firstClose(board);
      const loggedBefore = records.length;
      expect(refusalDetailOf(() => close(board))).toEqual({ reason: 'incident-closed', incidentId: 'I1' });
      expect(records).toHaveLength(loggedBefore);
    }
  });

  test.each(CLOSES)('an id the board never handed out is refused unknown-incident by %s', (_close, close) => {
    const { board } = freshBoard();
    expect(refusalDetailOf(() => close(board))).toEqual({ reason: 'unknown-incident', incidentId: 'I1' });
    expect(refusalDetailOf(() => board.markIncidentDelivered('E1', { jobId: 'J1', chatSequence: 1 }))).toEqual({ reason: 'unknown-incident', incidentId: 'E1' });
  });
});

test('incident ids are never reused after an incident leaves the board', () => {
  const { board } = freshBoard();
  board.openIncident(SYSTEM_QUESTION, AT);
  board.handleIncident('I1', 'job-fresh', AT);
  expect(board.openIncident({ ...SYSTEM_QUESTION, facts: { requestId: 'request-2' } }, AT).incident?.id).toBe('I2');
});
