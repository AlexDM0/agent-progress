/**
 * The tracker-model building block: the records of a board and their vocabularies and rules. It imports nothing outside its own
 * folder and no Node builtin, because the page's DOM-only project (`lib/render/page/tsconfig.json`) compiles it.
 */

export type TaskStatus = 'pending' | 'in-progress' | 'paused' | 'in-review' | 're-review' | 'reviewed' | 'delivered' | 'abandoned';

/** What a row, or a ticket through its row, shows: its status, except that an in-review row of an in-review ticket is being reviewed. */
export type DisplayState = TaskStatus | 'reviewing';

/** One status a row actually reached, and when. A correction never files one: a correction is not something that happened. */
export interface TaskPhase {
  status: TaskStatus;
  at:     string;
}

export interface Task {
  id:              number;
  name:            string;
  status:          TaskStatus;
  start:           string | null;
  end:             string | null;
  owner:           string;
  note:            string;
  /** The padded id (`"003"`) of the ticket this row belongs to, or `null` for a free-standing task. */
  ticket:          string | null;
  /**
   * The SubagentStop hook adds each agent's input, split evenly, to the rows its brief names via
   * `agent-progress row:` or `agent-progress ticket:`; `--tokens` on any command replaces the figure.
   * `null` ("nobody said") and `0` are different answers.
   */
  tokens:          number | null;
  /** When the row first reached `reviewed`; kept through delivery, so a delivered row says whether it was reviewed. */
  reviewed?:       string;
  /** Which review pass the row is in, counted from the second; absent while the first pass is the only one there has been. */
  reviewRound?:    number;
  /** The phases this row went through, oldest first; absent on a row filed before the field existed, which the page says rather than guesses. */
  history?:        TaskPhase[];
  /**
   * The agent this row belongs to: every row one `ticket claim` started carries the claimed ids joined (`"003,004,005"`), so a bundle's
   * in-progress rows count as one agent. Absent on a row no claim started, which counts as an agent of its own.
   */
  agent?:          string;
  /**
   * The padded id of the ticket this row reviews, written by `task add --review-of`; the page draws the row directly above that ticket's own row.
   * Absent on every other row; a free-standing row filed before the field existed is given it from its `Review <N> #<id>` name at ingestion.
   */
  reviewOf?:       string;
  /** Which review of the `reviewOf` ticket this bar is, from 1, fixed when the bar is filed; unlike `reviewRound`, no transition moves it. */
  reviewBarRound?: number;
}
