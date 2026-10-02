/**
 * The Kanban's hover arrows: hovering a card marks each card it directly depends on "needed first" and draws an arrow from each into it,
 * over the whole board; nothing else on the board dims. Leaving the board removes both.
 */

import { KANBAN_BOARD_ELEMENT_ID, KANBAN_FRAME_ELEMENT_ID } from '../constants/TemplateIds.ts';
import { MarkupUtil }                                       from '../utils/MarkupUtil.ts';
import { TemplateIdUtil }                                   from '../utils/TemplateIdUtil.ts';
import type { ArrowCardBox }                                from './utils/DependencyArrowUtil.ts';
import { DependencyArrowUtil }                              from './utils/DependencyArrowUtil.ts';

const ARROW_STAGGER_MILLISECONDS = 90;
const ARROWS_SELECTOR            = ':scope > .ap-kanban-arrows';
const NEEDED_FIRST_ATTRIBUTE     = 'data-needed-first';

interface KanbanDependencyArrowSources {
  /** The tickets a card's ticket directly depends on. */
  dependenciesOf: (ticketId: string) => readonly string[];
}

export interface KanbanDependencyArrowController {
  wire(): void;
  /** Measures the hovered card's arrows again, without drawing them in, after the board was laid out anew. */
  refresh(): void;
}

function cardElementOf(ticketId: string): HTMLElement | null {
  return document.getElementById(TemplateIdUtil.kanbanCardElementIdOf(ticketId));
}

/** A card's box relative to the frame, or null for a card not laid out, such as one in the collapsed Abandoned lane. */
function boxWithin(frameBox: DOMRect, element: Element): ArrowCardBox | null {
  const box = element.getBoundingClientRect();
  if (box.width === 0 && box.height === 0) {
    return null;
  }
  return {
    left: box.left - frameBox.left, right: box.right - frameBox.left, top: box.top - frameBox.top, height: box.height
  };
}

function removeArrows(): void {
  document.getElementById(KANBAN_FRAME_ELEMENT_ID)?.querySelector(ARROWS_SELECTOR)?.remove();
  document.querySelectorAll(`#${KANBAN_BOARD_ELEMENT_ID} [${NEEDED_FIRST_ATTRIBUTE}]`).forEach((card) => card.removeAttribute(NEEDED_FIRST_ATTRIBUTE));
}

export function createKanbanDependencyArrowController(sources: KanbanDependencyArrowSources): KanbanDependencyArrowController {
  let hoveredTicketId: string | null = null;
  let pendingFrame                   = 0;

  const drawArrows = (drawsIn: boolean): void => {
    removeArrows();
    const frame  = document.getElementById(KANBAN_FRAME_ELEMENT_ID);
    const target = hoveredTicketId === null ? null : cardElementOf(hoveredTicketId);
    if (frame === null || target === null || hoveredTicketId === null) {
      return;
    }
    const frameBox  = frame.getBoundingClientRect();
    const targetBox = boxWithin(frameBox, target);
    if (targetBox === null) {
      return;
    }
    const targetLane = target.closest('.ap-lane');
    const arrows     = sources.dependenciesOf(hoveredTicketId).flatMap((dependencyId) => {
      const source    = cardElementOf(dependencyId);
      const sourceBox = source === null ? null : boxWithin(frameBox, source);
      if (source === null || sourceBox === null) {
        return [];
      }
      source.setAttribute(NEEDED_FIRST_ATTRIBUTE, '');
      return [DependencyArrowUtil.dependencyArrowOf(sourceBox, targetBox, source.closest('.ap-lane') === targetLane)];
    });
    if (arrows.length === 0) {
      return;
    }
    const arrowsMarkup = arrows.map((arrow, index) => [
      `<g ${MarkupUtil.attribute('style', `--arrow-delay: ${index * ARROW_STAGGER_MILLISECONDS}ms`)} ${MarkupUtil.attribute('data-route', arrow.route)}>`,
      `<path class="ap-kanban-arrow-line" pathLength="1" ${MarkupUtil.attribute('d', arrow.linePath)}></path>`,
      `<path class="ap-kanban-arrow-head" ${MarkupUtil.attribute('d', arrow.headPath)}></path></g>`,
    ].join('')).join('');
    frame.insertAdjacentHTML('beforeend', `<svg class="ap-kanban-arrows" aria-hidden="true"${drawsIn ? '' : ' data-still=""'}>${arrowsMarkup}</svg>`);
  };

  // Measured on the next frame, once the hover state has rendered.
  const scheduleArrows = (drawsIn: boolean): void => {
    cancelAnimationFrame(pendingFrame);
    pendingFrame = requestAnimationFrame(() => drawArrows(drawsIn));
  };

  const refresh = (): void => {
    if (hoveredTicketId !== null) {
      scheduleArrows(false);
    }
  };

  return {
    wire: () => {
      const board = document.getElementById(KANBAN_BOARD_ELEMENT_ID);
      board?.addEventListener('mouseover', (event) => {
        const card     = event.target instanceof Element ? event.target.closest<HTMLElement>('.ap-kanban-card[data-ticket-id]') : null;
        const ticketId = card?.dataset['ticketId'];
        if (ticketId === undefined || ticketId === hoveredTicketId) {
          return;
        }
        hoveredTicketId = ticketId;
        removeArrows();
        scheduleArrows(true);
      });
      board?.addEventListener('mouseleave', () => {
        hoveredTicketId = null;
        cancelAnimationFrame(pendingFrame);
        removeArrows();
      });
      board?.addEventListener('scroll', refresh, { passive: true });
      window.addEventListener('resize', refresh);
    },
    refresh,
  };
}
