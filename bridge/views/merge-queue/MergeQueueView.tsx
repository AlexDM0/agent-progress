/** The Merge queue lane's detail: no controls of its own, since merge moves belong to the incident or decision they answer. */
import { FIVE_KEY_ORDER_TEXT, type MergeQueueTarget } from './MergeQueueModel.ts';

export interface MergeQueueViewProps {
  readonly targets: readonly MergeQueueTarget[];
}

export function MergeQueueView({ targets }: MergeQueueViewProps) {
  return (
    <section className="bridge-merge-queue" aria-label="Merge queue">
      <p className="bridge-merge-order">{FIVE_KEY_ORDER_TEXT}</p>
      {targets.length === 0 ? <p className="bridge-empty">Nothing is queued to merge.</p> : null}
      {targets.map((target) => (
        <article key={target.target} className="bridge-merge-target" aria-label={target.target}>
          <h2 className="bridge-merge-target-name">{target.target}</h2>
          <p className="bridge-merge-holder" data-phase={target.phase ?? undefined}>{target.holderText}</p>
          {target.waitingReasons.map((reason) => <p key={reason} className="bridge-merge-waiting" role="status">{reason}</p>)}
          <ol className="bridge-merge-lines">
            {target.lines.map((line) => (
              <li key={line.ticketId} className="bridge-merge-line" data-forecast={line.forecast}>
                <a href={`#tickets/${line.ticketId}`}>{`#${line.ticketId}`}</a>
                {` ${line.priority} · ${line.forecastText}${line.causesText === null ? '' : ` · ${line.causesText}`}`}
              </li>
            ))}
          </ol>
          {target.pairwiseTexts.length === 0 ? null : (
            <ul className="bridge-merge-pairwise" aria-label="Predicted conflicts between candidates">
              {target.pairwiseTexts.map((text) => <li key={text}>{text}</li>)}
            </ul>
          )}
        </article>
      ))}
    </section>
  );
}
