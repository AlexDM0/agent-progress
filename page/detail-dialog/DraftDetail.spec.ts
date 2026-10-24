/**
 * The panel a draft card opens: the request, the claim owner and the whole question tree, read-only. What matters is that nothing of
 * the tree is lost (context, every option, every recommended letter, the answer or "open", a multi-select mark) and that a follow-up
 * sits under the answer that raised it; and that every draft string is escaped exactly once, since a request is the user's raw text.
 */

import { describe, expect, test } from 'bun:test';

import type { DraftQuestion }  from '../../src/lib/tracker-model/@types/Draft.ts';
import { exampleQuestion }     from '../testing/DraftFixture.ts';
import { EXAMPLE_PAGE_LIMITS } from '../testing/PageLimitsFixture.ts';
import { draftDetailMarkup }   from './DraftDetail.ts';

const ANSWERED_AT = '2026-09-25T10:00:00+02:00';

function detailOf(questions: DraftQuestion[], changes: { claimOwner?: string | null; request?: string; title?: string } = {}): string {
  const openQuestionCount = 2;
  return draftDetailMarkup({
    draft: {
      id:         'D7',
      title:      changes.title ?? 'Example draft',
      claimOwner: changes.claimOwner === undefined ? 'opus' : changes.claimOwner,
      openedAt:   '2026-09-25T09:00:00+02:00',
      state:      'waiting',
      openQuestionCount,
      questions,
      request:    changes.request ?? 'Alex Example asks.',
    },
    todayCalendarDate: '2026-09-25',
    slices:            EXAMPLE_PAGE_LIMITS,
  });
}

const TREE: DraftQuestion[] = [
  exampleQuestion('Q1', {
    question:    'Which <lane>?',
    context:     'Cards & "lanes".',
    recommended: ['b'],
    answer:      { letters: ['a'], answeredAt: ANSWERED_AT },
    followUps:   [exampleQuestion('Q2', { question: 'Follow-up?' })],
  }),
  exampleQuestion('Q3', {
    options:     [{ letter: 'a', text: 'Kanban' }, { letter: 'b', text: 'Gantt' }, { letter: 'c', text: 'Waves' }],
    multiple:    true,
    recommended: ['a', 'c'],
    answer:      { letters: ['a', 'b'], answeredAt: ANSWERED_AT },
  }),
  exampleQuestion('Q4', { answer: { text: 'Neither, <both>.', answeredAt: ANSWERED_AT } }),
];

function questionOf(markup: string, questionId: string): string {
  const start = markup.indexOf(`data-question-id="${questionId}"`);
  return start === -1 ? '' : markup.slice(start);
}

describe('a draft\'s detail panel', () => {
  test('heads with the id, the title and the state word, then the claim owner and the open-question count', () => {
    const markup = detailOf(TREE);

    expect(markup).toContain('<div class="ap-detail-head" data-state="draft"><span class="ap-detail-id">D7</span>'
      + '<h2 class="ap-detail-title">Example draft</h2><span class="ap-pill">Waiting on you</span></div>');
    expect(markup).toContain('<div><b>claimed by</b><span>opus</span></div>');
    expect(markup).toContain('<div><b>waiting on you</b><span>2 open questions</span></div>');
    expect(detailOf(TREE, { claimOwner: null })).toContain('<div><b>claimed by</b><span>nobody</span></div>');
  });

  test('shows the request byte for byte, escaped once', () => {
    expect(detailOf(TREE, { request: 'Line one\n  <b>&amp;</b>' })).toContain('<p class="ap-draft-request">Line one\n  &lt;b&gt;&amp;amp;&lt;/b&gt;</p>');
  });

  test('shows each question with its context and every option, the recommended one marked, escaped once', () => {
    const first = questionOf(detailOf(TREE), 'Q1');

    expect(first).toContain('<span class="ap-draft-question-text">Which &lt;lane&gt;?</span>');
    expect(first).toContain('<p class="ap-draft-context">Cards &amp; &quot;lanes&quot;.</p>');
    expect(first).toContain('<li class="ap-draft-option" data-chosen=""><span class="ap-draft-option-letter">a</span><span class="ap-draft-option-text">First option</span>'
      + '<span class="ap-draft-mark" data-mark="chosen">chosen</span></li>');
    expect(first).toContain('<li class="ap-draft-option" data-recommended=""><span class="ap-draft-option-letter">b</span><span class="ap-draft-option-text">Second option</span>'
      + '<span class="ap-draft-mark" data-mark="recommended">recommended</span></li>');
  });

  test('an answered question shows its answer, an open one "open"', () => {
    const markup = detailOf(TREE);

    expect(questionOf(markup, 'Q1')).toContain('<p class="ap-draft-answer"><b>answer</b>a</p>');
    expect(questionOf(markup, 'Q2')).toStartWith('data-question-id="Q2" data-open="">');
    expect(questionOf(markup, 'Q2')).toContain('<p class="ap-draft-answer" data-open=""><b>answer</b>open</p>');
    expect(questionOf(markup, 'Q4')).toContain('<p class="ap-draft-answer"><b>answer</b>Neither, &lt;both&gt;.</p>');
  });

  test('a follow-up is nested under its parent\'s answer, inside the parent\'s item', () => {
    const markup = detailOf(TREE);
    const q1Item = markup.slice(markup.indexOf('data-question-id="Q1"'), markup.indexOf('data-question-id="Q3"'));

    expect(q1Item).toMatch(/<p class="ap-draft-answer"><b>answer<\/b>a<\/p><ol class="ap-draft-questions"><li class="ap-draft-question" data-question-id="Q2"/u);
    expect(q1Item).toEndWith('</li></ol></li><li class="ap-draft-question" ');
  });

  test('a multi-select question is marked as such, every recommended letter marked and each chosen option shown', () => {
    const third = questionOf(detailOf(TREE), 'Q3').split('data-question-id="Q4"')[0] ?? '';

    expect(third).toContain('<span class="ap-draft-mark" data-mark="multiple">multi-select</span>');
    expect([...third.matchAll(/data-mark="recommended"/gu)]).toHaveLength(2);
    expect([...third.matchAll(/<li class="ap-draft-option"[^>]*data-chosen=""/gu)]).toHaveLength(2);
    expect(third).toContain('<p class="ap-draft-answer"><b>answer</b>a, b</p>');
    expect(questionOf(detailOf(TREE), 'Q1').split('data-question-id="Q3"')[0]).not.toContain('data-mark="multiple"');
  });

  test('a draft with no question says so', () => {
    expect(detailOf([])).toContain('<p class="ap-empty">No question asked yet.</p>');
  });
});
