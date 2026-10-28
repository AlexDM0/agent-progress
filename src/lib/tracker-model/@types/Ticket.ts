import type { TaskStatus } from './Task.ts';

export type TicketType     = 'ticket' | 'bug' | 'research';
export type RetiredTicketType = 'change' | 'feature';
/** The task ladder without the two states only a row reaches, behind `draft`: a filed ticket not yet ready, which has no row. */
export type TicketStatus   = 'draft' | Exclude<TaskStatus, 'paused' | 're-review'>;
/** Every ticket status a row can share, which is all of them but `draft`. */
export type RowedTicketStatus = Exclude<TicketStatus, 'draft'>;
export type TicketPriority = 'low' | 'normal' | 'high';
/** The expected change in code lines, comments and docs not counted: XS ≤ 20, S ≤ 100, M ≤ 300, L ≤ 750, XL ≤ 1500, XXL beyond. */
export type TicketSize     = 'XS' | 'S' | 'M' | 'L' | 'XL' | 'XXL';
export type LineEnding    = '\n' | '\r\n';

/** The model aliases a Claude Code agent definition's `model` key accepts, as an agent working a ticket runs on. */
export type AgentModel  = 'haiku' | 'sonnet' | 'opus' | 'fable';
export type AgentEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** A ticket's agents with the defaults resolved, as they actually run. */
export interface AgentPair {
  model:  AgentModel;
  effort: AgentEffort;
}

export interface TicketFrontmatter {
  id:               string;
  title:            string;
  type:             TicketType;
  /** Absent on every ticket filed before priorities existed, and on one filed without a priority; absent reads as `normal`. */
  priority?:        TicketPriority;
  /** Absent unless the filer sized it; it only feeds the page's statistics. */
  size?:            TicketSize;
  /** Absent unless somebody named one; absent reads as the default for builders and reviewers. */
  model?:           AgentModel;
  effort?:          AgentEffort;
  /** Present while a hold holds the ticket, holding its reason, empty when none was given; absent means not held. */
  hold?:            string;
  status:           TicketStatus;
  filed:            string;
  updated:          string;
  started:          string | null;
  finished:         string | null;
  delivered:        string | null;
  abandonedAt:      string | null;
  group?:           string;
  /** Present, and true, only on the one ticket of its group whose delivery releases the group; absent on every other. */
  releasesGroup?:   true;
  branch?:          string;
  commit?:          string;
  reason?:          string;
  /** Padded ids of the tickets this one waits on, in the order written; absent when it waits on none. */
  dependsOn?:       string[];
  /** The keys of the epics the ticket belongs to, its primary epic first; absent when it belongs to none. */
  epics?:           string[];
  /** The public domains the ticket's agents may reach, lower case, in the order written; absent when its work needs no network. */
  network?:         string[];
  /** On a bug only: the padded id of the delivered ticket whose change introduced it; absent when none was named. */
  introducedBy?:    string;
  /** The padded id of the ticket whose review found this one; absent on a ticket no review filed. */
  foundInReview?:   string;
  /** The content hash of the body as it read when the ticket was last claimed or started; absent on a ticket never claimed or started. */
  claimedBodyHash?: string;
  task:             number | null;
  /** Every frontmatter line the model does not own, in original order, so a status change does not eat it. */
  extra:            Array<[key: string, rawValue: string]>;
}

export interface Ticket {
  frontmatter: TicketFrontmatter;
  body:        string;
  filePath:    string;
  /** The frontmatter's line ending as read, which a rewrite keeps; absent for a ticket not read from a file, which is written with `\n`. */
  lineEnding?: LineEnding;
  /** A retired type the file holds, which reads as `ticket` and every rewrite keeps; absent on a ticket stored with a current type. */
  storedType?: RetiredTicketType;
}

/** What keeps a draft from being readied: no numbered Acceptance item, or no `## Brief` with a non-blank line. */
export type ReadinessGap = 'acceptance-unnumbered' | 'brief-missing';

export interface IncompleteTicket {
  ticketId: string;
  gaps:     readonly ReadinessGap[];
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
