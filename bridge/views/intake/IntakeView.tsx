/**
 * The Intake view: New request starts a product-owner session (`intake-start`); each session shows its transcript, its questions inline,
 * the drafts it filed, a chat box for follow-ups (`job-message`) and Close intake (`intake-close`), which opens the `ready-drafts`
 * decision. A closed session keeps its transcript and chat, marked closed: a message resumes it.
 */
import { useState } from 'react';

import type { ConversationBoardDocument }                        from '../../@types/ConversationDocuments.ts';
import { ChatBox }                                               from '../../conversation/ChatBox.tsx';
import { DecisionCard }                                          from '../../conversation/DecisionCard.tsx';
import { TranscriptLog, useTranscript, type TranscriptFollower } from '../../conversation/TranscriptLog.tsx';
import { CommandButton }                                         from '../../shell/CommandButton.tsx';
import { IntakeModelUtil, type IntakeSession }                   from './IntakeModel.ts';

export interface IntakeViewProps {
  readonly board:            ConversationBoardDocument;
  readonly followTranscript: TranscriptFollower;
}

function NewRequestForm() {
  const [text, setText] = useState('');
  return (
    <div className="bridge-form">
      <textarea className="bridge-textarea" aria-label="New request" value={text} onChange={(event) => setText(event.target.value)} />
      <CommandButton label="New request" command={text.trim() === '' ? null : { kind: 'intake-start', text: text.trim() }} onApplied={() => setText('')} />
    </div>
  );
}

function IntakeSessionItem({ session, followTranscript }: { readonly session: IntakeSession; readonly followTranscript: TranscriptFollower }) {
  const entries = useTranscript(session.jobId, followTranscript);
  return (
    <li className="bridge-card" data-state={session.closed ? 'closed' : 'open'} aria-label={`Intake ${session.jobId}`}>
      <h3 className="bridge-card-title">{session.jobId}</h3>
      <p className="bridge-card-meta">{session.closed ? 'closed: a message resumes it' : session.state}</p>
      {session.requestText === null ? null : <p className="bridge-note">{session.requestText}</p>}
      <ul className="bridge-list" aria-label={`Questions of ${session.jobId}`}>
        {session.questions.map((decision) => <DecisionCard key={decision.id} decision={decision} escalated={false} />)}
      </ul>
      <ul className="bridge-list" aria-label={`Drafts of ${session.jobId}`}>
        {session.drafts.map((ticket) => <li key={ticket.id} className="bridge-note">{`${ticket.id} ${ticket.title} · ${ticket.status}`}</li>)}
      </ul>
      <TranscriptLog label={`Transcript of ${session.jobId}`} entries={entries} />
      <ChatBox label={`Message ${session.jobId}`} jobId={session.jobId} />
      {session.closed
        ? null
        : (
          <div className="bridge-card-actions">
            <CommandButton label="Close intake" command={{ kind: 'intake-close', jobId: session.jobId, proposedDraftSets: [] }} />
          </div>
        )}
    </li>
  );
}

export function IntakeView({ board, followTranscript }: IntakeViewProps) {
  const sessions = IntakeModelUtil.intakeSessionsOf(board);
  return (
    <div className="bridge-view">
      <section className="bridge-section" aria-label="New request">
        <h2 className="bridge-section-title">New request</h2>
        <NewRequestForm />
      </section>
      <section className="bridge-section" aria-label="Product-owner sessions">
        <h2 className="bridge-section-title">{`Sessions (${sessions.length})`}</h2>
        {sessions.length === 0 ? <p className="bridge-empty">No intake session yet.</p> : null}
        <ul className="bridge-list">
          {sessions.map((session) => <IntakeSessionItem key={session.jobId} session={session} followTranscript={followTranscript} />)}
        </ul>
      </section>
    </div>
  );
}
