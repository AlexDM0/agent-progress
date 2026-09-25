/**
 * The browser entry: it fills the containers of `lib/render/page/template.html` from the two JSON islands and does nothing else. Theme, tab
 * selection and ticket open state stay with the template's own bootstrap, reached through `window.agentProgressTemplate`.
 */

import type {
  ProgressFile,
  Task,
  TicketStatus,
  ViewRange,
} from '../../constants/Types.ts';
import type { Timeline }      from './GanttGeometry.ts';
import { computeTimeline }    from './GanttGeometry.ts';
import type { LogVisibility } from './LogVisibility.ts';
import {
  DEFAULT_LOG_VISIBILITY,
  logControlIsNeeded,
  logControlText,
  logEntryLimitFor,
  logNoteText,
  logVisibilityFrom,
  logVisibilityStorageKeyFor,
  toggledLogVisibility,
} from './LogVisibility.ts';
import type { NameColumnWidth } from './NameColumnWidth.ts';
import {
  DEFAULT_NAME_COLUMN_WIDTH,
  NAME_COLUMN_WIDTH_ATTRIBUTE,
  nameColumnWidthFrom,
  nameColumnWidthStorageKeyFor,
  toggledNameColumnWidth,
} from './NameColumnWidth.ts';
import type {
  PageLimits,
  PagePayload,
  PageTicket,
  StoredViewOverride,
} from './PageData.ts';
import {
  EMPTY_VIEW_OVERRIDE,
  effectiveRangeFor,
  overrideIsEmpty,
  pagePayloadFrom,
  pageTicketsFrom,
  RANGE_PRESET_BOUNDS,
  storageKeyFor,
  storedOverrideFrom,
  waitingOnByTicketId,
} from './PageData.ts';
import type { PlacedTick, TaskRow } from './PageMarkup.ts';
import {
  axisPixelsNeededFor,
  clockLabelFor,
  labelSitsLeftOfItsLine,
  logItemsMarkup,
  overlayMarkup,
  rangeNoteText,
  summaryStatsMarkup,
  taskRowsMarkup,
  ticketCardsMarkup,
  ticketCountText,
  ticketTableRowsMarkup,
  tickLayerMarkup,
} from './PageMarkup.ts';
import { taskDetailMarkup }      from './TaskDetail.ts';
import type { WorkVisibility }   from './WorkVisibility.ts';
import {
  DEFAULT_WORK_VISIBILITY,
  hiddenWorkNoteText,
  taskIsLongDone,
  ticketIsLongDone,
  workVisibilityFrom,
  workVisibilityStorageKeyFor,
} from './WorkVisibility.ts';

const PROGRESS_ISLAND_ELEMENT_ID = 'ap-progress-data';
const TICKETS_ISLAND_ELEMENT_ID  = 'ap-tickets-data';
const AUTOMATIC_TICK_CHOICE      = 'auto';
const AUTOMATIC_RANGE_PRESET     = 'auto';

const DETAIL_DIALOG_ELEMENT_ID = 'ap-detail';
const DETAIL_BODY_ELEMENT_ID   = 'ap-detail-body';
const DETAIL_CLOSE_ELEMENT_ID  = 'ap-detail-close';

const OWNED_MARKUP_CONTAINER_IDS = ['ap-summary', 'ap-ticks', 'ap-overlay', 'ap-rows', 'ap-log', 'ap-ticket-rows', 'ap-ticket-cards', 'ap-detail-body'];
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

/** `innerHTML` is safe here because `lib/render/page/PageMarkup.ts` escaped every value once and ticket bodies arrive sanitised. */
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

function readStoredOverride(trackerId: string): StoredViewOverride {
  try {
    const stored = window.localStorage.getItem(storageKeyFor(trackerId));
    return stored === null ? EMPTY_VIEW_OVERRIDE : storedOverrideFrom(JSON.parse(stored));
  } catch {
    return EMPTY_VIEW_OVERRIDE;
  }
}

function writeStoredOverride(trackerId: string, override: StoredViewOverride): void {
  try {
    if (overrideIsEmpty(override)) {
      window.localStorage.removeItem(storageKeyFor(trackerId));
      return;
    }
    window.localStorage.setItem(storageKeyFor(trackerId), JSON.stringify(override));
  } catch {
    // The page works without persistence.
  }
}

