/** The detail panel: which row, ticket line or Kanban card opens it, what it is filled with, how it slides in and out, and how it closes. */

import type { PageLimits }            from '../../src/shared/@types/PagePayload.ts';
import type { IdentifiedLogEntry }    from '../../src/shared/@types/WordedLogEntry.ts';
import type { KanbanCard }            from '../@types/KanbanCard.ts';
import type { BoardRow, BoardTicket } from '../@types/PageBoard.ts';
import type { DetailTarget }          from '../@types/ViewerChoices.ts';
import {
  DETAIL_BODY_ELEMENT_ID,
  KANBAN_BOARD_ELEMENT_ID,
  TASK_ROWS_ELEMENT_ID,
  TICKET_ROWS_ELEMENT_ID,
} from '../constants/TemplateIds.ts';
import { DomUtil }                   from '../utils/DomUtil.ts';
import { GeometryUtil }              from '../utils/GeometryUtil.ts';
import { createPanelRoomController } from './PanelRoomController.ts';
import { taskDetailMarkup }          from './TaskDetail.ts';
import { ticketDetailMarkup }        from './TicketDetail.ts';

const DETAIL_DIALOG_ELEMENT_ID = 'ap-detail';
const DETAIL_CLOSE_ELEMENT_ID  = 'ap-detail-close';
const MOTION_ATTRIBUTE         = 'data-motion';
const SWAPPED_ATTRIBUTE        = 'data-swapped';
const SELECTED_ATTRIBUTE       = 'data-selected';
const MILLISECONDS_PER_SECOND  = 1000;

const TASK_ROW_SELECTOR    = `#${TASK_ROWS_ELEMENT_ID} > .ap-row`;
const TICKET_ROW_SELECTOR  = `#${TICKET_ROWS_ELEMENT_ID} > tr[data-ticket-id]`;
const KANBAN_CARD_SELECTOR = `#${KANBAN_BOARD_ELEMENT_ID} .ap-kanban-card`;
const OPENER_SELECTOR      = [TASK_ROW_SELECTOR, TICKET_ROW_SELECTOR, KANBAN_CARD_SELECTOR].join(', ');
/** A click on one of these inside a row belongs to it: a row carries its ticket badge and its "waiting on" links. */
const OWN_CLICK_SELECTOR   = 'a, button, input, select, textarea, label, summary';

export interface DetailDialogSources {
  rows:                  readonly BoardRow[];
  tickets:               readonly BoardTicket[];
  log:                   readonly IdentifiedLogEntry[];
  limits:                PageLimits;
  readTodayCalendarDate: () => string;
  readKanbanCards:       () => readonly KanbanCard[];
  updateKanbanOverflow:  () => void;
}

function openerSelectorOf(target: DetailTarget): string {
  const id = CSS.escape(target.id);
  const selectorByKind: Readonly<Record<DetailTarget['kind'], string>> = {
    'task':        `${TASK_ROW_SELECTOR}[data-task-id="${id}"]`,
    'ticket':      `${TICKET_ROW_SELECTOR}[data-ticket-id="${id}"]`,
    'kanban-card': `${KANBAN_CARD_SELECTOR}[data-ticket-id="${id}"]`,
  };
  return selectorByKind[target.kind];
}

function targetOfOpener(opener: HTMLElement): DetailTarget {
  if (opener.matches(TASK_ROW_SELECTOR)) {
    return { kind: 'task', id: opener.dataset['taskId'] ?? '' };
  }
  return { kind: opener.matches(KANBAN_CARD_SELECTOR) ? 'kanban-card' : 'ticket', id: opener.dataset['ticketId'] ?? '' };
}

function isSameTarget(first: DetailTarget | null, second: DetailTarget): boolean {
  return first !== null && first.kind === second.kind && first.id === second.id;
}

function clickedOpenerOf(event: MouseEvent): HTMLElement | null {
  // The second click of a double-click would close what the first one opened.
  if (event.detail > 1 || !(event.target instanceof Element) || event.target.closest(`${OWN_CLICK_SELECTOR}, #${DETAIL_DIALOG_ELEMENT_ID}`) !== null) {
    return null;
  }
  const opener = event.target.closest(OPENER_SELECTOR);
  // A click that ends a text selection selected text; it opens nothing.
  if (!(opener instanceof HTMLElement) || (window.getSelection()?.toString() ?? '') !== '') {
    return null;
  }
  return opener;
}

/** Enter and Space count only on the focused row itself, so a key on a link inside it still follows the link. */
function keyActivatedOpenerOf(event: KeyboardEvent): HTMLElement | null {
  if ((event.key !== 'Enter' && event.key !== ' ') || !(event.target instanceof HTMLElement) || !event.target.matches(OPENER_SELECTOR)) {
    return null;
  }
  return event.target;
}

