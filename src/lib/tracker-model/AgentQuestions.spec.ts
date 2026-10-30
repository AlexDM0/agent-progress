/**
 * An agent's question through its life on the Board. What matters: `decide`'s letters resolve to the agent's own option labels, and every
 * malformed choice is refused before anything is written; answering moves a job waiting on that answer alone back to `running`; a ticket
 * job ended `replaced` or `stopped` leaves its question on the ticket, held `awaiting answer (E<n>)`, and the answer goes under `##
 * Questions` and lifts the hold; a question incident escalates with exactly the agent's words; and only a board's first overseer start holds
 * the v16 low leftovers, in one `findings-delivered` incident.
 */
import { describe, expect, test } from 'bun:test';

import { boardFixture, refusalDetailOf, ticketFixture } from '../../testing/BoardFixtures.ts';
import type { DecisionOpening, DecisionQuestion }       from './@types/Decision.ts';
import { Board }                                        from './Board.ts';
import { createLogger }                                 from './Logger.ts';
import { QUESTIONS_FACT, REQUEST_ID_FACT }              from './constants/DecisionAndIncidentVocabulary.ts';

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
  options:     [{ label: 'Name', description: 'Alex Example' }, { label: 'Total', description: 'The cart total' }, { label: 'Date', description: 'Ordered on' }],
};

const AGENT_QUESTION = {
  kind:      'agent-question',
  ticketIds: ['001'],
  jobId:     'J1',
  askedBy:   'builder',
  requestId: 'request-1',
  questions: [FORMAT_QUESTION, COLUMNS_QUESTION],
  context:   '',
} satisfies DecisionOpening;

function boardWithAWaitingJob(): ReturnType<typeof boardFixture> {
  const fixture = boardFixture({ tickets: [ticketFixture({ id: '001', status: 'in-progress' })] });
  fixture.board.launchJob({
    kind: 'build', role: 'builder', ticketIds: ['001'], parentJobId: null, attempt: 1, target: 'main',
  }, AT);
  fixture.board.moveJob('J1', 'running', AT);
  fixture.board.openDecision(AGENT_QUESTION, AT);
  fixture.board.moveJob('J1', 'waiting-for-answer', AT);
  fixture.records.length = 0;
  return fixture;
}

function ticketOf(board: Board): ReturnType<Board['tickets']>[number] {
  const [ticket] = board.tickets();
  if (ticket === undefined) throw new Error('the fixture holds no ticket');
  return ticket;
}

describe('answering in decide\'s forms', () => {
  test('a letter per question names the agent\'s option labels, a multi-select\'s letters joined, and the job runs again', () => {
    const { board } = boardWithAWaitingJob();
    const answered = board.answerDecisionInForm('E1', { form: 'letters', choices: ['b', 'ac'] }, AT);

    expect(answered.answer).toEqual({ [FORMAT_QUESTION.question]: 'JSON', [COLUMNS_QUESTION.question]: 'Name, Date' });
    expect(board.jobById('J1')).toMatchObject({ state: 'running', answeredRequestIds: ['request-1'] });
    expect(answered.logged.map((record) => record.kind)).toEqual(['decision-answered']);
  });

  test.each([
    ['a letter naming no option', { form: 'letters', choices: ['c', 'a'] }, 'decision-option-unknown'],
    ['a repeated letter', { form: 'letters', choices: ['a', 'aa'] }, 'decision-option-unknown'],
    ['two letters on a single choice', { form: 'letters', choices: ['ab', 'a'] }, 'decision-single-choice'],
    ['one choice for two questions', { form: 'letters', choices: ['a'] }, 'decision-answer-count'],
    ['free text for two questions', { form: 'text', text: 'Whatever is simplest' }, 'decision-has-several-questions'],
  ] as const)('%s is refused and writes nothing', (_title, form, reason) => {
    const { board, records } = boardWithAWaitingJob();
    expect(refusalDetailOf(() => board.answerDecisionInForm('E1', form, AT)).reason).toBe(reason);
    expect(board.decisionById('E1')).toBeDefined();
    expect(records).toEqual([]);
  });

  test('free text answers a one-question decision as written', () => {
    const { board } = boardWithAWaitingJob();
    board.withdrawDecision('E1', 'example', AT);
    board.openDecision({ ...AGENT_QUESTION, requestId: 'request-2', questions: [FORMAT_QUESTION] }, AT);
    expect(board.answerDecisionInForm('E2', { form: 'text', text: 'Parquet, please' }, AT).answer).toEqual({ [FORMAT_QUESTION.question]: 'Parquet, please' });
  });

  test('the second answer is refused: the first wins', () => {
    const { board } = boardWithAWaitingJob();
    board.answerDecisionInForm('E1', { form: 'letters', choices: ['a', 'b'] }, AT);
    expect(refusalDetailOf(() => board.answerDecisionInForm('E1', { form: 'letters', choices: ['b', 'a'] }, AT)).reason).toBe('decision-already-answered');
  });
});

