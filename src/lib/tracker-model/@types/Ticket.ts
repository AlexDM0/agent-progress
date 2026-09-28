import type { TaskStatus } from './Task.ts';

export type TicketType     = 'bug' | 'change' | 'feature';
/** The task ladder without the two states only a row reaches. */
export type TicketStatus   = Exclude<TaskStatus, 'paused' | 're-review'>;
export type TicketPriority = 'low' | 'normal' | 'high';
export type LineEnding     = '\n' | '\r\n';

/** The model aliases a Claude Code agent definition's `model` key accepts, as an agent working a ticket runs on. */
export type AgentModel  = 'haiku' | 'sonnet' | 'opus' | 'fable';
export type AgentEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** A ticket's agents with the defaults resolved, as they actually run. */
export interface AgentPair {
  model:  AgentModel;
  effort: AgentEffort;
}

export interface TicketFrontmatter {
  id:             string;
  title:          string;
  type:           TicketType;
  /** Absent on every ticket filed before priorities existed, and on one filed without a priority; absent reads as `normal`. */
  priority?:      TicketPriority;
  /** Absent unless somebody named one; absent reads as the default for builders and reviewers. */
  model?:         AgentModel;
  effort?:        AgentEffort;
  /** Present while a hold holds the ticket, holding its reason, empty when none was given; absent means not held. */
  hold?:          string;
  status:         TicketStatus;
  filed:          string;
  updated:        string;
  started:        string | null;
  finished:       string | null;
  delivered:      string | null;
  abandonedAt:    string | null;
  group?:         string;
  /** Present, and true, only on the one ticket of its group whose delivery releases the group; absent on every other. */
  releasesGroup?: true;
  branch?:        string;
  commit?:        string;
  reason?:        string;
  /** Padded ids of the tickets this one waits on, in the order written; absent when it waits on none. */
  dependsOn?:     string[];
  task:           number | null;
  /** Every frontmatter line the model does not own, in original order, so a status change does not eat it. */
  extra:          Array<[key: string, rawValue: string]>;
}

export interface Ticket {
  frontmatter: TicketFrontmatter;
  body:        string;
  filePath:    string;
  /** The frontmatter's line ending as read, which a rewrite keeps; absent for a ticket not read from a file, which is written with `\n`. */
  lineEnding?: LineEnding;
}

/** A ready ticket with its priority and agents resolved to their defaults where the ticket names none. */
export interface ReadyTicket {
  id:       string;
  priority: TicketPriority;
  model:    AgentModel;
  effort:   AgentEffort;
  /** Absent on an ungrouped ticket, as in its frontmatter. */
  group?:   string;
  /** Present, and true, only on a held ticket. */
  held?:    true;
}
