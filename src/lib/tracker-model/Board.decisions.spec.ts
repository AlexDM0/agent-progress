/**
 * The user's decisions on the Board. What matters: a decision carries an agent's questions exactly as asked; the first answer wins and
 * every later one is refused `decision-already-answered`, as is an answer to a withdrawn one; an answer must give one text per question
 * and is stored keyed by each question's text; a replayed question request, still open or already answered, never opens a second decision;
 * and a decision leaves the board in the hold that answers or withdraws it, its id never reused.
 */
import { describe, expect, test } from 'bun:test';

import { boardFixture, refusalDetailOf, ticketFixture } from '../../testing/BoardFixtures.ts';
import type { DecisionOpening, DecisionQuestion }       from './@types/Decision.ts';
import type { Board }                                   from './Board.ts';

const AT = '2026-09-26T10:15:00+02:00';

const FORMAT_QUESTION: DecisionQuestion = {
  question:    'Which export format should the example ship?',
  header:      'Format',
  multiSelect: false,
  options:     [{ label: 'CSV', description: 'Comma separated' }, { label: 'JSON', description: 'One document' }],
};

const COLUMNS_QUESTION: DecisionQuestion = {
  question:    'Which columns go in?',
  header:      'Columns',
  multiSelect: true,
  options:     [{ label: 'Name', description: 'Alex Example' }, { label: 'Total', description: 'The cart total' }],
};

const AGENT_QUESTION = {
  kind:      'agent-question',
  ticketIds: ['001'],
  jobId:     'J1',
  askedBy:   'builder',
  requestId: 'request-1',
  questions: [FORMAT_QUESTION, COLUMNS_QUESTION],
  context:   'Example export',
} satisfies DecisionOpening;

function boardWithAJob(): ReturnType<typeof boardFixture> {
  const fixture = boardFixture({ tickets: [ticketFixture({ id: '001' })] });
  fixture.board.launchJob({
    kind: 'build', role: 'builder', ticketIds: ['001'], parentJobId: null, attempt: 1, target: 'main',
  }, AT);
  fixture.records.length = 0;
  return fixture;
}

function kindsLogged(records: readonly { kind: string }[]): string[] {
  return records.map((record) => record.kind);
}

describe('opening a decision', () => {
  test('numbers it from E1, stamps it, keeps the agent\'s questions exactly and logs decision-opened with its tickets', () => {
    const { board, progress, records } = boardWithAJob();
    const { decision } = board.openDecision(AGENT_QUESTION, AT);

    expect(decision).toEqual({ ...AGENT_QUESTION, id: 'E1', openedAt: AT });
    expect(progress.decisions).toEqual([{ ...AGENT_QUESTION, id: 'E1', openedAt: AT }]);
    expect(progress.nextDecisionId).toBe(2);
    expect(records).toEqual([{
      at: AT, kind: 'decision-opened', decisionId: 'E1', fields: { kind: 'agent-question', ticketIds: ['001'] }
    }]);
  });

  test('copies what it is handed, so a later change to the opening changes nothing on the board', () => {
    const { board } = boardWithAJob();
    const options   = [{ label: 'Yes', description: 'Ship it' }];
    board.openDecision({ ...AGENT_QUESTION, questions: [{ ...FORMAT_QUESTION, options }] }, AT);
    options.push({ label: 'No', description: 'Hold it' });
    expect(board.decisionById('E1')?.questions[0]?.options).toHaveLength(1);
  });

  test('a code-opened decision with no request opens every time it is asked', () => {
    const { board } = boardWithAJob();
    const outage    = {
      ...AGENT_QUESTION, kind: 'outage', jobId: null, askedBy: 'runner', requestId: null,
    } as const;
    board.openDecision(outage, AT);
    board.openDecision(outage, AT);
    expect(board.decisions().map((decision) => decision.id)).toEqual(['E1', 'E2']);
  });

  test('one asking no question is refused decision-without-questions, since its empty answer would make the log unreadable', () => {
    const { board, progress, records } = boardWithAJob();
    expect(refusalDetailOf(() => board.openDecision({ ...AGENT_QUESTION, questions: [] }, AT))).toEqual({ reason: 'decision-without-questions' });
    expect(progress.decisions).toBeUndefined();
    expect(progress.nextDecisionId).toBeUndefined();
    expect(records).toEqual([]);
  });
});

describe('a replayed question request', () => {
  test('still open gives the open decision back and logs nothing', () => {
    const { board, records } = boardWithAJob();
    board.openDecision(AGENT_QUESTION, AT);
    const replay = board.openDecision(AGENT_QUESTION, AT);

    expect(replay.decision?.id).toBe('E1');
    expect(replay.logged).toEqual([]);
    expect(board.decisions()).toHaveLength(1);
    expect(kindsLogged(records)).toEqual(['decision-opened']);
  });

  test('answered through the board opens nothing: the answer put the request on its job', () => {
    const { board } = boardWithAJob();
    board.openDecision(AGENT_QUESTION, AT);
    board.answerDecision('E1', ['CSV', 'Name, Total'], AT);

    expect(board.jobById('J1')?.answeredRequestIds).toEqual(['request-1']);
    expect(board.openDecision(AGENT_QUESTION, AT)).toEqual({ decision: null, logged: [] });
    expect(board.decisions()).toEqual([]);
  });

  test('already on the job\'s answered requests opens nothing', () => {
    const { board } = boardWithAJob();
    board.addAnsweredRequestId('J1', 'request-1');
    expect(board.openDecision(AGENT_QUESTION, AT)).toEqual({ decision: null, logged: [] });
  });

  test('open as an incident opens no decision beside it', () => {
    const { board } = boardWithAJob();
    board.openIncident({
      kind: 'system-question', ticketIds: ['001'], jobId: 'J1', facts: { requestId: 'request-1' }, defaultMove: 'incident-escalate',
    }, AT);
    expect(board.openDecision(AGENT_QUESTION, AT)).toEqual({ decision: null, logged: [] });
  });

  test('of another job is a request of its own', () => {
    const { board } = boardWithAJob();
    board.addAnsweredRequestId('J1', 'request-1');
    expect(board.openDecision({ ...AGENT_QUESTION, jobId: 'J2' }, AT).decision?.id).toBe('E1');
  });
});

