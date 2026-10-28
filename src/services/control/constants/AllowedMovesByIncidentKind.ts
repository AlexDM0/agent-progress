import type { IncidentKind, IncidentMove } from '../../../lib/tracker-model/@types/Incident.ts';

/**
 * The Bouncer's one table of the moves each incident kind allows, design section 8.3, whoever names the incident: the runner's
 * orchestrator through its relay or User at the command line. `incident-note` records and never closes; no row lists `merge-land` for a
 * failed merge gate, which would be a waiver.
 */
export const ALLOWED_MOVES_BY_INCIDENT_KIND: Readonly<Record<IncidentKind, readonly IncidentMove[]>> = {
  'system-question':           ['incident-answer', 'incident-escalate', 'job-fresh', 'ticket-park', 'incident-note'],
  'malformed-ticket':          ['incident-answer', 'incident-escalate', 'ticket-park', 'incident-note'],
  'setup-failed':              ['worktree-repair', 'ticket-park', 'incident-note'],
  'out-of-calls':              ['job-fresh', 'ticket-park', 'incident-note'],
  'blocked':                   ['job-fresh', 'worktree-repair', 'ticket-park', 'incident-note'],
  'job-lost':                  ['job-fresh', 'ticket-park', 'incident-note'],
  'resume-failed':             ['job-fresh', 'ticket-park'],
  'gate-cannot-run':           ['gate-retry', 'worktree-repair', 'ticket-park'],
  'merge-gate-failed':         ['merge-fixer', 'merge-abort', 'ticket-park'],
  'resolution-over-threshold': ['merge-review', 'merge-land', 'merge-abort'],
  'quiet-job':                 ['job-message', 'job-fresh', 'incident-note'],
  'findings-delivered':        ['ticket-ready', 'ticket-triage', 'incident-note'],
};

/** The moves legal only on a ticket the named `findings-delivered` incident lists. */
export const FINDING_MOVES: readonly IncidentMove[] = ['ticket-ready', 'ticket-triage'];
