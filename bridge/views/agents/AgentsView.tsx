/**
 * The Agents view: every job on the board with its live facts and subagents, ticking each second, and for the job the route names, its
 * controls and its transcript. Its clock and transcript stream arrive as props, so a DOM spec drives both.
 */
import { useEffect, useState } from 'react';

import type { IdentifiedRecord }                                         from '../../@types/BoardStateDocument.ts';
import { TranscriptStreamClient }                                        from '../../api/TranscriptStreamClient.ts';
import type { AgentJobDocument, JobDecisionDocument }                    from './AgentJobDocument.ts';
import { JobControls }                                                   from './JobControls.tsx';
import { JobRows }                                                       from './JobRows.tsx';
import { TranscriptPanel, type FollowTranscript, type TranscriptMemory } from './TranscriptPanel.tsx';

export interface AgentsClock {
  readonly now:         () => Date;
  /** Calls `tick` every second until the returned function is called. */
  readonly everySecond: (tick: () => void) => () => void;
}

export interface AgentsViewProps {
  readonly jobs:              readonly IdentifiedRecord[];
  readonly decisions:         readonly IdentifiedRecord[];
  readonly selectedJobId:     string | null;
  readonly clock:             AgentsClock;
  readonly followTranscript?: FollowTranscript;
}

const MILLISECONDS_PER_SECOND = 1000;

export const BROWSER_AGENTS_CLOCK: AgentsClock = {
  now:         () => new Date(),
  everySecond: (tick) => {
    const timer = setInterval(tick, MILLISECONDS_PER_SECOND);
    return () => clearInterval(timer);
  },
};

/** A record without live facts is not shown rather than breaking the table: the next `board` carries the whole job again. */
function isAgentJob(record: IdentifiedRecord): record is AgentJobDocument {
  const { live, ticketIds, state } = record as Partial<AgentJobDocument>;
  return typeof live === 'object' && live !== null && Array.isArray(live.subagents) && Array.isArray(ticketIds) && typeof state === 'string';
}

function openDecisionOf(decisions: readonly IdentifiedRecord[], jobId: string): JobDecisionDocument | null {
  return decisions.find((decision): decision is JobDecisionDocument => (decision as Partial<JobDecisionDocument>).jobId === jobId) ?? null;
}

function useNowEverySecond(clock: AgentsClock): Date {
  const [now, setNow] = useState(() => clock.now());
  useEffect(() => clock.everySecond(() => setNow(clock.now())), [clock]);
  return now;
}

export function AgentsView({
  jobs, decisions, selectedJobId, clock, followTranscript = TranscriptStreamClient.follow
}: AgentsViewProps) {
  const now = useNowEverySecond(clock);
  const [transcriptMemory] = useState<TranscriptMemory>(() => new Map());
  const agentJobs = jobs.filter(isAgentJob);
  const selectedJob = agentJobs.find((job) => job.id === selectedJobId) ?? null;

  if (agentJobs.length === 0) return <p className="bridge-empty">No agents are running.</p>;
  return (
    <section className="agents-view">
      <table className="agents-table">
        <thead>
          <tr>
            <th>Job</th>
            <th>Kind</th>
            <th>Tickets</th>
            <th>State</th>
            <th>Phase</th>
            <th>Calls</th>
            <th>Tool calls</th>
            <th>Tokens</th>
            <th>Last tool</th>
            <th>Silent sweeps</th>
            <th>Watcher</th>
          </tr>
        </thead>
        <tbody>
          {agentJobs.map((job) => <JobRows key={job.id} job={job} selected={job.id === selectedJobId} now={now} />)}
        </tbody>
      </table>
      {selectedJob === null
        ? null
        : (
          <section className="agents-job-panel" aria-label={`Job ${selectedJob.id}`}>
            <h2 className="agents-job-heading">{`Job ${selectedJob.id}`}</h2>
            <JobControls key={selectedJob.id} job={selectedJob} openDecision={openDecisionOf(decisions, selectedJob.id)} />
            <TranscriptPanel key={selectedJob.id} jobId={selectedJob.id} memory={transcriptMemory} followTranscript={followTranscript} />
          </section>
        )}
    </section>
  );
}
