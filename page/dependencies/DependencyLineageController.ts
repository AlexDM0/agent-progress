/**
 * Lights a hovered node's lineage on the Dependencies canvas: the node, everything it depends on and everything waiting on it, and the
 * edges between them; the rest dims until the pointer leaves the canvas. A node names its id on `nodeIdAttribute`, which a click opens.
 */

import type { DependencyGraph } from '../@types/DependencyGraph.ts';

const CANVAS_SELECTOR = '.ap-dependency-canvas';
const NODE_SELECTOR   = '.ap-dependency-node';
const EDGE_SELECTOR   = '.ap-dependency-edge';

const TRACKER_NODE_ID_ATTRIBUTE = 'data-open-ticket';

export interface DependencyLineageControllerOptions {
  containerElementId: string;
  readGraph:          () => DependencyGraph;
  /** The tracker page's `data-open-ticket` when left out. */
  nodeIdAttribute?:   string;
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

function showLineage(canvas: Element, lineage: ReadonlySet<string>, nodeIdAttribute: string): void {
  canvas.setAttribute('data-lineage-shown', '');
  for (const node of canvas.querySelectorAll(NODE_SELECTOR)) {
    node.toggleAttribute('data-lit', lineage.has(node.getAttribute(nodeIdAttribute) ?? ''));
  }
  for (const edge of canvas.querySelectorAll(EDGE_SELECTOR)) {
    edge.toggleAttribute('data-lit', lineage.has(edge.getAttribute('data-from') ?? '') && lineage.has(edge.getAttribute('data-to') ?? ''));
  }
}

export function createDependencyLineageController(options: DependencyLineageControllerOptions) {
  const nodeIdAttribute = options.nodeIdAttribute ?? TRACKER_NODE_ID_ATTRIBUTE;
  return {
    /** Listens on the container, so a canvas filled again later keeps working. */
    wire(): void {
      const container = document.getElementById(options.containerElementId);
      if (container === null) {
        return;
      }
      container.addEventListener('pointerover', (event) => {
        const node   = event.target instanceof Element ? event.target.closest(NODE_SELECTOR) : null;
        const canvas = node?.closest(CANVAS_SELECTOR) ?? null;
        if (node === null || canvas === null) {
          return;
        }
        showLineage(canvas, lineageOf(options.readGraph(), node.getAttribute(nodeIdAttribute) ?? ''), nodeIdAttribute);
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
