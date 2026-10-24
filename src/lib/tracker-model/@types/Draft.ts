/** A draft is a working record a filing session builds tickets from, never a ticket: it has no status, row or move. */
export interface DraftClaim {
  owner:     string;
  claimedAt: string;
}

export type DraftNoteKind = 'fact' | 'assumption';

/** A research fact, its paths written in the text, or an assumption, `N1`, `N2`, …. */
export interface DraftNote {
  id:   string;
  kind: DraftNoteKind;
  text: string;
}

export interface DraftQuestionOption {
  /** `a` to `d`, in the order the options were given. */
  letter: string;
  text:   string;
}

/** Either the chosen option letters, in the order given, or free text: never both. */
export type DraftAnswer =
  | { letters: string[]; answeredAt: string }
  | { text: string; answeredAt: string };

/** `Q1`, `Q2`, …: a question with its follow-ups under it, so a grilling session's tree is kept as a tree. */
export interface DraftQuestion {
  id:          string;
  question:    string;
  context:     string;
  options:     DraftQuestionOption[];
  /** True for a multi-select question, whose recommendation and answer may name several letters. */
  multiple:    boolean;
  recommended: string[];
  /** Null while the question is open. */
  answer:      DraftAnswer | null;
  followUps:   DraftQuestion[];
}

export interface Draft {
  /** `D1`, `D2`, …: the draft's file name too. */
  id:                 string;
  title:              string;
  /** The user's request in their own words, kept byte for byte. */
  request:            string;
  openedAt:           string;
  /** Null while nobody holds the draft. */
  claim:              DraftClaim | null;
  notes:              DraftNote[];
  /** The top-level questions, each holding its follow-ups. */
  questions:          DraftQuestion[];
  /** Stored and never wound back, so a dropped item's number is never handed to a new one. */
  nextNoteNumber:     number;
  nextQuestionNumber: number;
  /** Every stored key the model does not own, in stored order, so a rewrite does not eat it. */
  extra:              Array<[key: string, value: unknown]>;
}

export interface DraftOpening {
  title:   string;
  request: string;
  owner:   string;
}

export interface DraftNoteAddition {
  text: string;
  kind: DraftNoteKind;
}

export interface DraftQuestionAsking {
  question:           string;
  context:            string;
  optionTexts:        readonly string[];
  multiple:           boolean;
  recommendedLetters: readonly string[];
  /** The question this one follows up, or null for a top-level question. */
  underQuestionId:    string | null;
}

/**
 * `waiting` while any question is open, `researching` when none is and the draft is claimed, `resumable` when none is and nobody holds
 * the claim. No clock decides it.
 */
export type DraftState = 'waiting' | 'researching' | 'resumable';

/** What `status --json` and the page's `boardFacts` list for each open draft, the whole question tree included for the detail panel. */
export interface DraftSummary {
  id:                string;
  title:             string;
  claimOwner:        string | null;
  openedAt:          string;
  state:             DraftState;
  openQuestionCount: number;
  questions:         readonly DraftQuestion[];
}
