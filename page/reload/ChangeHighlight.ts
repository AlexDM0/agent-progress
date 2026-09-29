/**
 * After an idle reload, marks the chart rows, Kanban cards and ticket-table rows whose state changed or that are new, once. The template's
 * `[data-changed]` rule draws the mark; its animation, or under reduced motion a timer, takes it off again.
 */

import type { ScreenSignature }                                                  from '../@types/ViewerChoices.ts';
import { KANBAN_BOARD_ELEMENT_ID, TASK_ROWS_ELEMENT_ID, TICKET_ROWS_ELEMENT_ID } from '../constants/TemplateIds.ts';
import { ScreenSignatureUtil }                                                   from './utils/ScreenSignatureUtil.ts';

// The same span as the template's `ap-changed` animation, so the static outline under reduced motion lasts as long as the motion would.
const CHANGE_HIGHLIGHT_MILLISECONDS = 1200;
const CHANGE_HIGHLIGHT_ANIMATION    = 'ap-changed';
const CHANGED_ATTRIBUTE             = 'data-changed';

function markChanged(element: HTMLElement, motionIsReduced: boolean): void {
  element.setAttribute(CHANGED_ATTRIBUTE, '');
  if (motionIsReduced) {
    window.setTimeout(() => element.removeAttribute(CHANGED_ATTRIBUTE), CHANGE_HIGHLIGHT_MILLISECONDS);
    return;
  }
  // A panel hidden behind another tab starts the animation only once it is shown, so the mark waits for its viewer.
  element.addEventListener('animationend', function clearMark(event) {
    if (event.target === element && event.animationName === CHANGE_HIGHLIGHT_ANIMATION) {
      element.removeAttribute(CHANGED_ATTRIBUTE);
      element.removeEventListener('animationend', clearMark);
    }
  });
}

function markEach(selector: string, idOf: (element: HTMLElement) => string | undefined, highlightedIds: ReadonlySet<string>, motionIsReduced: boolean): void {
  document.querySelectorAll<HTMLElement>(selector).forEach((element) => {
    const id = idOf(element);
    if (id !== undefined && highlightedIds.has(id)) {
      markChanged(element, motionIsReduced);
    }
  });
}

/** Called after the place is restored, since restoring the ticket view redraws the ticket table. */
export function highlightChangesSince(previousSignature: ScreenSignature, currentSignature: ScreenSignature): void {
  const changes          = ScreenSignatureUtil.changesBetween(previousSignature, currentSignature);
  const changedTaskIds   = ScreenSignatureUtil.highlightedIdsOf(changes.tasks);
  const changedTicketIds = ScreenSignatureUtil.highlightedIdsOf(changes.tickets);
  const motionIsReduced  = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  markEach(`#${TASK_ROWS_ELEMENT_ID} .ap-row[data-task-id]`, (row) => row.dataset['taskId'], changedTaskIds, motionIsReduced);
  markEach(`#${KANBAN_BOARD_ELEMENT_ID} .ap-kanban-card[data-ticket-id]`, (card) => card.dataset['ticketId'], changedTicketIds, motionIsReduced);
  markEach(`#${TICKET_ROWS_ELEMENT_ID} > tr[data-ticket-id]`, (row) => row.dataset['ticketId'], changedTicketIds, motionIsReduced);
}
