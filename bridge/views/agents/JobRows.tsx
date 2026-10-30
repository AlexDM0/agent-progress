/** One job's row in the Agents table, then a row per subagent grouped under it by `parentToolUseId`, each with its own calls and tokens. */
import { HashRouter }            from '../../shell/HashRouter.ts';
import type { AgentJobDocument } from './AgentJobDocument.ts';
import { LastToolCallCell }      from './LastToolCallCell.tsx';

export interface JobRowsProps {
  readonly job:      AgentJobDocument;
  readonly selected: boolean;
  readonly now:      Date;
}

function callsAgainstBudgetOf(job: AgentJobDocument): string {
  return job.live.callBudget === null ? String(job.live.calls) : `${job.live.calls} / ${job.live.callBudget}`;
}

function watcherTextOf(job: AgentJobDocument): string {
  if (job.live.watcherProtocol === null) return '-';
  return job.live.watchOnly ? `running on Watcher protocol ${job.live.watcherProtocol}: watch only` : `protocol ${job.live.watcherProtocol}`;
}

export function JobRows({ job, selected, now }: JobRowsProps) {
  const { live } = job;
  return (
    <>
      <tr className="agents-job-row" aria-selected={selected} data-job-id={job.id}>
        <td><a className="agents-job-link" href={HashRouter.fragmentOf({ tab: 'agents', item: job.id })}>{job.id}</a></td>
        <td>{job.role === null ? job.kind : `${job.kind} / ${job.role}`}</td>
        <td>{job.ticketIds.map((ticketId) => `#${ticketId}`).join(' ')}</td>
        <td>{job.state}</td>
        <td>{job.airlock?.phase ?? '-'}</td>
        <td data-column="calls">{callsAgainstBudgetOf(job)}</td>
        <td data-column="tool-calls">{`${live.toolCalls} (${live.toolCallsWithSubagents} with subagents)`}</td>
        <td data-column="tokens">{live.tokens.toLocaleString('en-US')}</td>
        <td data-column="last-tool"><LastToolCallCell lastToolCall={live.lastToolCall} silentSweeps={live.silentSweeps} now={now} /></td>
        <td data-column="silent-sweeps">{live.silentSweeps}</td>
        <td data-column="watcher" className={live.watchOnly ? 'agents-watch-only' : 'agents-muted'}>{watcherTextOf(job)}</td>
      </tr>
      {live.subagents.map((subagent) => (
        <tr key={subagent.parentToolUseId} className="agents-subagent-row" data-parent-tool-use-id={subagent.parentToolUseId}>
          <td colSpan={5}>{`subagent of ${subagent.parentToolUseId}`}</td>
          <td />
          <td data-column="tool-calls">{subagent.toolCalls}</td>
          <td data-column="tokens">{subagent.tokens.toLocaleString('en-US')}</td>
          <td data-column="last-tool"><LastToolCallCell lastToolCall={subagent.lastToolCall} silentSweeps={live.silentSweeps} now={now} /></td>
          <td colSpan={2} />
        </tr>
      ))}
    </>
  );
}
