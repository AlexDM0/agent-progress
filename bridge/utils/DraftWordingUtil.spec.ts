/**
 * The words a draft's card and panel show for each Board state, and the open-question count's singular and plural, since the card reads
 * them as one line and the owner reads "Waiting on you" as the call to answer.
 */

import { describe, expect, test } from 'bun:test';

import { DraftWordingUtil } from './DraftWordingUtil.ts';

describe('DraftWordingUtil', () => {
  test('words each state as the ticket names it', () => {
    expect(DraftWordingUtil.stateWordOf('researching')).toBe('Researching');
    expect(DraftWordingUtil.stateWordOf('waiting')).toBe('Waiting on you');
    expect(DraftWordingUtil.stateWordOf('resumable')).toBe('Ready to resume');
  });

  test('counts one open question in the singular and more in the plural', () => {
    expect(DraftWordingUtil.openQuestionCountTextOf(1)).toBe('1 open question');
    expect(DraftWordingUtil.openQuestionCountTextOf(3)).toBe('3 open questions');
  });

  test('a state line adds the count only while a question is open', () => {
    expect(DraftWordingUtil.stateLineOf({ state: 'waiting', openQuestionCount: 2 })).toBe('Waiting on you · 2 open questions');
    expect(DraftWordingUtil.stateLineOf({ state: 'researching', openQuestionCount: 0 })).toBe('Researching');
  });
});
