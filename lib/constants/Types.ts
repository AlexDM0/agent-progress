/** Types only, no imports: the browser page's project (`lib/render/page/tsconfig.json`) compiles this module alongside its own files. */

export type TaskStatus = 'pending' | 'running' | 'paused' | 'finished' | 're-review' | 'reviewed' | 'delivered' | 'abandoned';

/** One status a row actually reached, and when. A correction never files one: a correction is not something that happened. */
export interface TaskPhase {
  status: TaskStatus;
  at:     string;
}

export interface Task {
  id:           number;
  name:         string;
  status:       TaskStatus;
  start:        string | null;
  end:          string | null;
  owner:        string;
  note:         string;
  /** The padded id (`"003"`) of the ticket this row belongs to, or `null` for a free-standing task. */
  ticket:       string | null;
  /**
   * The SubagentStop hook adds each agent's input, split evenly, to the rows its brief names via
   * `agent-progress row:` or `agent-progress ticket:`; `--tokens` on any command replaces the figure.
   * `null` ("nobody said") and `0` are different answers.
   */
  tokens:       number | null;
  /** When the row first reached `reviewed`; kept through delivery, so a delivered row says whether it was reviewed. */
  reviewed?:    string;
  /** Which review pass the row is in, counted from the second; absent while the first pass is the only one there has been. */
  reviewRound?: number;
  /** The phases this row went through, oldest first; absent on a row filed before the field existed, which the page says rather than guesses. */
  history?:     TaskPhase[];
  /**
   * The agent this row belongs to: every row one `ticket claim` started carries the claimed ids joined (`"003,004,005"`), so a bundle's
   * running rows count as one agent. Absent on a row no claim started, which counts as an agent of its own.
   */
  agent?:       string;
  /**
   * The padded id of the ticket this row reviews, written by `task add --review-of`; the page draws the row under that ticket's own row.
   * Absent on every other row, and on a review row filed before the field existed, whose `Review <N> #<id>` name the page reads instead.
   */
  reviewOf?:    string;
}

export interface LogEntry {
  at:   string;
  text: string;
}

/** `relative` forms are stored raw (`"-2h"`, `"start"`, `"now"`) and resolved against an explicit `now` at layout time. */
export type ViewRange =
  | { kind: 'auto' }
  | { kind: 'absolute'; from: string; to: string; tickMinutes: number | null }
  | { kind: 'relative'; from: string; to: string; tickMinutes: number | null };

/** `finished` ended by itself and is relaunched when a ticket is ready; `stopped`, never started or ended by the user, waits for the user's go. */
export type DispatcherState = 'running' | 'finished' | 'stopped';

export interface ProgressFile {
  version:           1;
  trackerId:         string;
  project:           string;
  startedAt:         string;
  view:              ViewRange;
  /** Never wound back, not by `task remove` and not by `clear`, so an id is never handed out twice. */
  nextTaskId:        number;
  /** How many agents may be in flight at once; absent on a tracker that never set one, which reads as the default. */
  concurrencyLimit?: number;
  /** Where the user left the dispatcher; absent on a tracker that never set one, which reads as `stopped`. */
  dispatcherState?:  DispatcherState;
  /** The Workflow run a `running` dispatcher is, stored so a killed run can be resumed after a compaction; absent in every other state. */
  dispatcherRunId?:  string;
  tasks:             Task[];
  log:               LogEntry[];
}

export type TicketType     = 'bug' | 'change' | 'feature';
export type TicketStatus   = 'open' | 'in-progress' | 'in-review' | 'done' | 'delivered' | 'abandoned';
export type TicketPriority = 'low' | 'normal' | 'high';

/** The model aliases a Claude Code agent definition's `model` key accepts, as an agent working a ticket runs on. */
export type AgentModel  = 'haiku' | 'sonnet' | 'opus' | 'fable';
export type AgentEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface TicketFrontmatter {
  id:          string;
  title:       string;
  type:        TicketType;
  /** Absent on every ticket filed before priorities existed, and on one filed without `--priority`; absent reads as `normal`. */
  priority?:   TicketPriority;
  /** Absent unless somebody named one; absent reads as the tool's default for builders and reviewers. */
  model?:      AgentModel;
  effort?:     AgentEffort;
  /** Present while `ticket hold` holds the ticket, holding its reason, empty when none was given; absent means not held. */
  hold?:       string;
  status:      TicketStatus;
  filed:       string;
  updated:     string;
  started:     string | null;
  finished:    string | null;
  delivered:   string | null;
  abandonedAt: string | null;
  group?:      string;
  branch?:     string;
  commit?:     string;
  reason?:     string;
  /** Padded ids of the tickets this one waits on, in the order written; absent when it waits on none. */
  dependsOn?:  string[];
  task:        number | null;
  /** Every frontmatter line the CLI does not own, in original order, so a status change does not eat it. */
  extra:       Array<[key: string, rawValue: string]>;
}

export interface Ticket {
  frontmatter: TicketFrontmatter;
  body:        string;
  filePath:    string;
}
