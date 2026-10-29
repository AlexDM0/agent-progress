/**
 * The last tool call of a job or subagent: its name, "running" while it has no result, and the time since it started. The time takes the
 * warning tint only while the job's silent sweeps are above zero, never from the elapsed time itself, since a long call is not a quiet one.
 */
import type { LastToolCallDocument } from './AgentJobDocument.ts';
import { ElapsedTimeUtil }           from './ElapsedTimeUtil.ts';

export interface LastToolCallCellProps {
  readonly lastToolCall: LastToolCallDocument | null;
  readonly silentSweeps: number;
  readonly now:          Date;
}

export function LastToolCallCell({ lastToolCall, silentSweeps, now }: LastToolCallCellProps) {
  if (lastToolCall === null) return <span className="agents-muted">no tool call yet</span>;
  const elapsed = ElapsedTimeUtil.elapsedSinceText(lastToolCall.startedAt, now);
  return (
    <span className="agents-last-tool">
      <span>{lastToolCall.toolName}</span>
      {lastToolCall.running ? <span className="agents-running">running</span> : null}
      {elapsed === null ? null : <span className={silentSweeps > 0 ? 'agents-elapsed agents-elapsed-silent' : 'agents-elapsed'}>{elapsed}</span>}
    </span>
  );
}
