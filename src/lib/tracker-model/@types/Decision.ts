/**
 * A question for the user, stored in progress.json while it is open so it survives a reboot and is answered from anywhere; the first
 * answer wins. An answered or withdrawn decision leaves the board in that hold and lives on in the log.
 */
import type { JobRole } from './Job.ts';

export type DecisionKind =
  | 'agent-question'
  | 'ready-drafts'
  | 'parked'
  | 'waiver'
  | 'landing-refused'
  | 'merge-refused'
  | 'checks-not-set'
  | 'target-moved'
  | 'branch-touches-agent-config'
  | 'outage'
  | 'quiet-job'
  | 'leftover-worktree';

export interface DecisionQuestionOption {
  label:       string;
  description: string;
}

/** AskUserQuestion's own question shape, field for field, so an agent's question is stored exactly as it asked it. */
export interface DecisionQuestion {
  question:    string;
  header:      string;
  multiSelect: boolean;
  options:     DecisionQuestionOption[];
}

/** An agent's role for its own question; `runner` for a decision code opens from the facts, `orchestrator` for its `ticket park`. */
export type DecisionAsker = JobRole | 'runner' | 'orchestrator';

export interface Decision {
  id:        string;
  kind:      DecisionKind;
  ticketIds: string[];
  jobId:     string | null;
  askedBy:   DecisionAsker;
  /** The AskUserQuestion request it was opened for, so a replayed request opens no second decision; `null` for one code opened. */
  requestId: string | null;
  questions: DecisionQuestion[];
  context:   string;
  openedAt:  string;
}

/** What a caller hands in to open one: the Board numbers it and stamps it. */
export type DecisionOpening = Omit<Decision, 'id' | 'openedAt' | 'ticketIds' | 'questions'> & {
  ticketIds: readonly string[];
  questions: readonly Readonly<DecisionQuestion>[];
};

/** One answer per question, keyed by the question's text: the map agent-dashboard sends. */
export type DecisionAnswer = Readonly<Record<string, string>>;
