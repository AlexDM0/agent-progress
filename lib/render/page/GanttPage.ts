/**
 * The browser entry: it fills the containers of `lib/render/page/template.html` from the two JSON islands and does nothing else. Theme, tab
 * selection and ticket open state stay with the template's own bootstrap, reached through `window.agentProgressTemplate`.
 */

import type { ProgressFile, TicketStatus, ViewRange }       from '../../constants/Types.ts';
import type { Timeline }                                    from './GanttGeometry.ts';
import { computeTimeline }                                  from './GanttGeometry.ts';
import type { PagePayload, PageTicket, StoredViewOverride } from './PageData.ts';
import {
  EMPTY_VIEW_OVERRIDE,
  effectiveRangeFor,
  overrideIsEmpty,
  pagePayloadFrom,
  pageTicketsFrom,
  RANGE_PRESET_BOUNDS,
  storageKeyFor,
  storedOverrideFrom,
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

const OWNED_MARKUP_CONTAINER_IDS = ['ap-summary', 'ap-ticks', 'ap-overlay', 'ap-rows', 'ap-log', 'ap-ticket-rows', 'ap-ticket-cards'];
const OWNED_TEXT_CONTAINER_IDS   = ['ap-project', 'ap-generated', 'ap-range-note', 'ap-ticket-count', 'ap-hidden-note'];

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

function readStoredVisibility(trackerId: string): WorkVisibility {
  try {
    return workVisibilityFrom(window.localStorage.getItem(workVisibilityStorageKeyFor(trackerId)));
  } catch {
    return DEFAULT_WORK_VISIBILITY;
  }
}

function writeStoredVisibility(trackerId: string, visibility: WorkVisibility): void {
  try {
    if (visibility === DEFAULT_WORK_VISIBILITY) {
      window.localStorage.removeItem(workVisibilityStorageKeyFor(trackerId));
      return;
    }
    window.localStorage.setItem(workVisibilityStorageKeyFor(trackerId), visibility);
  } catch {
    // The page works without persistence.
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

function taskRowsFor(progress: ProgressFile, timeline: Timeline, ticketStatusById: Map<string, TicketStatus>): TaskRow[] {
  return progress.tasks.flatMap((task, index) => {
    const bar = timeline.bars[index];
    if (bar === undefined) {
      return [];
    }
    return [{
      task,
      ticketStatus: task.ticket === null ? null : ticketStatusById.get(task.ticket) ?? null,
      bar,
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
  let override               = readStoredOverride(progress.trackerId);

  if (payload.pageScriptFailure !== null) {
    showLayoutFailure(payload.pageScriptFailure);
  }

  setText('ap-project', progress.project);
  setText('ap-generated', `generated ${clockLabelFor(payload.generatedAtEpochMilliseconds)}`);
  setMarkup('ap-summary', summaryStatsMarkup(progress.tasks));

  setMarkup('ap-log', logItemsMarkup(progress.log, limits));
  setHidden('ap-log-empty', progress.log.length > 0);

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

    setMarkup('ap-ticket-rows', ticketTableRowsMarkup(visibleTickets));
    setMarkup('ap-ticket-cards', ticketCardsMarkup(visibleTickets, limits));
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
    setMarkup('ap-rows', taskRowsMarkup(taskRowsFor(visibleProgress, timeline, ticketStatusById)));
    setHidden('ap-chart-empty', visibleProgress.tasks.length > 0);

    setText('ap-range-note', rangeNoteText(timeline.fromEpochMilliseconds, timeline.toEpochMilliseconds, timeline.stepMinutes, limits));
    reflectRangeBar(override);

    if (bringNowIntoView && chart !== null && timeline.nowPercent !== null) {
      scrollNowIntoView(chart, timeline.nowPercent, axisWidthPixels, pinnedWidth);
    }
  };

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
