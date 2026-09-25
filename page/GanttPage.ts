/**
 * The browser entry: it fills the containers of `resources/template.html` from the two JSON islands and does nothing else. Theme, tab
 * selection and ticket open state stay with the template's own bootstrap, reached through `window.agentProgressTemplate`.
 */

import type { ProgressFile, ViewRange }             from '../src/lib/tracker-model/@types/ProgressFile.ts';
import type { Task }                                from '../src/lib/tracker-model/@types/Task.ts';
import type { TicketStatus }                        from '../src/lib/tracker-model/@types/Ticket.ts';
import type { PageLimits, PagePayload, PageTicket } from '../src/shared/@types/PagePayload.ts';
import type { KanbanCard }                          from './@types/KanbanCard.ts';
import { taskDetailMarkup }                         from './TaskDetail.ts';
import { ticketDetailMarkup }                       from './TicketDetail.ts';
import type { ClosedKanbanLane }                    from './constants/KanbanLane.ts';
import { CAPPED_LANE_FIRST_PAGE }                   from './constants/KanbanLane.ts';
import { KANBAN_BOARD_ELEMENT_ID, KANBAN_TAB_NAME } from './constants/TemplateIds.ts';
import { cardsInLane, kanbanCardsFor }              from './kanban/KanbanLanes.ts';
import { kanbanBoardMarkup }                        from './kanban/KanbanMarkup.ts';
import { KanbanOverflowUtil }                       from './kanban/utils/KanbanOverflowUtil.ts';
import { LanePagingUtil }                           from './kanban/utils/LanePagingUtil.ts';
import {
  logControlIsNeeded,
  logControlText,
  logEntryLimitFor,
  logNoteText,
} from './log/LogCap.ts';
import type {
  LogVisibility,
  NameColumnWidth,
  StoredViewOverride,
  ViewerPreferences,
} from './preferences/ViewerPreferences.ts';
import {
  createViewerPreferences,
  toggledLogVisibility,
  toggledNameColumnWidth,
  workVisibilityFrom,
} from './preferences/ViewerPreferences.ts';
import type { PlacedTick, TaskRow } from './progress/ProgressMarkup.ts';
import {
  axisPixelsNeededFor,
  generatedStampText,
  hiddenWorkNoteText,
  labelSitsLeftOfItsLine,
  overlayMarkup,
  rangeNoteText,
  summaryStatsMarkup,
  taskRowsMarkup,
  tickLayerMarkup,
} from './progress/ProgressMarkup.ts';
import {
  AUTOMATIC_RANGE_PRESET,
  AUTOMATIC_TICK_CHOICE,
  NAME_COLUMN_WIDTH_ATTRIBUTE,
  RANGE_PRESET_BOUNDS,
} from './progress/constants/ProgressChart.ts';
import { ViewRangeUtil }                                             from './progress/utils/ViewRangeUtil.ts';
import { ticketCardsMarkup, ticketCountText, ticketTableRowsMarkup } from './tickets/TicketsMarkup.ts';
import type { Timeline }                                             from './utils/GeometryUtil.ts';
import { GeometryUtil }                                              from './utils/GeometryUtil.ts';
import { IslandUtil }                                                from './utils/IslandUtil.ts';
import { LogMarkupUtil }                                             from './utils/LogMarkupUtil.ts';
import type { ShortenedText }                                        from './utils/MarkupUtil.ts';
import { TimeUtil }                                                  from './utils/TimeUtil.ts';
import { VisibilityUtil }                                            from './utils/VisibilityUtil.ts';
import { WaitingOnUtil }                                             from './utils/WaitingOnUtil.ts';

const PROGRESS_ISLAND_ELEMENT_ID = 'ap-progress-data';
const TICKETS_ISLAND_ELEMENT_ID  = 'ap-tickets-data';

const DETAIL_DIALOG_ELEMENT_ID = 'ap-detail';
const DETAIL_BODY_ELEMENT_ID   = 'ap-detail-body';
const DETAIL_CLOSE_ELEMENT_ID  = 'ap-detail-close';

