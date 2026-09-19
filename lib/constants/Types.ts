/** Types only, no imports: the browser page's project (`lib/render/page/tsconfig.json`) compiles this module alongside its own files. */

export type TaskStatus = 'pending' | 'running' | 'paused' | 'finished' | 'reviewed' | 'delivered' | 'abandoned';

export interface Task {
  id:     number;
  name:   string;
  status: TaskStatus;
  start:  string | null;
  end:    string | null;
  owner:  string;
  note:   string;
  /** The padded id (`"003"`) of the ticket this row belongs to, or `null` for a free-standing task. */
  ticket: string | null;
  /** Reported through `--tokens`, never measured here; `null` ("nobody said") and `0` are different answers. */
  tokens: number | null;
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
  version:    1;
  trackerId:  string;
  project:    string;
  startedAt:  string;
  view:       ViewRange;
  /** Never wound back, not by `task remove` and not by `clear`, so an id is never handed out twice. */
  nextTaskId: number;
  tasks:      Task[];
  log:        LogEntry[];
}

export type TicketType   = 'bug' | 'change' | 'feature';
export type TicketStatus = 'open' | 'in-progress' | 'in-review' | 'done' | 'delivered' | 'abandoned';

export interface TicketFrontmatter {
  id:          string;
  title:       string;
  type:        TicketType;
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
  task:        number | null;
  /** Every frontmatter line the CLI does not own, in original order, so a status change does not eat it. */
  extra:       Array<[key: string, rawValue: string]>;
}

export interface Ticket {
  frontmatter: TicketFrontmatter;
  body:        string;
  filePath:    string;
}
