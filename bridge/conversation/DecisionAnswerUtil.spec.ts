/**
 * A decision card's answer. What matters: an answer is only sendable whole, one letter per single-select question and the sorted letters of
 * a multi-select, and free text answers only a decision of one question.
 */
import { describe, expect, test } from 'bun:test';

import type { DecisionDocument } from '../@types/ConversationDocuments.ts';
import { DecisionAnswerUtil }    from './DecisionAnswerUtil.ts';

function decisionOf(id: string, questions: DecisionDocument['questions']): DecisionDocument {
  return {
    id, kind: 'agent-question', ticketIds: ['042'], jobId: 'J3', askedBy: 'builder', questions, context: 'Example context', openedAt: '2026-10-29T20:00:00+01:00'
  };
}

const ONE_QUESTION = [{
  question: 'Which store?', header: 'Store', multiSelect: false, options: [{ label: 'Disk', description: '' }, { label: 'Memory', description: '' }]
}];
const TWO_QUESTIONS = [
  ...ONE_QUESTION,
  {
    question:    'Which targets?',
    header:      'Targets',
    multiSelect: true,
    options:     [{ label: 'main', description: '' }, { label: 'group', description: '' }, { label: 'none', description: '' }],
  },
];

describe('DecisionAnswerUtil.answerOf', () => {
  test('one option letter per single-select question and the sorted letters of a multi-select', () => {
    expect(DecisionAnswerUtil.answerOf(decisionOf('E5', TWO_QUESTIONS), [[1], [2, 0]], '')).toEqual({ form: 'letters', choices: ['b', 'ac'] });
  });

  test('free text answers a decision of one question, never one of several', () => {
    expect(DecisionAnswerUtil.answerOf(decisionOf('E2', ONE_QUESTION), [], '  Use disk  ')).toEqual({ form: 'text', text: 'Use disk' });
    expect(DecisionAnswerUtil.answerOf(decisionOf('E5', TWO_QUESTIONS), [], 'Both')).toBeNull();
  });

  test('an unanswered question keeps the answer unsendable', () => {
    expect(DecisionAnswerUtil.answerOf(decisionOf('E5', TWO_QUESTIONS), [[0]], '')).toBeNull();
  });
});

describe('DecisionAnswerUtil.optionLetterOf', () => {
  test('the options are lettered from a', () => {
    expect([0, 1, 2].map(DecisionAnswerUtil.optionLetterOf)).toEqual(['a', 'b', 'c']);
  });
});