const KANBAN_FRAME_ELEMENT_ID = 'ap-kanban-frame';

const TAB_NAMES = ['progress', KANBAN_TAB_NAME, 'tickets'];

const OWNED_MARKUP_CONTAINER_IDS = ['ap-summary', 'ap-ticks', 'ap-overlay', 'ap-rows', 'ap-log', 'ap-ticket-rows', 'ap-ticket-cards', 'ap-detail-body', KANBAN_BOARD_ELEMENT_ID];
const OWNED_TEXT_CONTAINER_IDS   = ['ap-project', 'ap-generated', 'ap-range-note', 'ap-ticket-count', 'ap-hidden-note', 'ap-log-note'];

interface TemplateBehaviour {
  selectTab:              (name: string) => void;
  restoreTicketOpenState: () => void;
}

function templateBehaviour(): TemplateBehaviour | null {
  const candidate = (window as unknown as Record<string, unknown>)['agentProgressTemplate'];
  if (typeof candidate !== 'object' || candidate === null) {
    return null;
  }
  const behaviour = candidate as Partial<TemplateBehaviour>;
  if (typeof behaviour.selectTab !== 'function' || typeof behaviour.restoreTicketOpenState !== 'function') {
    return null;
  }
  return { selectTab: behaviour.selectTab, restoreTicketOpenState: behaviour.restoreTicketOpenState };
}

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

function setText(elementId: string, text: string): void {
  const element = document.getElementById(elementId);
  if (element !== null) {
    element.textContent = text;
  }
}

function setShortenedText(elementId: string, shortened: ShortenedText): void {
  setText(elementId, shortened.text);
  const element = document.getElementById(elementId);
  if (element === null) {
    return;
  }
  if (shortened.title === null) {
    element.removeAttribute('title');
  } else {
    element.setAttribute('title', shortened.title);
  }
}

/** `innerHTML` is safe here because the markup modules escaped every value once and ticket bodies arrive sanitised. */
function setMarkup(elementId: string, markup: string): void {
  const element = document.getElementById(elementId);
  if (element !== null) {
    element.innerHTML = markup;
  }
}

function setHidden(elementId: string, hidden: boolean): void {
  const element = document.getElementById(elementId);
  if (element !== null) {
    element.hidden = hidden;
  }
}

function applyNameColumnWidth(width: NameColumnWidth): void {
  document.documentElement.setAttribute(NAME_COLUMN_WIDTH_ATTRIBUTE, width);
  const control = document.getElementById('ap-name-column');
  if (control !== null) {
    control.setAttribute('aria-pressed', String(width === 'wide'));
  }
}

function showLog(entries: PagePayload['progress']['log'], limits: PageLimits, todayCalendarDate: string, visibility: LogVisibility): void {
  const controlIsNeeded = logControlIsNeeded(entries.length);
  setMarkup('ap-log', LogMarkupUtil.logItemsMarkup(entries, limits, todayCalendarDate, controlIsNeeded ? logEntryLimitFor(visibility) : null));
  setHidden('ap-log-empty', entries.length > 0);
  setText('ap-log-note', logNoteText(entries.length, visibility));
  setHidden('ap-log-control', !controlIsNeeded);
  const control = document.getElementById('ap-log-toggle');
  if (control !== null) {
    control.textContent = logControlText(entries.length);
    control.setAttribute('aria-pressed', String(visibility === 'all'));
  }
}

function pinnedColumnsWidth(): number {
  const headerName = document.querySelector('.ap-chart-head > .ap-cell-name');
  const headerPill = document.querySelector('.ap-chart-head > .ap-cell-pill');
  return (headerName instanceof HTMLElement ? headerName.getBoundingClientRect().width : 0)
    + (headerPill instanceof HTMLElement ? headerPill.getBoundingClientRect().width : 0);
}

