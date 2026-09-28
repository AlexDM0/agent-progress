/**
 * The browser entry: it fills the containers of `resources/template.html` from the two JSON islands and does nothing else. Theme, tab
 * selection, ticket open state and the idle reload stay with the template's own bootstrap, reached through `window.agentProgressTemplate`.
 */

import type { PagePayload, PageTicket } from '../src/shared/@types/PagePayload.ts';
import type { BoardTicket }             from './@types/PageBoard.ts';
import {
  AXIS_TICKS_ELEMENT_ID,
  CHART_OVERLAY_ELEMENT_ID,
  DETAIL_BODY_ELEMENT_ID,
  GENERATED_STAMP_ELEMENT_ID,
  HIDDEN_WORK_NOTE_ELEMENT_ID,
  KANBAN_BOARD_ELEMENT_ID,
  KANBAN_TAB_NAME,
  LOG_ENTRIES_ELEMENT_ID,
  LOG_NOTE_ELEMENT_ID,
  RANGE_NOTE_ELEMENT_ID,
  SUMMARY_ELEMENT_ID,
  TASK_ROWS_ELEMENT_ID,
  TICKET_CARDS_ELEMENT_ID,
  TICKET_COUNT_ELEMENT_ID,
  TICKET_ROWS_ELEMENT_ID,
} from './constants/TemplateIds.ts';
import { createDetailDialogController }                       from './detail-dialog/DetailDialogController.ts';
import { createKanbanController }                             from './kanban/KanbanController.ts';
import { KanbanLaneUtil }                                     from './kanban/utils/KanbanLaneUtil.ts';
import { createLogController }                                from './log/LogController.ts';
import { createReloadSnapshotStore, createViewerPreferences } from './preferences/ViewerPreferences.ts';
import { ViewerPreferenceUtil }                               from './preferences/utils/ViewerPreferenceUtil.ts';
import { createGanttChartController }                         from './progress/GanttChartController.ts';
import { createReloadSnapshotController }                     from './reload/ReloadSnapshotController.ts';
import { createTicketsController }                            from './tickets/TicketsController.ts';
import { DomUtil }                                            from './utils/DomUtil.ts';
import { IslandUtil }                                         from './utils/IslandUtil.ts';
import { TimeUtil }                                           from './utils/TimeUtil.ts';
import { VisibilityUtil }                                     from './utils/VisibilityUtil.ts';

const PROGRESS_ISLAND_ELEMENT_ID = 'ap-progress-data';
const TICKETS_ISLAND_ELEMENT_ID  = 'ap-tickets-data';
const PROJECT_NAME_ELEMENT_ID    = 'ap-project';

const TAB_NAMES = ['progress', KANBAN_TAB_NAME, 'tickets'];

const OWNED_MARKUP_CONTAINER_IDS = [
  SUMMARY_ELEMENT_ID,
  AXIS_TICKS_ELEMENT_ID,
  CHART_OVERLAY_ELEMENT_ID,
  TASK_ROWS_ELEMENT_ID,
  LOG_ENTRIES_ELEMENT_ID,
  TICKET_ROWS_ELEMENT_ID,
  TICKET_CARDS_ELEMENT_ID,
  DETAIL_BODY_ELEMENT_ID,
  KANBAN_BOARD_ELEMENT_ID,
];
const OWNED_TEXT_CONTAINER_IDS = [
  PROJECT_NAME_ELEMENT_ID,
  GENERATED_STAMP_ELEMENT_ID,
  RANGE_NOTE_ELEMENT_ID,
  TICKET_COUNT_ELEMENT_ID,
  HIDDEN_WORK_NOTE_ELEMENT_ID,
  LOG_NOTE_ELEMENT_ID,
];

function showLayoutFailure(message: string): void {
  const banner = document.getElementById('ap-error');
  const text   = document.getElementById('ap-error-text');
  if (text !== null) {
    text.textContent = message;
  }
  if (banner !== null) {
    banner.hidden = false;
  }
}

function islandContentsOf(elementId: string): unknown {
  const island = document.getElementById(elementId);
  if (island === null) {
    return null;
  }
  try {
    return JSON.parse(island.textContent ?? '') as unknown;
  } catch {
    return null;
  }
}