function markCoveredTickLabels(): void {
  const body     = document.getElementById(DETAIL_BODY_ELEMENT_ID);
  const endLabel = body?.querySelector('.ap-ticket-gantt-end-label') ?? null;
  if (body === null || endLabel === null) {
    return;
  }
  const ticks   = [...body.querySelectorAll('.ap-ticket-gantt-ticks .ap-tick')];
  const labels  = ticks.map((tick) => tick.firstElementChild?.getBoundingClientRect() ?? { left: 0, right: 0 });
  const covered = GeometryUtil.coveredTickLabels(labels, [endLabel.getBoundingClientRect()]);
  ticks.forEach((tick, index) => {
    tick.toggleAttribute('data-covered', covered[index] ?? false);
  });
}

function slideDurationMillisecondsOf(dialog: HTMLElement): number {
  return (Number.parseFloat(getComputedStyle(dialog).transitionDuration) || 0) * MILLISECONDS_PER_SECOND;
}

export interface DetailDialogController {
  wire(): void;
  readOpenTarget(): DetailTarget | null;
  /** Opens the panel on the target again; a task or ticket the board no longer shows opens nothing and answers false. */
  reopen(target: DetailTarget): boolean;
  /** Opens the panel on a ticket as its ticket line does; a ticket the board does not hold opens nothing and answers false. */
  openTicketDetail(ticketId: string): boolean;
}

