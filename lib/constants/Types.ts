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

export interface ProgressFile {
  version:           1;
  trackerId:         string;
  project:           string;
  startedAt:         string;
  view:              ViewRange;
  /** Never wound back, not by `task remove` and not by `clear`, so an id is never handed out twice. */
  nextTaskId:        number;
  /** How many rows may be running at once; absent on a tracker that never set one, which reads as the default. */
  concurrencyLimit?: number;
  tasks:             Task[];
  log:               LogEntry[];
}

export type TicketType     = 'bug' | 'change' | 'feature';
export type TicketStatus   = 'open' | 'in-progress' | 'in-review' | 'done' | 'delivered' | 'abandoned';
export type TicketPriority = 'low' | 'normal' | 'high';

export interface TicketFrontmatter {
  id:          string;
  title:       string;
  type:        TicketType;
  /** Absent on every ticket filed before priorities existed, and on one filed without `--priority`; absent reads as `normal`. */
  priority?:   TicketPriority;
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
