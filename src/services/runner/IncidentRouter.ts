/**
 * The runner's side of incident routing that the lifecycle policy cannot read off the board: a job whose event log stopped growing,
 * counted in sweeps and never in time (design section 7.5), and the incidents that took their default, which `jobs` and the runner's
 * state show as a warning (owner answer Q34).
 */
import type { IncidentDefaultCause, IncidentMove } from '../../lib/tracker-model/@types/Incident.ts';
import type { Job, JobKind }                       from '../../lib/tracker-model/@types/Job.ts';
import type { LogRecord }                          from '../../lib/tracker-model/@types/LogRecord.ts';
import type { Board }                              from '../../lib/tracker-model/Board.ts';

export interface DefaultedIncident {
  incidentId: string;
  move:       IncidentMove;
  cause:      IncidentDefaultCause;
  at:         string;
}

/** The agents a sweep watches: a session that waits on an answer, or one an orchestrator turn bounds, is quiet on purpose. */
const WATCHED_JOB_KINDS: readonly JobKind[] = ['build', 'review'];

export interface QuietJobWatch {
  /** One sweep over the jobs as the last pass left them: the ids whose cursor has now stood still for `quietSweeps` sweeps. */
  sweep: (jobs: readonly Readonly<Job>[]) => string[];
}

/**
 * In memory, as the count is: a restart starts every job's count again, which only delays a `quiet-job`, never opens a false one. A clock
 * exception: sweeps come at an interval, so the count is time-shaped; it only opens an incident, whose default only asks User.
 */
function createQuietJobWatch(quietSweeps: number): QuietJobWatch {
  const standingByJobId = new Map<string, { cursor: string; sweeps: number }>();
  return {
    sweep: (jobs) => {
      const due: string[] = [];
      const watched = jobs.filter((job) => WATCHED_JOB_KINDS.includes(job.kind) && job.state === 'running');
      for (const jobId of [...standingByJobId.keys()]) {
        if (!watched.some((job) => job.id === jobId)) standingByJobId.delete(jobId);
      }
      for (const job of watched) {
        const cursor   = `${job.hostInstance}.${job.eventCursor.instance}.${job.eventCursor.sequence}`;
        const standing = standingByJobId.get(job.id);
        const sweeps   = standing?.cursor === cursor ? standing.sweeps + 1 : 0;
        standingByJobId.set(job.id, { cursor, sweeps: sweeps >= quietSweeps ? 0 : sweeps });
        if (sweeps >= quietSweeps) due.push(job.id);
      }
      return due;
    },
  };
}

/** Opens one `quiet-job` incident per still-running job the watch found quiet, none for a job one is open for already. */
function openQuietJobIncidents(board: Board, jobIds: readonly string[], quietSweeps: number, at: string): LogRecord[] {
  return jobIds.flatMap((jobId) => {
    const job = board.jobById(jobId);
    if (job?.state !== 'running') return [];
    if (board.incidents().some((incident) => incident.kind === 'quiet-job' && incident.jobId === jobId)) return [];
    return [...board.openIncident({
      kind: 'quiet-job', ticketIds: job.ticketIds, jobId, facts: { sweeps: String(quietSweeps) }, defaultMove: 'open-quiet-job-decision'
    }, at).logged];
  });
}

/** Every default taken since the runner last started, oldest first: the warning state `jobs` and the runner's state show. */
function defaultedIncidentsOf(logRecords: readonly LogRecord[]): DefaultedIncident[] {
  const lastStart = logRecords.findLastIndex((record) => record.kind === 'runner-started');
  return logRecords.slice(lastStart + 1).flatMap((record) => (record.kind === 'incident-defaulted'
    ? [{
      incidentId: record.incidentId, move: record.fields.move, cause: record.fields.cause, at: record.at
    }]
    : []));
}

export const IncidentRouter = Object.freeze({
  createQuietJobWatch,
  openQuietJobIncidents,
  defaultedIncidentsOf,
});
