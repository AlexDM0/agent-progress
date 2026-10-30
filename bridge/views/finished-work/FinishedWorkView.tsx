/** The finished-work choice and the delivered and abandoned tickets it lets through; the choice is stored under the static page's key. */
import { useCallback, useState } from 'react';

import type { PageTicketDocument } from '../../@types/BoardStateDocument.ts';
import type { PreferenceStore }    from '../../preferences/PreferenceStore.ts';
import {
  DEFAULT_FINISHED_WORK_CHOICE,
  FINISHED_WORK_CHOICE_NAME,
  FinishedWorkModel,
  OFFERED_FINISHED_WORK_SPANS,
  type FinishedWorkChoice
} from './FinishedWorkModel.ts';

/** The board's stored choice, written back on every change; with no store yet, the default, kept in memory. */
export function useFinishedWorkChoice(boardStore: PreferenceStore | null): [FinishedWorkChoice, (choice: FinishedWorkChoice) => void] {
  const [chosen, setChosen] = useState<FinishedWorkChoice | null>(null);
  const choice = chosen ?? FinishedWorkModel.choiceFrom(boardStore?.readChoice(FINISHED_WORK_CHOICE_NAME) ?? null);
  const choose = useCallback((next: FinishedWorkChoice) => {
    boardStore?.writeChoice(FINISHED_WORK_CHOICE_NAME, next, DEFAULT_FINISHED_WORK_CHOICE);
    setChosen(next);
  }, [boardStore]);
  return [choice, choose];
}

export interface FinishedWorkMenuProps {
  readonly choice:      FinishedWorkChoice;
  readonly onChoice:    (choice: FinishedWorkChoice) => void;
  readonly hiddenCount: number;
}

export function FinishedWorkMenu({ choice, onChoice, hiddenCount }: FinishedWorkMenuProps) {
  const chooseSince = (calendarDate: string): void => {
    const since = FinishedWorkModel.sinceChoiceFor(calendarDate);
    if (since !== null) onChoice(since);
  };
  return (
    <div className="bridge-finished-menu" role="group" aria-label="Finished work">
      <span className="bridge-finished-line">{FinishedWorkModel.filterLineTextOf(choice, hiddenCount)}</span>
      {OFFERED_FINISHED_WORK_SPANS.map((span) => (
        <button key={span} type="button" className="bridge-finished-choice" aria-pressed={span === choice} onClick={() => onChoice(span)}>
          {FinishedWorkModel.labelOf(span)}
        </button>
      ))}
      <label className="bridge-finished-since">
        since
        <input type="date" aria-label="Show finished work since" onChange={(event) => chooseSince(event.currentTarget.value)} />
      </label>
    </div>
  );
}

export interface FinishedWorkViewProps {
  readonly tickets:              readonly PageTicketDocument[];
  readonly choice:               FinishedWorkChoice;
  readonly nowEpochMilliseconds: number;
}

export function FinishedWorkView({ tickets, choice, nowEpochMilliseconds }: FinishedWorkViewProps) {
  const { shown } = FinishedWorkModel.finishedTicketsOf(tickets, FinishedWorkModel.cutoffEpochMillisecondsOf(choice, nowEpochMilliseconds));
  return (
    <section className="bridge-finished" aria-label="Finished work">
      {shown.length === 0
        ? <p className="bridge-empty">{`No ticket finished ${FinishedWorkModel.windowPhraseOf(choice)}.`}</p>
        : (
          <ul className="bridge-finished-list">
            {shown.map((ticket) => (
              <li key={ticket.id} className="bridge-finished-ticket" data-state={ticket.status}>
                <a href={`#tickets/${ticket.id}`}>{`#${ticket.id}`}</a>
                {` ${ticket.title}`}
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}
