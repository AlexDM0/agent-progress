import type { IncidentKind, IncidentMove } from '../../../lib/tracker-model/@types/Incident.ts';

/**
 * The moves the runner's orchestrator may relay under each delivered incident kind, naming the incident. Only `findings-delivered` is
 * filled here, its two finding moves; the incident moves of every other kind arrive with their commands.
 */
export const ALLOWED_MOVES_BY_INCIDENT_KIND: Readonly<Record<IncidentKind, readonly IncidentMove[]>> = {
  'system-question':           [],
  'malformed-ticket':          [],
  'setup-failed':              [],
  'out-of-calls':              [],
  'blocked':                   [],
  'job-lost':                  [],
  'resume-failed':             [],
  'gate-cannot-run':           [],
  'merge-gate-failed':         [],
  'resolution-over-threshold': [],
  'quiet-job':                 [],
  'findings-delivered':        ['ticket-ready', 'ticket-triage'],
};

/** The moves legal only on a ticket the named `findings-delivered` incident lists. */
export const FINDING_MOVES: readonly IncidentMove[] = ['ticket-ready', 'ticket-triage'];