describe('answering a decision', () => {
  test('stores one answer per question keyed by its text, takes the decision off the board and logs decision-answered', () => {
    const { board, progress, records } = boardWithAJob();
    board.openDecision(AGENT_QUESTION, AT);
    records.length = 0;
    const answered = board.answerDecision('E1', ['CSV', 'Name, Total'], AT);

    const answer = { [FORMAT_QUESTION.question]: 'CSV', [COLUMNS_QUESTION.question]: 'Name, Total' };
    expect(answered.answer).toEqual(answer);
    expect(answered.decision.id).toBe('E1');
    expect(progress.decisions).toEqual([]);
    expect(records).toEqual([{
      at: AT, kind: 'decision-answered', decisionId: 'E1', fields: { answer, requestId: 'request-1' }
    }]);
  });

  test('the first answer wins: a second is refused decision-already-answered and changes nothing', () => {
    const { board, records } = boardWithAJob();
    board.openDecision(AGENT_QUESTION, AT);
    board.answerDecision('E1', ['CSV', 'Name'], AT);
    const loggedBefore = records.length;

    expect(refusalDetailOf(() => board.answerDecision('E1', ['JSON', 'Total'], AT))).toEqual({ reason: 'decision-already-answered', decisionId: 'E1' });
    expect(records).toHaveLength(loggedBefore);
  });

  test('a withdrawn decision is refused as already settled', () => {
    const { board } = boardWithAJob();
    board.openDecision(AGENT_QUESTION, AT);
    board.withdrawDecision('E1', 'job stopped', AT);
    expect(refusalDetailOf(() => board.answerDecision('E1', ['CSV', 'Name'], AT))).toEqual({ reason: 'decision-already-answered', decisionId: 'E1' });
  });

  test('an id the board never handed out is refused unknown-decision', () => {
    const { board } = boardWithAJob();
    board.openDecision(AGENT_QUESTION, AT);
    for (const decisionId of ['E2', 'E0', 'J1', 'example']) {
      expect(refusalDetailOf(() => board.answerDecision(decisionId, ['CSV', 'Name'], AT))).toEqual({ reason: 'unknown-decision', decisionId });
    }
  });

  test.each([[[]], [['CSV']], [['CSV', 'Name', 'Total']]])('%p answers to two questions are refused decision-answer-count', (answers) => {
    const { board, progress } = boardWithAJob();
    board.openDecision(AGENT_QUESTION, AT);
    expect(refusalDetailOf(() => board.answerDecision('E1', answers, AT))).toEqual({
      reason: 'decision-answer-count', decisionId: 'E1', answerCount: answers.length, questionCount: 2
    });
    expect(progress.decisions).toHaveLength(1);
  });

  test('a decision of a job that already ended is still answered, with no job to note the request on', () => {
    const { board } = boardWithAJob();
    board.openDecision(AGENT_QUESTION, AT);
    board.endJob('J1', { outcome: 'stopped' }, AT);
    expect(board.answerDecision('E1', ['CSV', 'Name'], AT).decision.id).toBe('E1');
  });
});

describe('withdrawing a decision', () => {
  test('takes it off the board and logs decision-withdrawn with the reason', () => {
    const { board, progress, records } = boardWithAJob();
    board.openDecision(AGENT_QUESTION, AT);
    records.length = 0;
    board.withdrawDecision('E1', 'job stopped', AT);

    expect(progress.decisions).toEqual([]);
    expect(records).toEqual([{
      at: AT, kind: 'decision-withdrawn', decisionId: 'E1', fields: { reason: 'job stopped' }
    }]);
  });
});

describe('decision ids', () => {
  test('are never reused after a decision leaves the board', () => {
    const { board } = boardWithAJob();
    board.openDecision(AGENT_QUESTION, AT);
    board.answerDecision('E1', ['CSV', 'Name'], AT);
    expect(board.openDecision({ ...AGENT_QUESTION, requestId: 'request-2' }, AT).decision?.id).toBe('E2');
  });

  test('skip past a live id a hand-edited file left above the counter', () => {
    const { board, progress } = boardWithAJob();
    progress.decisions = [{
      ...AGENT_QUESTION, ticketIds: [], questions: [], id: 'E7', openedAt: AT
    }];
    expect(board.openDecision({ ...AGENT_QUESTION, requestId: 'request-2' }, AT).decision?.id).toBe('E8');
  });
});

function openThree(board: Board): void {
  for (const requestId of ['request-1', 'request-2', 'request-3']) board.openDecision({ ...AGENT_QUESTION, requestId }, AT);
}

test('the board lists its open decisions in opening order', () => {
  const { board } = boardWithAJob();
  openThree(board);
  board.answerDecision('E2', ['CSV', 'Name'], AT);
  expect(board.decisions().map((decision) => decision.id)).toEqual(['E1', 'E3']);
});