function scrollNowIntoView(chart: HTMLElement, nowPercent: number, axisWidthPixels: number, pinnedWidth: number): void {
  const visibleAxisWidth   = Math.max(1, chart.clientWidth - pinnedWidth);
  const markerAxisOffset   = axisWidthPixels * nowPercent / 100;
  const furthestScrollLeft = Math.max(0, chart.scrollWidth - chart.clientWidth);
  const desiredScrollLeft  = markerAxisOffset - visibleAxisWidth / 2;
  chart.scrollLeft = Math.max(0, Math.min(desiredScrollLeft, furthestScrollLeft));
}

function applyFragment(fragment: string): void {
  const target = fragment.replace(/^#/, '');
  if (target === '') {
    return;
  }
  const behaviour = templateBehaviour();
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

function taskRowsFor(
  progress: ProgressFile,
  timeline: Timeline,
  ticketStatusById: Map<string, TicketStatus>,
  waitingOnById: ReadonlyMap<string, readonly string[]>,
): TaskRow[] {
  return progress.tasks.flatMap((task, index) => {
    const bar = timeline.bars[index];
    if (bar === undefined) {
      return [];
    }
    return [{
      task,
      ticketStatus: task.ticket === null ? null : ticketStatusById.get(task.ticket) ?? null,
      bar,
      waitingOn:    task.ticket === null ? [] : waitingOnById.get(task.ticket) ?? [],
    }];
  });
}

function reflectSegment(containerId: string, attributeName: string, selectedValue: string): void {
  const container = document.getElementById(containerId);
  if (container === null) {
    return;
  }
  for (const button of container.querySelectorAll(`[data-${attributeName}]`)) {
    if (button instanceof HTMLElement) {
      button.setAttribute('aria-pressed', String(button.dataset[attributeName] === selectedValue));
    }
  }
}

function reflectRangeBar(override: StoredViewOverride): void {
  const boundsAreUnset = override.fromText === null && override.toText === null;
  reflectSegment('ap-range-presets', 'preset', override.presetKey ?? (boundsAreUnset ? AUTOMATIC_RANGE_PRESET : ''));
  reflectSegment('ap-range-ticks', 'tick', override.tickMinutes === null ? AUTOMATIC_TICK_CHOICE : String(override.tickMinutes));
  const fromInput = document.getElementById('ap-range-from');
  const toInput   = document.getElementById('ap-range-to');
  if (fromInput instanceof HTMLInputElement && document.activeElement !== fromInput) {
    fromInput.value = override.fromText ?? '';
  }
  if (toInput instanceof HTMLInputElement && document.activeElement !== toInput) {
    toInput.value = override.toText ?? '';
  }
}

function wireRangeBar(readOverride: () => StoredViewOverride, applyOverride: (next: StoredViewOverride) => void): void {
  document.getElementById('ap-range-presets')?.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('[data-preset]') : null;
    if (!(button instanceof HTMLElement)) {
      return;
    }
    const key = button.dataset['preset'] ?? AUTOMATIC_RANGE_PRESET;
    if (!Object.hasOwn(RANGE_PRESET_BOUNDS, key)) {
      return;
    }
    const bounds = RANGE_PRESET_BOUNDS[key] ?? { fromText: null, toText: null };
    applyOverride({
      presetKey:   key,
      fromText:    bounds.fromText,
      toText:      bounds.toText,
      tickMinutes: readOverride().tickMinutes,
    });
  });

  const readBound = (elementId: string): string | null => {
    const input = document.getElementById(elementId);
    const text  = input instanceof HTMLInputElement ? input.value.trim() : '';
    return text === '' ? null : text;
  };
  const applyTypedBounds = (): void => {
    applyOverride({
      presetKey:   null,
      fromText:    readBound('ap-range-from'),
      toText:      readBound('ap-range-to'),
      tickMinutes: readOverride().tickMinutes,
    });
  };
  for (const elementId of ['ap-range-from', 'ap-range-to']) {
    document.getElementById(elementId)?.addEventListener('change', applyTypedBounds);
  }

  document.getElementById('ap-range-ticks')?.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('[data-tick]') : null;
    if (!(button instanceof HTMLElement)) {
      return;
    }
    const choice  = button.dataset['tick'] ?? AUTOMATIC_TICK_CHOICE;
    const minutes = choice === AUTOMATIC_TICK_CHOICE ? Number.NaN : Number(choice);
    const current = readOverride();
    applyOverride({
      presetKey:   current.presetKey,
      fromText:    current.fromText,
      toText:      current.toText,
      tickMinutes: Number.isFinite(minutes) && minutes > 0 ? minutes : null,
    });
  });
}

