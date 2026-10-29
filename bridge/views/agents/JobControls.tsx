/**
 * A job's controls, each a `ControlCommand`: Message, Answer (only while one of the job's decisions is open), Wind down, Stop and Fresh
 * agent. Each is offered only in the states the job's facts allow and refused by the Overseer anyway, its refusal shown verbatim; a
 * watch-only Watcher takes nothing but Stop.
 */
import { useState } from 'react';

import { CommandButton }                              from '../../shell/CommandButton.tsx';
import type { AgentJobDocument, JobDecisionDocument } from './AgentJobDocument.ts';

export interface JobControlsProps {
  readonly job:          AgentJobDocument;
  readonly openDecision: JobDecisionDocument | null;
}

/** Fresh agent replaces a builder or reviewer on its worktree; the other kinds have no worktree of their own to hand on. */
const FRESH_AGENT_KINDS: readonly string[] = ['build', 'review'];

export function JobControls({ job, openDecision }: JobControlsProps) {
  const [message, setMessage] = useState('');
  const [answer, setAnswer] = useState('');
  const stopping = job.state === 'stopping' || job.stopRequest !== undefined;
  if (stopping) return <p className="agents-muted">Stopping.</p>;
  const stopControl = <CommandButton label="Stop" command={{ kind: 'job-stop', jobId: job.id, mode: 'stop' }} answeredWhileInstallHeld />;
  if (job.live.watchOnly) return <div className="agents-controls">{stopControl}</div>;
  return (
    <div className="agents-controls">
      {job.role === null
        ? null
        : (
          <div className="agents-field">
            <textarea className="agents-input" aria-label="Message" value={message} onChange={(event) => setMessage(event.target.value)} />
            <CommandButton label="Send message" command={{ kind: 'job-message', jobId: job.id, text: message }} />
          </div>
        )}
      {openDecision === null
        ? null
        : (
          <div className="agents-field">
            <textarea className="agents-input" aria-label="Answer" value={answer} onChange={(event) => setAnswer(event.target.value)} />
            <CommandButton label="Send answer" command={{ kind: 'decision-answer', decisionId: openDecision.id, answer: { form: 'text', text: answer } }} />
          </div>
        )}
      <CommandButton label="Wind down" command={{ kind: 'job-stop', jobId: job.id, mode: 'wind-down' }} answeredWhileInstallHeld />
      {stopControl}
      {FRESH_AGENT_KINDS.includes(job.kind) ? <CommandButton label="Fresh agent" command={{ kind: 'job-fresh', jobId: job.id }} /> : null}
    </div>
  );
}