describe('a question that outlives its job', () => {
  test.each(['replaced', 'stopped'] as const)('a build job ended %s holds its ticket awaiting the answer, which goes under ## Questions', (outcome) => {
    const { board } = boardWithAWaitingJob();
    board.endJob('J1', { outcome }, AT);

    expect(board.decisionById('E1')).toMatchObject({ jobId: null, ticketIds: ['001'] });
    expect(ticketOf(board).frontmatter.hold).toBe('awaiting answer (E1)');

    const answered = board.answerDecisionInForm('E1', { form: 'letters', choices: ['a', 'b'] }, AT);
    expect(ticketOf(board).frontmatter.hold).toBeUndefined();
    expect(ticketOf(board).body).toBe(`\n## Questions\n\n- ${FORMAT_QUESTION.question}\n  Answer (E1): CSV\n- ${COLUMNS_QUESTION.question}\n  Answer (E1): Total\n`);
    expect(answered.logged.map((record) => record.kind)).toContain('ticket-unheld');
  });

  test('a job ended any other way leaves its decision on the job', () => {
    const { board } = boardWithAWaitingJob();
    board.endJob('J1', { outcome: 'failed' }, AT);
    expect(board.decisionById('E1')?.jobId).toBe('J1');
    expect(ticketOf(board).frontmatter.hold).toBeUndefined();
  });
});

describe('escalating a question incident', () => {
  test('opens an agent-question carrying exactly the agent\'s questions and the request, with no context of the orchestrator\'s', () => {
    const { board } = boardWithAWaitingJob();
    board.withdrawDecision('E1', 'example', AT);
    board.openIncident({
      kind:        'malformed-ticket',
      ticketIds:   ['001'],
      jobId:       'J1',
      facts:       { [REQUEST_ID_FACT]: 'request-2', [QUESTIONS_FACT]: JSON.stringify([FORMAT_QUESTION]) },
      defaultMove: 'incident-escalate',
    }, AT);

    const escalated = board.escalateQuestionIncident('I1', AT);

    expect(escalated.decision).toMatchObject({
      kind: 'agent-question', jobId: 'J1', askedBy: 'builder', requestId: 'request-2', questions: [FORMAT_QUESTION], context: '', ticketIds: ['001'],
    });
    expect(board.incidents()).toEqual([]);
  });

  test('an incident no question opened has nothing to escalate', () => {
    const { board } = boardWithAWaitingJob();
    board.openIncident({
      kind: 'system-question', ticketIds: ['001'], jobId: null, facts: { notes: 'Example' }, defaultMove: 'incident-escalate'
    }, AT);
    expect(refusalDetailOf(() => board.escalateQuestionIncident('I1', AT)).reason).toBe('decision-without-questions');
  });
});

describe('the overseer\'s first start', () => {
  function boardOfV16Tickets(): ReturnType<typeof boardFixture> {
    return boardFixture({
      tickets: [
        ticketFixture({ id: '001', status: 'pending', priority: 'low' }),
        ticketFixture({ id: '002', status: 'pending', priority: 'normal' }),
        ticketFixture({ id: '003', status: 'pending', priority: 'high' }),
        ticketFixture({ id: '004', status: 'pending', priority: 'low' }),
      ],
    });
  }

  test('holds every low pending ticket first-run review and lists them in one findings-delivered incident, asking User nothing', () => {
    const { board } = boardOfV16Tickets();
    board.holdFirstRunLeftovers(AT);

    expect(board.tickets().map((ticket) => [ticket.frontmatter.id, ticket.frontmatter.hold])).toEqual([
      ['001', 'first-run review'], ['002', undefined], ['003', undefined], ['004', 'first-run review'],
    ]);
    expect(board.incidents()).toMatchObject([{ kind: 'findings-delivered', ticketIds: ['001', '004'], jobId: null }]);
    expect(board.decisions()).toEqual([]);
  });

  test('a board whose log holds overseer-started holds nothing, and neither does a fresh board', () => {
    const started = boardOfV16Tickets();
    started.board.recordOverseerStarted({ codeVersion: 'example', installVersion: 17 }, AT);
    expect(started.board.holdFirstRunLeftovers(AT).logged).toEqual([]);

    const fresh = boardFixture();
    expect(fresh.board.holdFirstRunLeftovers(AT).logged).toEqual([]);
    expect(fresh.board.incidents()).toEqual([]);
  });

  test('a start after clear threw the log away holds nothing: the first start is kept in progress.json', () => {
    const { board, progress, tickets } = boardFixture({ tickets: [ticketFixture({ id: '001', status: 'pending', priority: 'normal' })] });
    board.holdFirstRunLeftovers(AT);
    board.recordOverseerStarted({ codeVersion: 'example', installVersion: 17 }, AT);
    board.clearTracker({ ticketsSurvive: true }, AT);

    const ticketsAfterClear = [...tickets, ticketFixture({ id: '002', status: 'pending', priority: 'low' })];
    const restarted         = new Board({
      progress, tickets: ticketsAfterClear, epics: [], logger: createLogger(() => undefined)
    });
    expect(restarted.holdFirstRunLeftovers(AT).logged).toEqual([]);
    expect(restarted.tickets().map((ticket) => ticket.frontmatter.hold)).toEqual([undefined, undefined]);
    expect(restarted.incidents()).toEqual([]);
  });
});
