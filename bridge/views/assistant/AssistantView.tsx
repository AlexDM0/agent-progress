/**
 * The Assistant view: the live session's transcript, its open incidents, the handled ones with the moves and escalations made under them
 * and each applied default in the warning state, and a chat box. While no session is up it says a fresh one is booting; there is no off
 * switch.
 */
import { useState } from 'react';

import type { ConversationBoardDocument }                        from '../../@types/ConversationDocuments.ts';
import { ChatBox }                                               from '../../conversation/ChatBox.tsx';
import { TranscriptLog, useTranscript, type TranscriptFollower } from '../../conversation/TranscriptLog.tsx';
import { AssistantModelUtil, type IncidentEntry }                from './AssistantModel.ts';

export interface AssistantViewProps {
  readonly board:            ConversationBoardDocument;
  readonly followTranscript: TranscriptFollower;
}

function IncidentItem({ incident }: { readonly incident: IncidentEntry }) {
  const facts = [
    incident.kind,
    incident.ticketIds.length === 0 ? null : `ticket ${incident.ticketIds.join(', ')}`,
    incident.settlement === 'open' ? (incident.delivered ? 'delivered' : 'waiting for the Assistant') : incident.settlement,
    incident.defaultMove === null ? null : `default ${incident.defaultMove}`,
  ].filter((fact) => fact !== null);
  return (
    <li className="bridge-card" data-state={incident.settlement === 'defaulted' ? 'warning' : incident.settlement} aria-label={`Incident ${incident.incidentId}`}>
      <h3 className="bridge-card-title">{incident.incidentId}</h3>
      <p className="bridge-card-meta">{facts.join(' · ')}</p>
      {incident.facts.map(([name, value]) => <p key={name} className="bridge-note">{`${name}: ${value}`}</p>)}
      {incident.steps.map((step) => <p key={`${step.at}-${step.text}`} className="bridge-note">{step.text}</p>)}
    </li>
  );
}

export function AssistantView({ board, followTranscript }: AssistantViewProps) {
  const model = AssistantModelUtil.assistantModelOf(board);
  const entries = useTranscript(model.assistantJobId, followTranscript);
  const [sentTexts, setSentTexts] = useState<readonly string[]>([]);
  const queued = AssistantModelUtil.queuedMessagesOf(sentTexts, entries);
  return (
    <div className="bridge-view">
      <section className="bridge-section" aria-label="Assistant session">
        <h2 className="bridge-section-title">{model.assistantJobId === null ? 'Assistant' : `Assistant ${model.assistantJobId}`}</h2>
        {model.assistantJobId === null
          ? <p className="bridge-note" role="status">Booting a fresh session.</p>
          : <TranscriptLog label="Assistant transcript" entries={entries} />}
        {queued.map((text) => <p key={text} className="bridge-note">{`Queued until the Assistant is idle: ${text}`}</p>)}
        <ChatBox label="Message the Assistant" jobId={model.assistantJobId} onSent={(text) => setSentTexts((previous) => [...previous, text])} />
      </section>
      <section className="bridge-section" aria-label="Open incidents">
        <h2 className="bridge-section-title">{`Open incidents (${model.openIncidents.length})`}</h2>
        <ul className="bridge-list">
          {model.openIncidents.map((incident) => <IncidentItem key={incident.incidentId} incident={incident} />)}
        </ul>
      </section>
      <section className="bridge-section" aria-label="Handled incidents">
        <h2 className="bridge-section-title">Handled incidents</h2>
        <ul className="bridge-list">
          {model.settledIncidents.map((incident) => <IncidentItem key={incident.incidentId} incident={incident} />)}
        </ul>
      </section>
    </div>
  );
}
