/**
 * The Questions view: every open decision, the answered ones below, the open notices, which have no answer, and the Low-priority triage
 * list, whose entries User readies, edits or abandons. Notifications are allowed from a click here, never asked for on load.
 */
import { useState } from 'react';

import type { ConversationBoardDocument }                              from '../../@types/ConversationDocuments.ts';
import { CommandButton }                                               from '../../shell/CommandButton.tsx';
import { DecisionCard }                                                from './DecisionCard.tsx';
import type { NotificationAllowance, QuestionNotifier }                from './QuestionAlerts.ts';
import { QuestionsModelUtil, type AnsweredDecision, type TriageEntry } from './QuestionsModel.ts';

export interface QuestionsViewProps {
  readonly board:    ConversationBoardDocument;
  readonly notifier: QuestionNotifier;
}

function NotificationAllowanceControl({ notifier }: { readonly notifier: QuestionNotifier }) {
  const [allowance, setAllowance] = useState<NotificationAllowance>(() => notifier.allowance());
  if (allowance !== 'default') return null;
  return (
    <button type="button" className="bridge-button" onClick={() => void notifier.askAllowance().then(setAllowance)}>
      Notify me of new questions
    </button>
  );
}

function AnsweredDecisionItem({ answered }: { readonly answered: AnsweredDecision }) {
  return (
    <li className="bridge-card" data-state="answered" aria-label={`Answered ${answered.decisionId}`}>
      <h3 className="bridge-card-title">{answered.decisionId}</h3>
      <p className="bridge-card-meta">{`Answered ${answered.answeredAt}`}</p>
      {answered.answer.map(([question, answer]) => <p key={question} className="bridge-note">{`${question} ${answer}`}</p>)}
    </li>
  );
}

function TriageEntryItem({ entry }: { readonly entry: TriageEntry }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(entry.title);
  const [bodyText, setBodyText] = useState('');
  const facts = [
    entry.isLeftover ? 'v16 leftover, held first-run review' : 'draft',
    entry.filedByJob === null ? 'no job' : `found by job ${entry.filedByJob}`,
    entry.foundOnTicketIds.length === 0 ? 'on no ticket' : `on ticket ${entry.foundOnTicketIds.join(', ')}`,
    entry.askedForUser ? 'the agent asked for User\'s input' : 'triaged to User',
  ];
  const editCommand = {
    kind:              'ticket-edit',
    ticketReference:   entry.ticketId,
    ...title.trim() === '' || title === entry.title ? {} : { title: title.trim() },
    bodyText:          bodyText.trim() === '' ? null : bodyText,
    appendsBody:       false,
    allowsPastPending: false,
  };
  return (
    <li className="bridge-card" data-state="open" aria-label={`Triage ${entry.ticketId}`}>
      <h3 className="bridge-card-title">{`${entry.ticketId} ${entry.title}`}</h3>
      <p className="bridge-card-meta">{facts.join(' · ')}</p>
      <div className="bridge-card-actions">
        <CommandButton label="Ready" command={{ kind: 'ticket-ready', ticketReferences: [entry.ticketId] }} />
        <button type="button" className="bridge-button" aria-expanded={editing} onClick={() => setEditing(!editing)}>Edit</button>
        <CommandButton label="Abandon" command={{ kind: 'ticket-abandon', ticketReference: entry.ticketId }} />
      </div>
      {editing
        ? (
          <div className="bridge-form">
            <input className="bridge-input" aria-label={`Title of ${entry.ticketId}`} value={title} onChange={(event) => setTitle(event.target.value)} />
            <textarea
              className="bridge-textarea"
              aria-label={`New body of ${entry.ticketId}`}
              placeholder="Leave empty to keep the body"
              value={bodyText}
              onChange={(event) => setBodyText(event.target.value)}
            />
            <CommandButton
              label="Save"
              command={'title' in editCommand || editCommand.bodyText !== null ? editCommand : null}
              onApplied={() => setEditing(false)}
            />
          </div>
        )
        : null}
    </li>
  );
}

export function QuestionsView({ board, notifier }: QuestionsViewProps) {
  const model = QuestionsModelUtil.questionsModelOf(board);
  return (
    <div className="bridge-view">
      <section className="bridge-section" aria-label="Open questions">
        <h2 className="bridge-section-title">{`Open questions (${model.openQuestionCount})`}</h2>
        <NotificationAllowanceControl notifier={notifier} />
        {model.openDecisions.length === 0 ? <p className="bridge-empty">No question waits on User.</p> : null}
        <ul className="bridge-list">
          {model.openDecisions.map(({ decision, escalated }) => <DecisionCard key={decision.id} decision={decision} escalated={escalated} />)}
        </ul>
      </section>
      <section className="bridge-section" aria-label="Answered questions">
        <h2 className="bridge-section-title">Answered</h2>
        <ul className="bridge-list">
          {model.answeredDecisions.map((answered) => <AnsweredDecisionItem key={`${answered.decisionId}-${answered.answeredAt}`} answered={answered} />)}
        </ul>
      </section>
      <section className="bridge-section" aria-label="Notices">
        <h2 className="bridge-section-title">Notices</h2>
        <ul className="bridge-list">
          {model.notices.map((notice, position) => <li key={`${notice.kind}-${position}`} className="bridge-card" data-state="notice">{notice.kind}</li>)}
        </ul>
      </section>
      <section className="bridge-section" aria-label="Low-priority triage">
        <h2 className="bridge-section-title">Low-priority triage</h2>
        <ul className="bridge-list">
          {model.triageEntries.map((entry) => <TriageEntryItem key={entry.ticketId} entry={entry} />)}
        </ul>
      </section>
    </div>
  );
}
