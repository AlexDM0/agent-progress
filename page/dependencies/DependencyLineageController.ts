/**
 * Lights a hovered node's lineage on the Dependencies canvas: the ticket, everything it depends on and everything waiting on it, and the
 * edges between them; the rest dims until the pointer leaves the canvas. A click opens the ticket through `[data-open-ticket]`.
 */

import type { DependencyGraph } from '../@types/DependencyGraph.ts';

const CANVAS_SELECTOR = '.ap-dependency-canvas';
const NODE_SELECTOR   = '.ap-dependency-node';
const EDGE_SELECTOR   = '.ap-dependency-edge';

export interface DependencyLineageControllerOptions {
  containerElementId: string;
  readGraph:          () => DependencyGraph;
}

function lineageOf(graph: DependencyGraph, ticketId: string): Set<string> {
  return new Set([ticketId, ...(graph.upstreamOfTicket.get(ticketId) ?? []), ...(graph.heldOfTicket.get(ticketId) ?? [])]);
}

function clearLineage(canvas: Element): void {
  canvas.removeAttribute('data-lineage-shown');
  for (const lit of canvas.querySelectorAll('[data-lit]')) {
    lit.removeAttribute('data-lit');
  }
}

function showLineage(canvas: Element, lineage: ReadonlySet<string>): void {
  canvas.setAttribute('data-lineage-shown', '');
  for (const node of canvas.querySelectorAll<HTMLElement>(NODE_SELECTOR)) {
    node.toggleAttribute('data-lit', lineage.has(node.dataset['openTicket'] ?? ''));
  }
  for (const edge of canvas.querySelectorAll(EDGE_SELECTOR)) {
    edge.toggleAttribute('data-lit', lineage.has(edge.getAttribute('data-from') ?? '') && lineage.has(edge.getAttribute('data-to') ?? ''));
  }
}

export function createDependencyLineageController(options: DependencyLineageControllerOptions) {
  return {
    /** Listens on the container, so a canvas filled again later keeps working. */
    wire(): void {
      const container = document.getElementById(options.containerElementId);
      if (container === null) {
        return;
      }
      container.addEventListener('pointerover', (event) => {
        const node   = event.target instanceof Element ? event.target.closest<HTMLElement>(NODE_SELECTOR) : null;
        const canvas = node?.closest(CANVAS_SELECTOR) ?? null;
        if (node === null || canvas === null) {
          return;
        }
        showLineage(canvas, lineageOf(options.readGraph(), node.dataset['openTicket'] ?? ''));
      });
      container.addEventListener('pointerout', (event) => {
        const canvas  = event.target instanceof Element ? event.target.closest(CANVAS_SELECTOR) : null;
        const leaving = !(event.relatedTarget instanceof Node) || canvas === null || !canvas.contains(event.relatedTarget);
        if (canvas !== null && leaving) {
          clearLineage(canvas);
        }
      });
    },
  };
}