export function createDetailDialogController(sources: DetailDialogSources): DetailDialogController {
  const {
    rows,
    tickets,
    log,
    limits,
    readTodayCalendarDate,
  } = sources;
  const ticketById = new Map(tickets.map((ticket) => [ticket.id, ticket]));
  const panelRoom  = createPanelRoomController(sources.updateKanbanOverflow);
  let openTarget: DetailTarget | null = null;
  let returnFocusTo: HTMLElement | null = null;
  let pendingCloseTimer = 0;

  const detailDialog = (): HTMLDialogElement | null => {
    const dialog = document.getElementById(DETAIL_DIALOG_ELEMENT_ID);
    return dialog instanceof HTMLDialogElement ? dialog : null;
  };

  const reflectSelection = (): void => {
    for (const element of document.querySelectorAll(`[${SELECTED_ATTRIBUTE}]`)) {
      element.removeAttribute(SELECTED_ATTRIBUTE);
    }
    if (openTarget !== null) {
      document.querySelector(openerSelectorOf(openTarget))?.setAttribute(SELECTED_ATTRIBUTE, '');
    }
  };

  // Slides in from the right when closed or closing; while open only the contents cross-fade.
  const present = (dialog: HTMLDialogElement, target: DetailTarget): void => {
    const body            = document.getElementById(DETAIL_BODY_ELEMENT_ID);
    const panelIsShowing  = dialog.open && !dialog.hasAttribute(MOTION_ATTRIBUTE);
    window.clearTimeout(pendingCloseTimer);
    if (panelIsShowing) {
      body?.removeAttribute(SWAPPED_ATTRIBUTE);
      void body?.offsetWidth;
      body?.setAttribute(SWAPPED_ATTRIBUTE, '');
    } else {
      panelRoom.dockBelowTabBar();
      if (!dialog.open) {
        dialog.setAttribute(MOTION_ATTRIBUTE, 'out');
        dialog.show();
      }
      void dialog.offsetWidth;
      dialog.removeAttribute(MOTION_ATTRIBUTE);
    }
    if (body !== null) {
      body.scrollTop = 0;
    }
    openTarget = target;
    reflectSelection();
  };

  const showDetail = (target: DetailTarget, task: BoardRow | null, ticket: BoardTicket | null): boolean => {
    const dialog = detailDialog();
    const markup = taskDetailMarkup({
      task,
      ticket,
      log,
      slices:            limits,
      todayCalendarDate: readTodayCalendarDate(),
    });
    if (dialog === null || markup === '') {
      return false;
    }
    DomUtil.setMarkup(DETAIL_BODY_ELEMENT_ID, markup);
    present(dialog, target);
    return true;
  };

  const showTaskDetail = (taskId: string): boolean => {
    const task = rows.find((candidate) => String(candidate.id) === taskId);
    if (task === undefined) {
      return false;
    }
    return showDetail({ kind: 'task', id: taskId }, task, task.ticket === null ? null : ticketById.get(task.ticket) ?? null);
  };
  const showTicketDetail = (ticketId: string): boolean => {
    const ticket = ticketById.get(ticketId) ?? null;
    return showDetail({ kind: 'ticket', id: ticketId }, ticket?.ownRow ?? null, ticket);
  };

  const showKanbanCardDetail = (ticketId: string): boolean => {
    const dialog = detailDialog();
    const card   = sources.readKanbanCards().find((candidate) => candidate.ticket.id === ticketId);
    if (dialog === null || card === undefined) {
      return false;
    }
    DomUtil.setMarkup(DETAIL_BODY_ELEMENT_ID, ticketDetailMarkup({
      card,
      nowEpochMilliseconds: Date.now(),
      todayCalendarDate:    readTodayCalendarDate(),
      limits,
    }));
    present(dialog, { kind: 'kanban-card', id: ticketId });
    markCoveredTickLabels();
    return true;
  };

  const showTargetDetail: Readonly<Record<DetailTarget['kind'], (id: string) => boolean>> = {
    'task':        showTaskDetail,
    'ticket':      showTicketDetail,
    'kanban-card': showKanbanCardDetail,
  };

  const openAndMakeRoom = (target: DetailTarget, opener: HTMLElement | null): boolean => {
    if (!showTargetDetail[target.kind](target.id)) {
      return false;
    }
    requestAnimationFrame(() => {
      panelRoom.makeRoom();
      if (opener !== null && opener.isConnected) {
        panelRoom.scrollClearOfPanel(opener);
      }
    });
    return true;
  };

  const openFromOpener = (opener: HTMLElement, focusStaysOnOpener: boolean): void => {
    if (!openAndMakeRoom(targetOfOpener(opener), opener)) {
      return;
    }
    returnFocusTo = opener;
    // show() moves focus into the panel, which a pointer did not ask for.
    if (focusStaysOnOpener) {
      opener.focus({ preventScroll: true });
    }
  };

  const close = (returnFocus: boolean): void => {
    const dialog = detailDialog();
    if (dialog === null || !dialog.open || dialog.hasAttribute(MOTION_ATTRIBUTE)) {
      return;
    }
    const closedTarget   = openTarget;
    const slideDuration  = slideDurationMillisecondsOf(dialog);
    const finishClosing  = (): void => {
      dialog.close();
      dialog.removeAttribute(MOTION_ATTRIBUTE);
    };
    if (slideDuration === 0) {
      finishClosing();
    } else {
      dialog.setAttribute(MOTION_ATTRIBUTE, 'out');
      pendingCloseTimer = window.setTimeout(finishClosing, slideDuration);
    }
    openTarget = null;
    reflectSelection();
    panelRoom.releaseRoom(() => openTarget !== null);
    // A layout since the panel opened replaced the opener with an equal one.
    const openerNow   = closedTarget === null ? null : document.querySelector(openerSelectorOf(closedTarget));
    const focusTarget = returnFocusTo !== null && returnFocusTo.isConnected ? returnFocusTo : openerNow;
    if (returnFocus && focusTarget instanceof HTMLElement) {
      focusTarget.focus({ preventScroll: true });
    }
    returnFocusTo = null;
  };

  const wire = (): void => {
    const dialog = detailDialog();
    if (dialog === null) {
      return;
    }
    document.addEventListener('click', (event) => {
      const opener = clickedOpenerOf(event);
      if (opener === null) {
        return;
      }
      if (isSameTarget(openTarget, targetOfOpener(opener))) {
        close(false);
        return;
      }
      openFromOpener(opener, true);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && openTarget !== null && !event.defaultPrevented) {
        event.preventDefault();
        close(true);
        return;
      }
      const opener = keyActivatedOpenerOf(event);
      if (opener !== null) {
        event.preventDefault();
        openFromOpener(opener, false);
      }
    });
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      close(true);
    });
    document.getElementById(DETAIL_CLOSE_ELEMENT_ID)?.addEventListener('click', () => {
      close(true);
    });
    dialog.addEventListener('click', (event) => {
      if (event.target instanceof Element && event.target.closest('a') !== null) {
        close(false);
      }
    });

    // The containers are refilled on every layout, which drops the mark on the row the panel shows.
    const selectionObserver = new MutationObserver(reflectSelection);
    for (const elementId of [TASK_ROWS_ELEMENT_ID, TICKET_ROWS_ELEMENT_ID, KANBAN_BOARD_ELEMENT_ID]) {
      const container = document.getElementById(elementId);
      if (container !== null) {
        selectionObserver.observe(container, { childList: true, subtree: true });
      }
    }
    window.addEventListener('scroll', () => {
      if (openTarget !== null) {
        panelRoom.dockBelowTabBar();
      }
    }, { passive: true });
    window.addEventListener('resize', () => {
      if (openTarget === null) {
        return;
      }
      markCoveredTickLabels();
      panelRoom.dockBelowTabBar();
      // After the page's own resize layout, which measures the chart without the room.
      requestAnimationFrame(panelRoom.remakeRoom);
    });
  };

  return {
    wire,
    readOpenTarget:   () => (detailDialog()?.open === true ? openTarget : null),
    reopen:           (target) => openAndMakeRoom(target, null),
    openTicketDetail: (ticketId) => {
      const opener = document.activeElement;
      if (!openAndMakeRoom({ kind: 'ticket', id: ticketId }, null)) {
        return false;
      }
      returnFocusTo = opener instanceof HTMLElement ? opener : null;
      return true;
    },
  };
}