/** A double-click inside a link belongs to the link: a row already carries its ticket badge and its "waiting on" links. */
function rowDoubleClicked(event: Event, selector: string): HTMLElement | null {
  if (!(event.target instanceof Element) || event.target.closest('a') !== null) {
    return null;
  }
  const row = event.target.closest(selector);
  return row instanceof HTMLElement ? row : null;
}

/** Enter counts only on the focused row itself, so Enter on a link inside it still follows the link. */
function rowActivatedByKey(event: KeyboardEvent, selector: string): HTMLElement | null {
  if (event.key !== 'Enter' || !(event.target instanceof HTMLElement) || !event.target.matches(selector)) {
    return null;
  }
  return event.target;
}

function wireRowOverview(containerId: string, rowSelector: string, showRowDetail: (row: HTMLElement) => void): void {
  const container = document.getElementById(containerId);
  container?.addEventListener('dblclick', (event) => {
    const row = rowDoubleClicked(event, rowSelector);
    if (row !== null) {
      showRowDetail(row);
    }
  });
  container?.addEventListener('keydown', (event) => {
    const row = rowActivatedByKey(event, rowSelector);
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

interface DetailSources {
  progress:              ProgressFile;
  tickets:               readonly PageTicket[];
  limits:                PageLimits;
  readTodayCalendarDate: () => string;
  readKanbanCards:       () => readonly KanbanCard[];
}

function wireTaskDetail(sources: DetailSources): void {
  const {
    progress,
    tickets,
    limits,
    readTodayCalendarDate,
  } = sources;
  const dialog = document.getElementById(DETAIL_DIALOG_ELEMENT_ID);
  if (!(dialog instanceof HTMLDialogElement)) {
    return;
  }
  const ticketById = new Map(tickets.map((ticket) => [ticket.id, ticket]));

  const showDetail = (task: Task | null, ticket: PageTicket | null): void => {
    const markup = taskDetailMarkup({
      task,
      ticket,
      log:               progress.log,
      slices:            limits,
      todayCalendarDate: readTodayCalendarDate(),
    });
    if (markup === '') {
      return;
    }
    setMarkup(DETAIL_BODY_ELEMENT_ID, markup);
    dialog.showModal();
  };

  const showTaskRowDetail = (row: HTMLElement): void => {
    const task = progress.tasks.find((candidate) => String(candidate.id) === row.dataset['taskId']);
    if (task !== undefined) {
      showDetail(task, task.ticket === null ? null : ticketById.get(task.ticket) ?? null);
    }
  };
  const showTicketRowDetail = (row: HTMLElement): void => {
    const ticketId = row.dataset['ticketId'] ?? '';
    showDetail(progress.tasks.find((candidate) => candidate.ticket === ticketId) ?? null, ticketById.get(ticketId) ?? null);
  };

  const showKanbanCardDetail = (cardElement: HTMLElement): void => {
    const card = sources.readKanbanCards().find((candidate) => candidate.ticket.id === cardElement.dataset['ticketId']);
    if (card === undefined) {
      return;
    }
    setMarkup(DETAIL_BODY_ELEMENT_ID, ticketDetailMarkup({
      card,
      tasks:                progress.tasks,
      nowEpochMilliseconds: Date.now(),
      todayCalendarDate:    readTodayCalendarDate(),
      limits,
    }));
    dialog.showModal();
    markCoveredTickLabels();
  };

  wireRowOverview('ap-rows', '.ap-row', showTaskRowDetail);
  wireRowOverview('ap-ticket-rows', '[data-ticket-id]', showTicketRowDetail);
  wireRowOverview(KANBAN_BOARD_ELEMENT_ID, '.ap-kanban-card', showKanbanCardDetail);
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
}

function updateKanbanOverflow(): void {
  const board = document.getElementById(KANBAN_BOARD_ELEMENT_ID);
  const frame = document.getElementById(KANBAN_FRAME_ELEMENT_ID);
  if (board === null || frame === null) {
    return;
  }
  const directions = KanbanOverflowUtil.overflowDirectionsOf(board.scrollLeft, board.scrollWidth, board.clientWidth);
  if (directions === null) {
    frame.removeAttribute('data-overflow');
  } else {
    frame.setAttribute('data-overflow', directions);
  }
}

function closedLaneNamedBy(value: string | undefined): ClosedKanbanLane | null {
  return value === 'done' || value === 'abandoned' ? value : null;
}

interface KanbanControls {
  preferences:         ViewerPreferences;
  readVisibleCards:    () => readonly KanbanCard[];
  toggleAbandonedLane: (laneIsOpen?: boolean) => void;
  showKanban:          () => void;
}

/** Shows the Kanban tab and brings the dependency's card into view with focus; a card the board does not hold is left alone. */
function followKanbanLink(ticketId: string, controls: KanbanControls): void {
  templateBehaviour()?.selectTab(KANBAN_TAB_NAME);
  const cardId = `ap-kanban-${ticketId}`;
  if ((document.getElementById(cardId)?.closest('[data-collapsed]') ?? null) !== null) {
    controls.toggleAbandonedLane(true);
  }
  updateKanbanOverflow();
  const card = document.getElementById(cardId);
  if (card !== null) {
    card.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    card.focus();
  }
}

function wireKanban(controls: KanbanControls): void {
  const board = document.getElementById(KANBAN_BOARD_ELEMENT_ID);
  board?.addEventListener('scroll', updateKanbanOverflow, { passive: true });
  // The template's own tab listener was added first, so the panel is already shown when this measures it.
  document.getElementById('ap-tabs')?.addEventListener('click', updateKanbanOverflow);
  board?.addEventListener('click', (event) => {
    const control = event.target instanceof Element ? event.target.closest('[data-lane-more], [data-lane-reset], .ap-lane-toggle, [data-ticket-link]') : null;
    if (!(control instanceof HTMLElement)) {
      return;
    }
    const linkedTicketId = control.dataset['ticketLink'];
    if (linkedTicketId !== undefined) {
      event.preventDefault();
      followKanbanLink(linkedTicketId, controls);
      return;
    }
    if (control.classList.contains('ap-lane-toggle')) {
      controls.toggleAbandonedLane();
      document.querySelector<HTMLElement>(`#${KANBAN_BOARD_ELEMENT_ID} .ap-lane-toggle`)?.focus();
      return;
    }
    const moreLane = closedLaneNamedBy(control.dataset['laneMore']);
    const lane     = moreLane ?? closedLaneNamedBy(control.dataset['laneReset']);
    if (lane === null) {
      return;
    }
    const laneCount    = cardsInLane(controls.readVisibleCards(), lane).length;
    const currentCount = LanePagingUtil.cappedLaneShownCount(controls.preferences.readCappedLaneShownCount(lane), laneCount);
    controls.preferences.writeCappedLaneShownCount(lane, moreLane === null ? CAPPED_LANE_FIRST_PAGE : LanePagingUtil.shownCountAfterMore(currentCount, laneCount));
    controls.showKanban();
  });
}

function clearPlaceholderContent(): void {
  for (const elementId of OWNED_MARKUP_CONTAINER_IDS) {
    setMarkup(elementId, '');
  }
  for (const elementId of OWNED_TEXT_CONTAINER_IDS) {
    setText(elementId, '');
  }
}

function renderPage(payload: PagePayload, tickets: PageTicket[]): void {
  const { progress, limits } = payload;
  const ticketStatusById     = new Map(tickets.map((ticket) => [ticket.id, ticket.status]));
  const waitingOnById        = WaitingOnUtil.waitingOnByTicketId(tickets);
  const preferences          = createViewerPreferences(progress.trackerId, () => window.localStorage);
  let override               = preferences.readRangeOverride();

  if (payload.pageScriptFailure !== null) {
    showLayoutFailure(payload.pageScriptFailure);
  }

  setText('ap-project', progress.project);
  setMarkup('ap-summary', summaryStatsMarkup(progress.tasks, payload.concurrency));

  let logVisibility = preferences.readLogVisibility();
  // Set from the visibility filter's now before anything prints a stamp; the page reloads every few minutes, so the day is never stale for long.
  let todayCalendarDate = '';

  // Applied before the first layout, which measures the pinned columns this width sets.
  let nameColumnWidth = preferences.readNameColumnWidth();
  applyNameColumnWidth(nameColumnWidth);

  const chart         = document.getElementById('ap-chart');
  let visibility      = preferences.readWorkVisibility();
  let visibleProgress = progress;

  let visibleKanbanCards: KanbanCard[] = [];
  let abandonedLaneIsOpen              = preferences.readAbandonedLaneIsOpen();
  const showKanban                     = (): void => {
    setMarkup(KANBAN_BOARD_ELEMENT_ID, kanbanBoardMarkup({
      cards:                  visibleKanbanCards,
      tasks:                  progress.tasks,
      nowEpochMilliseconds:   Date.now(),
      todayCalendarDate,
      slices:                 limits,
      showsAllWork:           visibility === 'all',
      shownCountByClosedLane: { done: preferences.readCappedLaneShownCount('done'), abandoned: preferences.readCappedLaneShownCount('abandoned') },
      abandonedLaneIsOpen,
    }));
    updateKanbanOverflow();
  };
  const toggleAbandonedLane = (laneIsOpen = !abandonedLaneIsOpen): void => {
    abandonedLaneIsOpen = laneIsOpen;
    preferences.writeAbandonedLaneIsOpen(laneIsOpen);
    showKanban();
  };

  const showVisibleWork = (): void => {
    const nowEpochMilliseconds = Date.now();
    const showsAll             = visibility === 'all';
    const windowMilliseconds   = limits.doneWorkVisibleMilliseconds;
    const visibleTasks         = progress.tasks.filter((task) => showsAll || !VisibilityUtil.taskIsLongDone(task, nowEpochMilliseconds, windowMilliseconds));
    const visibleTickets       = tickets.filter((ticket) => showsAll || !VisibilityUtil.ticketIsLongDone(ticket, nowEpochMilliseconds, windowMilliseconds));
    visibleProgress = { ...progress, tasks: visibleTasks };
    todayCalendarDate = TimeUtil.calendarDateOf(nowEpochMilliseconds);

    setShortenedText('ap-generated', generatedStampText(payload.generatedAtEpochMilliseconds, todayCalendarDate));
    showLog(progress.log, limits, todayCalendarDate, logVisibility);
    setMarkup('ap-ticket-rows', ticketTableRowsMarkup(visibleTickets, waitingOnById));
    setMarkup('ap-ticket-cards', ticketCardsMarkup(visibleTickets, waitingOnById, limits, todayCalendarDate));
    setText('ap-ticket-count', ticketCountText(tickets));
    templateBehaviour()?.restoreTicketOpenState();
    visibleKanbanCards = kanbanCardsFor(visibleTickets, progress.tasks, waitingOnById);
    showKanban();

    setText('ap-hidden-note', hiddenWorkNoteText(progress.tasks.length - visibleTasks.length, tickets.length - visibleTickets.length));
    reflectSegment('ap-visibility', 'visibility', visibility);
  };

  const layOut = (bringNowIntoView: boolean): void => {
    const nowEpochMilliseconds = Date.now();
    const range: ViewRange     = ViewRangeUtil.effectiveRangeFor(visibleProgress, override, nowEpochMilliseconds, limits);
    const timeline             = GeometryUtil.computeTimeline({
      progress: visibleProgress,
      range,
      nowEpochMilliseconds,
      limits,
    });

    const pinnedWidth     = pinnedColumnsWidth();
    const availablePixels = chart === null ? 0 : Math.max(0, chart.clientWidth - pinnedWidth);
    const neededPixels    = axisPixelsNeededFor(timeline.ticks);
    const axisScrolls     = neededPixels > availablePixels;
    const axisWidthPixels = axisScrolls ? neededPixels : availablePixels;
    // Written first: every bar, tick, grid line and the marker is a percentage of this column.
    chart?.style.setProperty('--timeline-w', axisScrolls ? `${Math.round(neededPixels)}px` : '1fr');

    const placedTicks: PlacedTick[] = timeline.ticks.map((tick) => ({
      ...tick,
      labelSitsLeftOfItsLine: labelSitsLeftOfItsLine(tick, axisWidthPixels),
    }));
    setMarkup('ap-ticks', tickLayerMarkup(placedTicks));
    setMarkup('ap-overlay', overlayMarkup(timeline.ticks, timeline.nowPercent));
    setMarkup('ap-rows', taskRowsMarkup(taskRowsFor(visibleProgress, timeline, ticketStatusById, waitingOnById), limits));
    setHidden('ap-chart-empty', visibleProgress.tasks.length > 0);

    const rangeNote = rangeNoteText(timeline.fromEpochMilliseconds, timeline.toEpochMilliseconds, timeline.stepMinutes, TimeUtil.calendarDateOf(nowEpochMilliseconds), limits);
    setShortenedText('ap-range-note', rangeNote);
    reflectRangeBar(override);

    if (bringNowIntoView && chart !== null && timeline.nowPercent !== null) {
      scrollNowIntoView(chart, timeline.nowPercent, axisWidthPixels, pinnedWidth);
    }
  };

  wireTaskDetail({
    progress,
    tickets,
    limits,
    readTodayCalendarDate: () => todayCalendarDate,
    readKanbanCards:       () => visibleKanbanCards,
  });

  wireRangeBar(() => override, (next) => {
    override = next;
    preferences.writeRangeOverride(next);
    layOut(true);
  });

  document.getElementById('ap-visibility')?.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('[data-visibility]') : null;
    if (!(button instanceof HTMLElement)) {
      return;
    }
    visibility = workVisibilityFrom(button.dataset['visibility']);
    preferences.writeWorkVisibility(visibility);
    showVisibleWork();
    layOut(true);
  });

  document.getElementById('ap-log-toggle')?.addEventListener('click', () => {
    logVisibility = toggledLogVisibility(logVisibility);
    preferences.writeLogVisibility(logVisibility);
    showLog(progress.log, limits, todayCalendarDate, logVisibility);
  });

  document.getElementById('ap-name-column')?.addEventListener('click', () => {
    nameColumnWidth = toggledNameColumnWidth(nameColumnWidth);
    preferences.writeNameColumnWidth(nameColumnWidth);
    applyNameColumnWidth(nameColumnWidth);
    layOut(false);
  });

  wireKanban({
    preferences,
    readVisibleCards: () => visibleKanbanCards,
    toggleAbandonedLane,
    showKanban,
  });

  window.addEventListener('resize', () => {
    layOut(false);
    updateKanbanOverflow();
  });
  window.addEventListener('hashchange', () => {
    applyFragment(window.location.hash);
    updateKanbanOverflow();
  });

  showVisibleWork();
  layOut(true);
  applyFragment(window.location.hash);
  updateKanbanOverflow();
}

function startGanttPage(): void {
  clearPlaceholderContent();
  const payload = IslandUtil.pagePayloadFrom(islandContentsOf(PROGRESS_ISLAND_ELEMENT_ID));
  if (payload === null) {
    showLayoutFailure('The progress data island is missing or could not be read, so the chart could not be built.');
    return;
  }
  renderPage(payload, IslandUtil.pageTicketsFrom(islandContentsOf(TICKETS_ISLAND_ELEMENT_ID)));
}

function startGanttPageSafely(): void {
  try {
    startGanttPage();
  } catch (failure) {
    showLayoutFailure(failure instanceof Error ? failure.message : String(failure));
  }
}

// The one deliberate exception to "no work at module load": a browser entry has no caller.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startGanttPageSafely);
} else {
  startGanttPageSafely();
}
