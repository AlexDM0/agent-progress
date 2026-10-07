/**
 * Lights a hovered node's lineage on the Dependencies canvas: the node, everything it depends on and everything waiting on it, and the
 * edges between them; the rest dims. Pointing at anything else, inside or outside the canvas, clears it after a short grace, so crossing
 * the gap to a neighbouring node switches the lineage without a frame in which nothing is lit. A node names its id on `nodeIdAttribute`,
 * which a click opens.
 */

import type { DependencyGraph } from '../@types/DependencyGraph.ts';

const CANVAS_SELECTOR = '.ap-dependency-canvas';
const NODE_SELECTOR   = '.ap-dependency-node';
const EDGE_SELECTOR   = '.ap-dependency-edge';

const TRACKER_NODE_ID_ATTRIBUTE = 'data-open-ticket';

export const LINEAGE_CLEAR_GRACE_MILLISECONDS = 120;

export interface DependencyLineageControllerOptions {
  containerElementId: string;
  readGraph:          () => DependencyGraph;
  /** The tracker page's `data-open-ticket` when left out. */
  nodeIdAttribute?:   string;
}

function lineageOf(graph: DependencyGraph, ticketId: string): Set<string> {
  return new Set([ticketId, ...(graph.upstreamOfNode.get(ticketId) ?? []), ...(graph.heldOfNode.get(ticketId) ?? [])]);
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
  let pendingClear: ReturnType<typeof setTimeout> | null = null;

  function cancelPendingClear(): void {
    if (pendingClear !== null) {
      clearTimeout(pendingClear);
      pendingClear = null;
    }
  }

  /** Keeps the first deadline, so wandering over empty canvas never stretches the grace. */
  function clearAfterGrace(container: Element, canvas: Element): void {
    if (pendingClear !== null || !canvas.hasAttribute('data-lineage-shown')) {
      return;
    }
    pendingClear = setTimeout(() => {
      pendingClear = null;
      // A canvas the page filled again since is no longer in the container, and its replacement shows nothing.
      if (container.contains(canvas)) {
        clearLineage(canvas);
      }
    }, LINEAGE_CLEAR_GRACE_MILLISECONDS);
  }

  return {
    /** Listens on the container, so a canvas filled again later keeps working. */
    wire(): void {
      const container = document.getElementById(options.containerElementId);
      if (container === null) {
        return;
      }
      container.addEventListener('pointerover', (event) => {
        const target = event.target instanceof Element ? event.target : null;
        const canvas = target?.closest(CANVAS_SELECTOR) ?? null;
        if (target === null || canvas === null) {
          return;
        }
        const node = target.closest(NODE_SELECTOR);
        if (node === null) {
          clearAfterGrace(container, canvas);
          return;
        }
        cancelPendingClear();
        showLineage(canvas, lineageOf(options.readGraph(), node.getAttribute(nodeIdAttribute) ?? ''), nodeIdAttribute);
      });
      container.addEventListener('pointerout', (event) => {
        const canvas  = event.target instanceof Element ? event.target.closest(CANVAS_SELECTOR) : null;
        const leaving = !(event.relatedTarget instanceof Node) || canvas === null || !canvas.contains(event.relatedTarget);
        if (canvas !== null && leaving) {
          clearAfterGrace(container, canvas);
        }
      });
    },
  };
}
