/** The Epics view: a card per shown epic with its roll-up, facts, description in its sandboxed frame and its tickets, newest first. */
import type { EpicsModelResult } from './EpicsModel.ts';
import { SandboxedHtml }         from './SandboxedHtml.tsx';

export interface EpicsViewProps {
  readonly model: EpicsModelResult;
}

export function EpicsView({ model }: EpicsViewProps) {
  if (model.emptyText !== null) return <p className="bridge-empty">{model.emptyText}</p>;
  return (
    <section className="bridge-epics" aria-label="Epics">
      {model.cards.map((card) => (
        <article key={card.key} className="bridge-epic" data-epic-slot={card.slot} data-live={card.isLive ? '' : undefined} aria-label={card.title}>
          <header className="bridge-epic-head">
            <h2 className="bridge-epic-title">{card.title}</h2>
            <span className="bridge-epic-key">{card.key}</span>
            <span className="bridge-epic-done">{card.doneText}</span>
          </header>
          <div className="bridge-epic-progress" role="img" aria-label={`${card.doneText} tickets`}>
            {card.segments.map((segment) => (
              <span
                key={segment.state}
                className="bridge-epic-segment"
                data-state={segment.state}
                style={{ flexGrow: segment.count }}
                title={`${segment.state} ${segment.count}`}
              />
            ))}
          </div>
          <dl className="bridge-epic-facts">
            {card.facts.map((fact) => (
              <div key={fact.label} className="bridge-epic-fact">
                <dt>{fact.label}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>
          {card.descriptionHtml === '' ? null : <SandboxedHtml html={card.descriptionHtml} title={`${card.title} description`} />}
          <ul className="bridge-epic-tickets">
            {card.tickets.map((ticket) => (
              <li key={ticket.ticketId} className="bridge-epic-ticket" data-state={ticket.displayState} data-live={ticket.isLive ? '' : undefined}>
                <a href={`#tickets/${ticket.ticketId}`}>{`#${ticket.ticketId}`}</a>
                {` ${ticket.title}`}
              </li>
            ))}
          </ul>
        </article>
      ))}
    </section>
  );
}
