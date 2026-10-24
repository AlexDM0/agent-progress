/**
 * The panel a draft card opens, read-only: the draft's head and facts, its request in the user's own words, then its question tree, each
 * follow-up under the answer that raised it. Every draft string passes `escapeHtml` once.
 */

import { HtmlEscapeUtil }         from '../../src/lib/html-escape/HtmlEscapeUtil.ts';
import type { DraftQuestion }     from '../../src/lib/tracker-model/@types/Draft.ts';
import type { DraftSummary }      from '../../src/lib/tracker-model/@types/Draft.ts';
import { DRAFT_CARD_STATE_TOKEN } from '../kanban/DraftCardModel.ts';
import { DraftWordingUtil }       from '../utils/DraftWordingUtil.ts';
import { MarkupUtil }             from '../utils/MarkupUtil.ts';
import type { TimestampSlices }   from '../utils/TimeUtil.ts';
import { DetailMarkupUtil }       from './utils/DetailMarkupUtil.ts';

const UNCLAIMED_TEXT    = 'nobody';
const NO_QUESTION_TEXT  = 'No question asked yet.';
const OPEN_ANSWER_TEXT  = 'open';

export interface DraftDetailInput {
  draft:             Readonly<DraftSummary> & { request: string };
  todayCalendarDate: string;
  slices:            TimestampSlices;
}

function headMarkup(draft: DraftDetailInput['draft']): string {
  return [
    `<div class="ap-detail-head" ${MarkupUtil.attribute('data-state', DRAFT_CARD_STATE_TOKEN)}>`,
    `<span class="ap-detail-id">${HtmlEscapeUtil.escapeHtml(draft.id)}</span>`,
    `<h2 class="ap-detail-title">${HtmlEscapeUtil.escapeHtml(draft.title)}</h2>`,
    `<span class="ap-pill">${HtmlEscapeUtil.escapeHtml(DraftWordingUtil.stateWordOf(draft.state))}</span>`,
    '</div>',
  ].join('');
}

function factsMarkup(input: DraftDetailInput): string {
  const { draft } = input;
  const facts = [
    DetailMarkupUtil.factMarkup('claimed by', `<span>${HtmlEscapeUtil.escapeHtml(draft.claimOwner ?? UNCLAIMED_TEXT)}</span>`),
    DetailMarkupUtil.factMarkup('opened', MarkupUtil.stampMarkup('span', draft.openedAt, input.todayCalendarDate, input.slices)),
    draft.openQuestionCount === 0
      ? ''
      : DetailMarkupUtil.factMarkup('waiting on you', `<span>${HtmlEscapeUtil.escapeHtml(DraftWordingUtil.openQuestionCountTextOf(draft.openQuestionCount))}</span>`),
  ];
  return `<div class="ap-ticket-meta">${facts.join('')}</div>`;
}

function chosenLettersOf(question: DraftQuestion): readonly string[] {
  return question.answer !== null && 'letters' in question.answer ? question.answer.letters : [];
}

function optionMarkup(question: DraftQuestion, option: DraftQuestion['options'][number]): string {
  const isRecommended = question.recommended.includes(option.letter);
  const isChosen      = chosenLettersOf(question).includes(option.letter);
  return [
    `<li class="ap-draft-option"${isRecommended ? ' data-recommended=""' : ''}${isChosen ? ' data-chosen=""' : ''}>`,
    `<span class="ap-draft-option-letter">${HtmlEscapeUtil.escapeHtml(option.letter)}</span>`,
    `<span class="ap-draft-option-text">${HtmlEscapeUtil.escapeHtml(option.text)}</span>`,
    isRecommended ? '<span class="ap-draft-mark" data-mark="recommended">recommended</span>' : '',
    isChosen ? '<span class="ap-draft-mark" data-mark="chosen">chosen</span>' : '',
    '</li>',
  ].join('');
}

/** The chosen letters as the options read them, `a, c`, or the free-text answer, or "open". */
function answerMarkup(question: DraftQuestion): string {
  const { answer } = question;
  if (answer === null) {
    return `<p class="ap-draft-answer" data-open=""><b>answer</b>${OPEN_ANSWER_TEXT}</p>`;
  }
  const answerText = 'letters' in answer ? answer.letters.join(', ') : answer.text;
  return `<p class="ap-draft-answer"><b>answer</b>${HtmlEscapeUtil.escapeHtml(answerText)}</p>`;
}

function questionMarkup(question: DraftQuestion): string {
  return [
    `<li class="ap-draft-question" ${MarkupUtil.attribute('data-question-id', question.id)}${question.answer === null ? ' data-open=""' : ''}>`,
    `<p class="ap-draft-question-head"><span class="ap-ticket-id">${HtmlEscapeUtil.escapeHtml(question.id)}</span>`,
    `<span class="ap-draft-question-text">${HtmlEscapeUtil.escapeHtml(question.question)}</span>`,
    question.multiple ? '<span class="ap-draft-mark" data-mark="multiple">multi-select</span>' : '',
    '</p>',
    question.context === '' ? '' : `<p class="ap-draft-context">${HtmlEscapeUtil.escapeHtml(question.context)}</p>`,
    question.options.length === 0 ? '' : `<ol class="ap-draft-options">${question.options.map((option) => optionMarkup(question, option)).join('')}</ol>`,
    answerMarkup(question),
    questionsMarkup(question.followUps),
    '</li>',
  ].join('');
}

function questionsMarkup(questions: readonly DraftQuestion[]): string {
  return questions.length === 0 ? '' : `<ol class="ap-draft-questions">${questions.map(questionMarkup).join('')}</ol>`;
}

export function draftDetailMarkup(input: DraftDetailInput): string {
  const { draft } = input;
  return [
    headMarkup(draft),
    factsMarkup(input),
    DetailMarkupUtil.sectionMarkup('Request', `<p class="ap-draft-request">${HtmlEscapeUtil.escapeHtml(draft.request)}</p>`),
    DetailMarkupUtil.sectionMarkup('Questions', draft.questions.length === 0 ? `<p class="ap-empty">${NO_QUESTION_TEXT}</p>` : questionsMarkup(draft.questions)),
  ].join('');
}
