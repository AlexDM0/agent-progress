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
  'pipeline-proposal',
] as const satisfies readonly DecisionKind[];

/** Who opens a decision beside an agent of a job role. */
export const NON_AGENT_DECISION_ASKERS = ['overseer', 'assistant'] as const;

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
  'incident-note',
  'ticket-abandon',
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

export const INCIDENT_DEFAULT_CAUSES = ['turn-closed', 'turn-budget', 'no-assistant'] as const satisfies readonly IncidentDefaultCause[];

export const DECISION_ID_PREFIX = 'E';

/** A ticket the lifecycle parks is held with this prefix before its park cause, as `parked:failed-passes`. */
export const PARKED_HOLD_PREFIX = 'parked:';

export const INCIDENT_ID_PREFIX = 'I';

/** The number the first decision and the first incident a tracker opens take: the lowest counter a progress file may store. */
export const FIRST_DECISION_NUMBER = 1;

export const FIRST_INCIDENT_NUMBER = 1;

/** The fact naming the AskUserQuestion request an incident was opened for, so a replayed request opens nothing twice. */
export const REQUEST_ID_FACT = 'requestId';

/** The fact carrying an agent's questions as JSON, so an escalation puts exactly the agent's words to the user. */
export const QUESTIONS_FACT = 'questions';

/** A ticket whose job ended with its question open is held `awaiting answer (E7)` until User answers it. */
export const AWAITING_ANSWER_HOLD_PREFIX = 'awaiting answer';

/** A v16 low `pending` ticket the Overseer's first start holds for its orchestrator's triage. */
export const FIRST_RUN_REVIEW_HOLD = 'first-run review';

/** The section of a ticket's body the answers to its ended job's questions go under, for the next agent. */
export const QUESTIONS_SECTION_HEADING = '## Questions';
