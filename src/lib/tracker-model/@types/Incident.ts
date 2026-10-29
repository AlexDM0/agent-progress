/**
 * Operational trouble code cannot settle alone, addressed to the runner's orchestrator and never to the user. Stored in progress.json while
 * it is open; a handled, defaulted or escalated incident leaves the board in that hold and lives on in the log.
 */

export type IncidentKind =
  | 'system-question'
  | 'malformed-ticket'
  | 'setup-failed'
  | 'out-of-calls'
  | 'blocked'
  | 'job-lost'
  | 'resume-failed'
  | 'gate-cannot-run'
  | 'merge-gate-failed'
  | 'resolution-over-threshold'
  | 'quiet-job'
  | 'findings-delivered';

/**
 * A move under an incident, named as its control command kind. `incident-note` records and never closes; `open-quiet-job-decision` is the
 * `quiet-job` default alone; `ticket-abandon` is User's abandon of the last finding a `findings-delivered` incident listed, never allowed.
 */
export type IncidentMove =
  | 'incident-answer'
  | 'incident-escalate'
  | 'incident-note'
  | 'ticket-abandon'
  | 'job-fresh'
  | 'job-message'
  | 'worktree-repair'
  | 'gate-retry'
  | 'merge-fixer'
  | 'merge-abort'
  | 'merge-review'
  | 'merge-land'
  | 'ticket-park'
  | 'ticket-ready'
  | 'ticket-triage'
  | 'open-quiet-job-decision';

/** Why an incident took its default: its delivery turn closed, the turn reached its call budget, or no orchestrator can come up. */
export type IncidentDefaultCause = 'turn-closed' | 'turn-budget' | 'no-orchestrator';

/** The orchestrator's chat turn an incident went out in: the n-th `result` after chat `chatSequence` closes it. */
export interface IncidentDeliveryTurn {
  jobId:        string;
  chatSequence: number;
}

export interface Incident {
  id:              string;
  kind:            IncidentKind;
  ticketIds:       string[];
  jobId:           string | null;
  facts:           Readonly<Record<string, string>>;
  defaultMove:     IncidentMove;
  deliveredInTurn: IncidentDeliveryTurn | null;
  openedAt:        string;
}

/** What a caller hands in to open one: the Board numbers it and stamps it, and it starts undelivered. */
export type IncidentOpening = Omit<Incident, 'id' | 'openedAt' | 'deliveredInTurn' | 'ticketIds'> & { ticketIds: readonly string[] };
