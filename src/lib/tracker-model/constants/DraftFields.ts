/** The number the first draft a tracker opens takes, `D1`: the lowest `nextDraftId` a progress file may store. */
export const FIRST_DRAFT_NUMBER = 1;

/** The number a draft's first note and first question take, `N1` and `Q1`. */
export const FIRST_DRAFT_ITEM_NUMBER = 1;

export const DRAFT_NOTE_PREFIX = 'N';

export const DRAFT_QUESTION_PREFIX = 'Q';

/** A question's options are lettered in the order given, so its option count is at most this list's length. */
export const DRAFT_OPTION_LETTERS = ['a', 'b', 'c', 'd'] as const;

export const MINIMUM_DRAFT_QUESTION_OPTIONS = 2;
