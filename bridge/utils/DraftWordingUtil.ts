/** How a draft's Kanban card and its detail panel word it; the state itself comes from the Board's facts, never from the page. */
import type { DraftState } from '../../src/lib/tracker-model/@types/Draft.ts';

const DRAFT_STATE_WORD: Readonly<Record<DraftState, string>> = {
  researching: 'Researching',
  waiting:     'Waiting on you',
  resumable:   'Ready to resume',
};

function stateWordOf(state: DraftState): string {
  return DRAFT_STATE_WORD[state];
}

/** `1 open question`, `3 open questions`. */
function openQuestionCountTextOf(openQuestionCount: number): string {
  return `${openQuestionCount} open ${openQuestionCount === 1 ? 'question' : 'questions'}`;
}

/** The state word, with the open questions counted while any is open: `Waiting on you · 2 open questions`. */
function stateLineOf(draft: { state: DraftState; openQuestionCount: number }): string {
  return draft.openQuestionCount > 0 ? `${stateWordOf(draft.state)} · ${openQuestionCountTextOf(draft.openQuestionCount)}` : stateWordOf(draft.state);
}

export const DraftWordingUtil = {
  stateWordOf,
  openQuestionCountTextOf,
  stateLineOf,
} as const;