function readStoredChoice(storageKey: string): string | null {
  try {
    return window.localStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

/** The key is removed at the default, so a viewer who never departs from it leaves nothing behind. */
function writeStoredChoice(storageKey: string, choice: string, defaultChoice: string): void {
  try {
    if (choice === defaultChoice) {
      window.localStorage.removeItem(storageKey);
      return;
    }
    window.localStorage.setItem(storageKey, choice);
  } catch {
    // The page works without persistence.
  }
}

function readStoredVisibility(trackerId: string): WorkVisibility {
  return workVisibilityFrom(readStoredChoice(workVisibilityStorageKeyFor(trackerId)));
}

function writeStoredVisibility(trackerId: string, visibility: WorkVisibility): void {
  writeStoredChoice(workVisibilityStorageKeyFor(trackerId), visibility, DEFAULT_WORK_VISIBILITY);
}

function applyNameColumnWidth(width: NameColumnWidth): void {
  document.documentElement.setAttribute(NAME_COLUMN_WIDTH_ATTRIBUTE, width);
  const control = document.getElementById('ap-name-column');
  if (control !== null) {
    control.setAttribute('aria-pressed', String(width === 'wide'));
  }
}

function showLog(entries: PagePayload['progress']['log'], limits: PageLimits, visibility: LogVisibility): void {
  const controlIsNeeded = logControlIsNeeded(entries.length);
  setMarkup('ap-log', logItemsMarkup(entries, limits, controlIsNeeded ? logEntryLimitFor(visibility) : null));
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
  if (target === 'progress' || target === 'tickets') {
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

function wireTaskDetail(progress: ProgressFile, tickets: readonly PageTicket[], limits: PageLimits): void {
  const dialog = document.getElementById(DETAIL_DIALOG_ELEMENT_ID);
  if (!(dialog instanceof HTMLDialogElement)) {
    return;
  }
  const ticketById = new Map(tickets.map((ticket) => [ticket.id, ticket]));

  const showDetail = (task: Task | null, ticket: PageTicket | null): void => {
    const markup = taskDetailMarkup({
      task,
      ticket,
      log:    progress.log,
      slices: limits,
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

  wireRowOverview('ap-rows', '.ap-row', showTaskRowDetail);
  wireRowOverview('ap-ticket-rows', '[data-ticket-id]', showTicketRowDetail);

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
  const waitingOnById        = waitingOnByTicketId(tickets);
  let override               = readStoredOverride(progress.trackerId);

  if (payload.pageScriptFailure !== null) {
    showLayoutFailure(payload.pageScriptFailure);
  }

  setText('ap-project', progress.project);
  setText('ap-generated', `generated ${clockLabelFor(payload.generatedAtEpochMilliseconds)}`);
  setMarkup('ap-summary', summaryStatsMarkup(progress.tasks, payload.concurrency));

  let logVisibility = logVisibilityFrom(readStoredChoice(logVisibilityStorageKeyFor(progress.trackerId)));
  showLog(progress.log, limits, logVisibility);

  // Applied before the first layout, which measures the pinned columns this width sets.
  let nameColumnWidth = nameColumnWidthFrom(readStoredChoice(nameColumnWidthStorageKeyFor(progress.trackerId)));
  applyNameColumnWidth(nameColumnWidth);

  const chart         = document.getElementById('ap-chart');
  let visibility      = readStoredVisibility(progress.trackerId);
  let visibleProgress = progress;

  const showVisibleWork = (): void => {
    const nowEpochMilliseconds = Date.now();
    const showsAll             = visibility === 'all';
    const windowMilliseconds   = limits.doneWorkVisibleMilliseconds;
    const visibleTasks         = progress.tasks.filter((task) => showsAll || !taskIsLongDone(task, nowEpochMilliseconds, windowMilliseconds));
    const visibleTickets       = tickets.filter((ticket) => showsAll || !ticketIsLongDone(ticket, nowEpochMilliseconds, windowMilliseconds));
    visibleProgress = { ...progress, tasks: visibleTasks };

    setMarkup('ap-ticket-rows', ticketTableRowsMarkup(visibleTickets, waitingOnById));
    setMarkup('ap-ticket-cards', ticketCardsMarkup(visibleTickets, waitingOnById, limits));
    setText('ap-ticket-count', ticketCountText(tickets));
    templateBehaviour()?.restoreTicketOpenState();

    setText('ap-hidden-note', hiddenWorkNoteText(progress.tasks.length - visibleTasks.length, tickets.length - visibleTickets.length));
    reflectSegment('ap-visibility', 'visibility', visibility);
  };

  const layOut = (bringNowIntoView: boolean): void => {
    const nowEpochMilliseconds = Date.now();
    const range: ViewRange     = effectiveRangeFor(visibleProgress, override, nowEpochMilliseconds, limits);
    const timeline             = computeTimeline({
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

    setText('ap-range-note', rangeNoteText(timeline.fromEpochMilliseconds, timeline.toEpochMilliseconds, timeline.stepMinutes, limits));
    reflectRangeBar(override);

    if (bringNowIntoView && chart !== null && timeline.nowPercent !== null) {
      scrollNowIntoView(chart, timeline.nowPercent, axisWidthPixels, pinnedWidth);
    }
  };

  wireTaskDetail(progress, tickets, limits);

  wireRangeBar(() => override, (next) => {
    override = next;
    writeStoredOverride(progress.trackerId, next);
    layOut(true);
  });

  document.getElementById('ap-visibility')?.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('[data-visibility]') : null;
    if (!(button instanceof HTMLElement)) {
      return;
    }
    visibility = workVisibilityFrom(button.dataset['visibility']);
    writeStoredVisibility(progress.trackerId, visibility);
    showVisibleWork();
    layOut(true);
  });

  document.getElementById('ap-log-toggle')?.addEventListener('click', () => {
    logVisibility = toggledLogVisibility(logVisibility);
    writeStoredChoice(logVisibilityStorageKeyFor(progress.trackerId), logVisibility, DEFAULT_LOG_VISIBILITY);
    showLog(progress.log, limits, logVisibility);
  });

  document.getElementById('ap-name-column')?.addEventListener('click', () => {
    nameColumnWidth = toggledNameColumnWidth(nameColumnWidth);
    writeStoredChoice(nameColumnWidthStorageKeyFor(progress.trackerId), nameColumnWidth, DEFAULT_NAME_COLUMN_WIDTH);
    applyNameColumnWidth(nameColumnWidth);
    layOut(false);
  });

  window.addEventListener('resize', () => {
    layOut(false);
  });
  window.addEventListener('hashchange', () => {
    applyFragment(window.location.hash);
  });

  showVisibleWork();
  layOut(true);
  applyFragment(window.location.hash);
}

function startGanttPage(): void {
  clearPlaceholderContent();
  const payload = pagePayloadFrom(islandContentsOf(PROGRESS_ISLAND_ELEMENT_ID));
  if (payload === null) {
    showLayoutFailure('The progress data island is missing or could not be read, so the chart could not be built.');
    return;
  }
  renderPage(payload, pageTicketsFrom(islandContentsOf(TICKETS_ISLAND_ELEMENT_ID)));
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
