import type { DecisionKind }                                     from '../@types/Decision.ts';
import type { IncidentDefaultCause, IncidentKind, IncidentMove } from '../@types/Incident.ts';

export const DECISION_KINDS = [
  'agent-question',
  'ready-drafts',
  'parked',
  'waiver',
  'landing-refused',
  'merge-refused',
  'checks-not-set',
  'target-moved',
  'branch-touches-agent-config',
  'outage',
  'quiet-job',
  'leftover-worktree',
] as const satisfies readonly DecisionKind[];

/** Who opens a decision beside an agent of a job role. */
export const NON_AGENT_DECISION_ASKERS = ['runner', 'orchestrator'] as const;

export const INCIDENT_KINDS = [
  'system-question',
  'malformed-ticket',
  'setup-failed',
  'out-of-calls',
  'blocked',
  'job-lost',
  'resume-failed',
  'gate-cannot-run',
  'merge-gate-failed',
  'resolution-over-threshold',
  'quiet-job',
  'findings-delivered',
] as const satisfies readonly IncidentKind[];

export const INCIDENT_MOVES = [
  'incident-answer',
  'incident-escalate',
  'job-fresh',
  'job-message',
  'worktree-repair',
  'gate-retry',
  'merge-fixer',
  'merge-abort',
  'merge-review',
  'merge-land',
  'ticket-park',
  'ticket-ready',
  'ticket-triage',
  'open-quiet-job-decision',
] as const satisfies readonly IncidentMove[];

export const INCIDENT_DEFAULT_CAUSES = ['turn-closed', 'turn-budget', 'no-orchestrator'] as const satisfies readonly IncidentDefaultCause[];

export const DECISION_ID_PREFIX = 'E';

export const INCIDENT_ID_PREFIX = 'I';

/** The number the first decision and the first incident a tracker opens take: the lowest counter a progress file may store. */
export const FIRST_DECISION_NUMBER = 1;

export const FIRST_INCIDENT_NUMBER = 1;

/** The fact naming the AskUserQuestion request an incident was opened for, so a replayed request opens nothing twice. */
export const REQUEST_ID_FACT = 'requestId';
