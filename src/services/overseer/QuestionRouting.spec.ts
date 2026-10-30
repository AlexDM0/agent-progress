/**
 * An agent's question request routed by its headers. What matters: only a request whose every question is headed `system` or every one
 * `ticket` reaches the Assistant, as a `system-question` or `malformed-ticket` incident carrying the request and exactly the agent's
 * questions; anything else, a mix of reserved and other headers included, is User's `agent-question` with the agent's questions and
 * options; either way the job waits keeping its build slot, and a replayed or answered request opens nothing twice.
 */
import { describe, expect, test } from 'bun:test';

import type { AgentQuestion }              from '../../lib/agent-launch/AgentSessionEvent.ts';
import { QUESTIONS_FACT, REQUEST_ID_FACT } from '../../lib/tracker-model/constants/DecisionAndIncidentVocabulary.ts';
import { boardFixture, ticketFixture }     from '../../testing/BoardFixtures.ts';
import { QuestionRouting }                 from './QuestionRouting.ts';

const AT = '2026-09-26T10:15:00+02:00';

function questionHeaded(header: string): AgentQuestion {
  return {
    question: `Example question headed ${header}?`, header, multiSelect: false, options: [{ label: 'Yes', description: 'Go on' }, { label: 'No', description: 'Stop' }],
  };
}

function runningBuild(): ReturnType<typeof boardFixture> {
  const fixture = boardFixture({ tickets: [ticketFixture({ id: '001', status: 'in-progress' })], concurrencyLimit: 1 });
  fixture.board.launchJob({
    kind: 'build', role: 'builder', ticketIds: ['001'], parentJobId: null, attempt: 1, target: 'main',
  }, AT);
  fixture.board.moveJob('J1', 'running', AT);
  return fixture;
}

describe('the route of a request', () => {
  test.each([
    [['system'], 'system-question'],
    [['system', 'system'], 'system-question'],
    [['ticket'], 'malformed-ticket'],
    [['ticket', 'ticket'], 'malformed-ticket'],
    [['Format'], 'agent-question'],
    [['system', 'ticket'], 'agent-question'],
    [['system', 'Format'], 'agent-question'],
    [['ticket', 'Format'], 'agent-question'],
  ] as const)('headers %p route to %s', (headers, route) => {
    expect(QuestionRouting.routeOf(headers.map((header) => ({ header })))).toBe(route);
  });
});

describe('opening a question in the hold that reads it', () => {
  test('a user question opens an agent-question with exactly the agent\'s questions and options, and the job waits on its slot', () => {
    const { board } = runningBuild();
    const questions = [questionHeaded('Format'), questionHeaded('system')];
    QuestionRouting.openQuestion(board, 'J1', 'request-1', questions, AT);

    expect(board.decisions()).toMatchObject([{
      kind: 'agent-question', jobId: 'J1', askedBy: 'builder', requestId: 'request-1', ticketIds: ['001'], questions, context: '',
    }]);
    expect(board.incidents()).toEqual([]);
    // The waiting job stays live, and `src/lib/tracker-model/Playbook.spec.ts` holds that a waiting job keeps its slot.
    expect(board.jobs().map((job) => [job.id, job.state])).toEqual([['J1', 'waiting-for-answer']]);
  });

  test.each([['system', 'system-question'], ['ticket', 'malformed-ticket']] as const)('every question headed %s opens a %s incident for the Assistant', (header, kind) => {
    const { board } = runningBuild();
    const questions = [questionHeaded(header), questionHeaded(header)];
    QuestionRouting.openQuestion(board, 'J1', 'request-1', questions, AT);

    expect(board.decisions()).toEqual([]);
    expect(board.incidents()).toMatchObject([{
      kind, jobId: 'J1', ticketIds: ['001'], defaultMove: 'incident-escalate', facts: { [REQUEST_ID_FACT]: 'request-1', [QUESTIONS_FACT]: JSON.stringify(questions) },
    }]);
    expect(board.jobById('J1')?.state).toBe('waiting-for-answer');
  });

  test('a replayed request opens nothing twice, and an answered one opens nothing at all', () => {
    const { board } = runningBuild();
    QuestionRouting.openQuestion(board, 'J1', 'request-1', [questionHeaded('system')], AT);
    QuestionRouting.openQuestion(board, 'J1', 'request-1', [questionHeaded('system')], AT);
    expect(board.incidents()).toHaveLength(1);

    board.addAnsweredRequestId('J1', 'request-2');
    QuestionRouting.openQuestion(board, 'J1', 'request-2', [questionHeaded('Format')], AT);
    expect(board.decisions()).toEqual([]);
  });
});