function applyFragment(fragment: string): void {
  const target = fragment.replace(/^#/, '');
  if (target === '') {
    return;
  }
  const behaviour = DomUtil.templateBehaviour();
  if (TAB_NAMES.includes(target)) {
    behaviour?.selectTab(target);
    return;
  }
  const element = document.getElementById(target);
  if (element === null) {
    return;
  }
  const panel = element.closest('[data-panel]');
  if (panel instanceof HTMLElement) {
    behaviour?.selectTab(panel.dataset['panel'] ?? 'progress');
  }
  for (const disclosure of [element.closest('details'), element.querySelector('details')]) {
    if (disclosure instanceof HTMLDetailsElement) {
      disclosure.open = true;
    }
  }
  element.scrollIntoView();
}

function clearPlaceholderContent(): void {
  for (const elementId of OWNED_MARKUP_CONTAINER_IDS) {
    DomUtil.setMarkup(elementId, '');
  }
  for (const elementId of OWNED_TEXT_CONTAINER_IDS) {
    DomUtil.setText(elementId, '');
  }
}

function waitingOnByTicketIdOf(tickets: readonly BoardTicket[]): Map<string, readonly string[]> {
  return new Map(tickets.flatMap((ticket) => (ticket.waitingOn.length === 0 ? [] : [[ticket.id, ticket.waitingOn] as const])));
}

function renderPage(payload: PagePayload, tickets: PageTicket[]): void {
  const { progress, limits } = payload;
  const board                = IslandUtil.pageBoardFrom(progress.tasks, payload.boardFacts, tickets);
  const waitingOnById        = waitingOnByTicketIdOf(board.tickets);
  const preferences          = createViewerPreferences(progress.trackerId, () => window.localStorage);
  const progressController   = createGanttChartController({
    payload,
    rows: board.rows,
    waitingOnById,
    preferences,
  });

  if (payload.pageScriptFailure !== null) {
    showLayoutFailure(payload.pageScriptFailure);
  }

  DomUtil.setText(PROJECT_NAME_ELEMENT_ID, progress.project);
  progressController.showSummary();

  const logController = createLogController({
    entries:               progress.log,
    slices:                limits,
    preferences,
    readTodayCalendarDate: () => todayCalendarDate,
  });
  // Set from the visibility filter's now before anything prints a stamp; the page reloads every few minutes when idle, so the day is rarely stale.
  let todayCalendarDate = '';

  // Applied before the first layout, which measures the pinned columns this width sets.
  progressController.applyNameColumnWidth();

  let visibility         = preferences.readWorkVisibility();
  const kanbanController = createKanbanController({
    slices:                limits,
    preferences,
    readTodayCalendarDate: () => todayCalendarDate,
    readShowsAllWork:      () => visibility === 'all',
  });
  const ticketsController      = createTicketsController({ allTickets: board.tickets, waitingOnById, slices: limits });
  const detailDialogController = createDetailDialogController({
    rows:                  board.rows,
    tickets:               board.tickets,
    log:                   progress.log,
    limits,
    readTodayCalendarDate: () => todayCalendarDate,
    readKanbanCards:       () => kanbanController.readVisibleCards(),
  });

  const showVisibleWork = (): void => {
    const nowEpochMilliseconds = Date.now();
    const showsAll             = visibility === 'all';
    const windowMilliseconds   = limits.doneWorkVisibleMilliseconds;
    const visibleRows          = board.rows.filter((row) => showsAll || !VisibilityUtil.taskIsLongDone(row, nowEpochMilliseconds, windowMilliseconds));
    const visibleTickets       = board.tickets.filter((ticket) => showsAll || !VisibilityUtil.ticketIsLongDone(ticket, nowEpochMilliseconds, windowMilliseconds));
    progressController.setVisibleRows(visibleRows);
    todayCalendarDate = TimeUtil.calendarDateOf(nowEpochMilliseconds);

    progressController.showGeneratedStamp(todayCalendarDate);
    logController.show();
    ticketsController.show(visibleTickets, todayCalendarDate);
    kanbanController.showCards(KanbanLaneUtil.kanbanCardsFor(visibleTickets, waitingOnById));

    progressController.showHiddenNote(board.rows.length - visibleRows.length, board.tickets.length - visibleTickets.length);
    DomUtil.reflectSegment('ap-visibility', 'visibility', visibility);
  };

  detailDialogController.wire();
  progressController.wireRangeBar();

  document.getElementById('ap-visibility')?.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('[data-visibility]') : null;
    if (!(button instanceof HTMLElement)) {
      return;
    }
    visibility = ViewerPreferenceUtil.workVisibilityFrom(button.dataset['visibility']);
    preferences.writeWorkVisibility(visibility);
    showVisibleWork();
    progressController.layOut(true);
  });

  logController.wire();
  progressController.wireNameColumn();
  kanbanController.wire();

  window.addEventListener('resize', () => {
    progressController.layOut(false);
    kanbanController.updateOverflow();
  });
  window.addEventListener('hashchange', () => {
    applyFragment(window.location.hash);
    kanbanController.updateOverflow();
  });

  const reloadSnapshotController = createReloadSnapshotController({
    trackerId:        progress.trackerId,
    store:            createReloadSnapshotStore(progress.trackerId, () => window.sessionStorage),
    readDetailTarget: () => detailDialogController.readOpenTarget(),
    reopenDetail:     (target) => detailDialogController.reopen(target),
  });
  reloadSnapshotController.keepPlaceOnReload();

  showVisibleWork();
  progressController.layOut(true);
  applyFragment(window.location.hash);
  reloadSnapshotController.restorePlace();
  kanbanController.updateOverflow();
}

function startPage(): void {
  clearPlaceholderContent();
  const payload = IslandUtil.pagePayloadFrom(islandContentsOf(PROGRESS_ISLAND_ELEMENT_ID));
  if (payload === null) {
    showLayoutFailure('The progress data island is missing or could not be read, so the chart could not be built.');
    return;
  }
  renderPage(payload, IslandUtil.pageTicketsFrom(islandContentsOf(TICKETS_ISLAND_ELEMENT_ID)));
}

function startPageSafely(): void {
  try {
    startPage();
  } catch (failure) {
    showLayoutFailure(failure instanceof Error ? failure.message : String(failure));
  }
}

// The one deliberate exception to "no work at module load": a browser entry has no caller.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startPageSafely);
} else {
  startPageSafely();
}
