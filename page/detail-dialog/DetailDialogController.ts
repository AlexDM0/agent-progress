/** The overview dialog: which row, ticket line or Kanban card opens it, what it is filled with, and how it closes. */

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
import { DomUtil }            from '../utils/DomUtil.ts';
import { GeometryUtil }       from '../utils/GeometryUtil.ts';
import { taskDetailMarkup }   from './TaskDetail.ts';
import { ticketDetailMarkup } from './TicketDetail.ts';

const DETAIL_DIALOG_ELEMENT_ID = 'ap-detail';
const DETAIL_CLOSE_ELEMENT_ID  = 'ap-detail-close';

export interface DetailDialogSources {
  rows:                  readonly BoardRow[];
  tickets:               readonly BoardTicket[];
  log:                   readonly IdentifiedLogEntry[];
  limits:                PageLimits;
  readTodayCalendarDate: () => string;
  readKanbanCards:       () => readonly KanbanCard[];
}

/** A double-click inside a link belongs to the link: a row already carries its ticket badge and its "waiting on" links. */
function doubleClickedRowOf(event: Event, selector: string): HTMLElement | null {
  if (!(event.target instanceof Element) || event.target.closest('a') !== null) {
    return null;
  }
  const row = event.target.closest(selector);
  return row instanceof HTMLElement ? row : null;
}

/** Enter counts only on the focused row itself, so Enter on a link inside it still follows the link. */
function keyActivatedRowOf(event: KeyboardEvent, selector: string): HTMLElement | null {
  if (event.key !== 'Enter' || !(event.target instanceof HTMLElement) || !event.target.matches(selector)) {
    return null;
  }
  return event.target;
}

function wireRowOverview(containerId: string, rowSelector: string, showRowDetail: (row: HTMLElement) => unknown): void {
  const container = document.getElementById(containerId);
  container?.addEventListener('dblclick', (event) => {
    const row = doubleClickedRowOf(event, rowSelector);
    if (row !== null) {
      showRowDetail(row);
    }
  });
  container?.addEventListener('keydown', (event) => {
    const row = keyActivatedRowOf(event, rowSelector);
    if (row !== null) {
      event.preventDefault();
      showRowDetail(row);
    }
  });
}

function markCoveredTickLabels(): void {
  const body     = document.getElementById(DETAIL_BODY_ELEMENT_ID);
  const endLabel = body?.querySelector('.ap-ticket-gantt-end-label') ?? null;
  if (body === null || endLabel === null) {
    return;
  }
  const endBox = endLabel.getBoundingClientRect();
  for (const tick of body.querySelectorAll('.ap-ticket-gantt-ticks .ap-tick')) {
    const label = tick.firstElementChild;
    tick.toggleAttribute('data-covered', label !== null && GeometryUtil.tickLabelIsCovered(label.getBoundingClientRect(), endBox));
  }
}

export interface DetailDialogController {
  wire(): void;
  readOpenTarget(): DetailTarget | null;
  /** Opens the panel on the target again; a task or ticket the board no longer shows opens nothing and answers false. */
  reopen(target: DetailTarget): boolean;
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
  let openTarget: DetailTarget | null = null;

  const detailDialog = (): HTMLDialogElement | null => {
    const dialog = document.getElementById(DETAIL_DIALOG_ELEMENT_ID);
    return dialog instanceof HTMLDialogElement ? dialog : null;
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
    dialog.showModal();
    openTarget = target;
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
    dialog.showModal();
    openTarget = { kind: 'kanban-card', id: ticketId };
    markCoveredTickLabels();
    return true;
  };

  const showTargetDetail: Readonly<Record<DetailTarget['kind'], (id: string) => boolean>> = {
    'task':        showTaskDetail,
    'ticket':      showTicketDetail,
    'kanban-card': showKanbanCardDetail,
  };

  const wire = (): void => {
    const dialog = detailDialog();
    if (dialog === null) {
      return;
    }
    wireRowOverview(TASK_ROWS_ELEMENT_ID, '.ap-row', (row) => showTaskDetail(row.dataset['taskId'] ?? ''));
    wireRowOverview(TICKET_ROWS_ELEMENT_ID, '[data-ticket-id]', (row) => showTicketDetail(row.dataset['ticketId'] ?? ''));
    wireRowOverview(KANBAN_BOARD_ELEMENT_ID, '.ap-kanban-card', (cardElement) => showKanbanCardDetail(cardElement.dataset['ticketId'] ?? ''));
    window.addEventListener('resize', () => {
      if (dialog.open) {
        markCoveredTickLabels();
      }
    });

    document.getElementById(DETAIL_CLOSE_ELEMENT_ID)?.addEventListener('click', () => {
      dialog.close();
    });
    // The backdrop is the dialog's own box outside its content, so a click that lands on the element itself is a click beside the panel.
    dialog.addEventListener('click', (event) => {
      const linkClicked = event.target instanceof Element && event.target.closest('a') !== null;
      if (event.target === dialog || linkClicked) {
        dialog.close();
      }
    });
  };

  return {
    wire,
    // Read from the dialog itself: its close event is queued, and a reload can come before it is dispatched.
    readOpenTarget: () => (detailDialog()?.open === true ? openTarget : null),
    reopen:         (target) => showTargetDetail[target.kind](target.id),
  };
}
