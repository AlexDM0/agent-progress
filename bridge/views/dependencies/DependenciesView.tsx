/**
 * The dependencies view: `DependenciesModel`'s waves canvas and its legend. Pointing at a ticket lights its lineage, the ticket, everything
 * it depends on and everything waiting on it, with the edges between them, and dims the rest; leaving clears it after a short grace, so
 * crossing the gap to a neighbouring ticket switches the lineage without a frame in which nothing is lit. A ticket opens its detail panel.
 */
import { useEffect, useRef, useState } from 'react';

import { HashRouter }                                                            from '../../shell/HashRouter.ts';
import type { DependenciesCanvasModel, DependencyNodeChip, DependencyNodeModel } from './DependenciesModel.ts';
import { DependenciesModel, EMPTY_DEPENDENCIES_TEXT }                            from './DependenciesModel.ts';

export const LINEAGE_CLEAR_GRACE_MILLISECONDS = 120;

export interface DependenciesViewProps {
  readonly canvas: DependenciesCanvasModel;
}

function NodeChip({ chip }: { readonly chip: DependencyNodeChip }) {
  if (chip.kind === 'ready') return <span className="bridge-state-badge" data-ready="">Ready</span>;
  if (chip.kind === 'held') return <span className="bridge-kanban-held" title={chip.title}>Held</span>;
  return <span className="bridge-state-badge" data-state={chip.displayState}>{chip.label}</span>;
}

function DependencyNode({ node, isLit, onPoint }: { readonly node: DependencyNodeModel; readonly isLit: boolean; readonly onPoint: (ticketId: string) => void }) {
  return (
    <a
      className="bridge-dependency-node"
      href={HashRouter.fragmentOf({ tab: 'tickets', item: node.ticketId })}
      aria-label={`${node.idLabel} ${node.title}`}
      data-ticket-id={node.ticketId}
      data-state={node.displayState}
      data-done={node.isDone ? '' : undefined}
      data-in-review={node.isInReview ? '' : undefined}
      data-live={node.isLive ? '' : undefined}
      data-lit={isLit ? '' : undefined}
      style={{ left: node.left, top: node.top }}
      onPointerEnter={() => onPoint(node.ticketId)}
    >
      <span className="bridge-dependency-node-head">
        <span className="bridge-kanban-id">{node.idLabel}</span>
        {node.chips.map((chip) => <NodeChip key={chip.kind} chip={chip} />)}
        {node.heldCount === 0 ? null : <span className="bridge-dependency-wait" data-heavy={node.heldIsHeavy ? '' : undefined}>{`${node.heldCount} wait`}</span>}
      </span>
      <span className="bridge-dependency-node-title">{node.title}</span>
      {node.weightWidth > 0 ? <span className="bridge-dependency-weight" style={{ width: node.weightWidth }} /> : null}
    </a>
  );
}

export function DependenciesView({ canvas }: DependenciesViewProps) {
  const [litTicketIds, setLitTicketIds] = useState<ReadonlySet<string> | null>(null);
  const pendingClear = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelPendingClear = (): void => {
    if (pendingClear.current === null) return;
    clearTimeout(pendingClear.current);
    pendingClear.current = null;
  };
  useEffect(() => cancelPendingClear, []);

  const showLineage = (ticketId: string): void => {
    cancelPendingClear();
    setLitTicketIds(DependenciesModel.lineageOf(canvas.graph, ticketId));
  };
  /** Keeps the first deadline, so wandering over empty canvas never stretches the grace. */
  const clearAfterGrace = (): void => {
    if (pendingClear.current !== null) return;
    pendingClear.current = setTimeout(() => {
      pendingClear.current = null;
      setLitTicketIds(null);
    }, LINEAGE_CLEAR_GRACE_MILLISECONDS);
  };

  if (canvas.columns.length === 0) return <p className="bridge-empty">{EMPTY_DEPENDENCIES_TEXT}</p>;
  const edgeIsLit = (fromTicketId: string, toTicketId: string): boolean => litTicketIds !== null && litTicketIds.has(fromTicketId) && litTicketIds.has(toTicketId);

  return (
    <section className="bridge-dependencies" aria-label="Dependencies">
      <div
        className="bridge-dependency-canvas"
        data-lineage-shown={litTicketIds === null ? undefined : ''}
        style={{ width: canvas.width, height: canvas.height }}
        onPointerLeave={clearAfterGrace}
        onPointerOver={(event) => {
          if (event.target instanceof Element && event.target.closest('a') === null) clearAfterGrace();
        }}
      >
        {canvas.columns.map((column) => (
          <div
            key={`band-${column.key}`}
            className="bridge-dependency-band"
            data-narrow={column.isNarrow ? '' : undefined}
            data-done={column.isDone ? '' : undefined}
            style={{
              left: column.bandLeft, top: column.bandTop, width: column.bandWidth, height: column.bandHeight
            }}
          />
        ))}
        <svg className="bridge-dependency-edges" width={canvas.width} height={canvas.height} viewBox={`0 0 ${canvas.width} ${canvas.height}`} aria-hidden="true">
          {canvas.edges.map((edge) => (
            <path
              key={`${edge.fromTicketId}>${edge.toTicketId}`}
              className="bridge-dependency-edge"
              data-from={edge.fromTicketId}
              data-to={edge.toTicketId}
              data-pace={edge.isPace ? '' : undefined}
              data-settled={edge.isSettled ? '' : undefined}
              data-lit={edgeIsLit(edge.fromTicketId, edge.toTicketId) ? '' : undefined}
              d={edge.path}
            />
          ))}
        </svg>
        {canvas.columns.map((column) => (
          <div
            key={`head-${column.key}`}
            className="bridge-dependency-head"
            data-narrow={column.isNarrow ? '' : undefined}
            data-done={column.isDone ? '' : undefined}
            style={{ left: column.left }}
          >
            <span className="bridge-dependency-head-name">{column.label}</span>
            <span className="bridge-dependency-head-count">{column.countText}</span>
            {column.forecastText === null ? null : <span className="bridge-dependency-head-count">{column.forecastText}</span>}
            {column.slotsFilled.length === 0
              ? null
              : (
                <span className="bridge-dependency-slots" role="img" aria-label={column.slotsLabel}>
                  {column.slotsFilled.map((filled, slot) => <span key={slot} className="bridge-dependency-slot" data-filled={filled ? '' : undefined} />)}
                </span>
              )}
          </div>
        ))}
        {canvas.nodes.map((node) => <DependencyNode key={node.ticketId} node={node} isLit={litTicketIds?.has(node.ticketId) === true} onPoint={showLineage} />)}
      </div>
      <ul className="bridge-dependency-legend">
        <li><span className="bridge-dependency-legend-line" data-pace="" />sets the pace</li>
        <li><span className="bridge-dependency-legend-line" />waits on</li>
        <li><span className="bridge-dependency-legend-line" data-settled="" />built on (done)</li>
        <li><span className="bridge-dependency-slot" data-filled="" />{`slot in use (of ${canvas.boardSlots})`}</li>
      </ul>
    </section>
  );
}
