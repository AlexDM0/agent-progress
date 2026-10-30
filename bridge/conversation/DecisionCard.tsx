/**
 * One open decision with its questions and options exactly as asked, answered with `decision-answer`: one choice per question, several
 * when it is multi-select, or free text on a decision of one question. Shown in the Questions inbox and inline in an Intake panel; the
 * first answer wins, and a later one shows the Overseer's refusal beside the control.
 */
import { Fragment, useState } from 'react';

import type { DecisionDocument }                       from '../@types/ConversationDocuments.ts';
import { CommandButton }                               from '../shell/CommandButton.tsx';
import { DecisionAnswerUtil, type QuestionSelections } from './DecisionAnswerUtil.ts';

export interface DecisionCardProps {
  readonly decision:  DecisionDocument;
  readonly escalated: boolean;
}

function selectionsAfter(selections: QuestionSelections, questionIndex: number, optionIndex: number, multiSelect: boolean): QuestionSelections {
  const current = selections[questionIndex] ?? [];
  const chosen = multiSelect
    ? (current.includes(optionIndex) ? current.filter((index) => index !== optionIndex) : [...current, optionIndex])
    : [optionIndex];
  return Array.from({ length: Math.max(selections.length, questionIndex + 1) }, (_unused, index) => (index === questionIndex ? chosen : selections[index] ?? []));
}

export function DecisionCard({ decision, escalated }: DecisionCardProps) {
  const [selections, setSelections] = useState<QuestionSelections>([]);
  const [freeText, setFreeText] = useState('');
  const answer = DecisionAnswerUtil.answerOf(decision, selections, freeText);
  const facts = [
    decision.kind,
    decision.ticketIds.length === 0 ? null : `ticket ${decision.ticketIds.join(', ')}`,
    decision.jobId === null ? null : `job ${decision.jobId}`,
    `asked by ${decision.askedBy}`,
    escalated ? 'escalated by the Assistant' : null,
  ].filter((fact) => fact !== null);

  return (
    <li className="bridge-card" data-state="open" aria-label={`Question ${decision.id}`}>
      <h3 className="bridge-card-title">{decision.id}</h3>
      <p className="bridge-card-meta">{facts.join(' · ')}</p>
      {decision.context === '' ? null : <p className="bridge-note">{decision.context}</p>}
      {decision.questions.map((question, questionIndex) => (
        <fieldset key={question.question} className="bridge-question">
          <legend className="bridge-question-header">{question.header}</legend>
          <p>{question.question}</p>
          {question.options.map((option, optionIndex) => (
            <Fragment key={option.label}>
              <label className="bridge-option">
                <input
                  type={question.multiSelect ? 'checkbox' : 'radio'}
                  name={`${decision.id}-${questionIndex}`}
                  checked={(selections[questionIndex] ?? []).includes(optionIndex)}
                  onChange={() => setSelections(selectionsAfter(selections, questionIndex, optionIndex, question.multiSelect))}
                />
                {`${DecisionAnswerUtil.optionLetterOf(optionIndex)}. ${option.label}`}
              </label>
              {option.description === '' ? null : <span className="bridge-note">{option.description}</span>}
            </Fragment>
          ))}
        </fieldset>
      ))}
      {decision.questions.length === 1
        ? (
          <textarea
            className="bridge-textarea"
            aria-label={`Free-text answer to ${decision.id}`}
            value={freeText}
            onChange={(event) => setFreeText(event.target.value)}
          />
        )
        : null}
      <div className="bridge-card-actions">
        <CommandButton label="Answer" command={answer === null ? null : { kind: 'decision-answer', decisionId: decision.id, answer }} />
      </div>
    </li>
  );
}
