/** The Progress tab: the chart's layout, the range bar with its Fit preset, and the name column. */

import type { ViewRange }                                              from '../../src/lib/tracker-model/@types/TrackerProgress.ts';
import type { PagePayload }                                            from '../../src/shared/@types/PagePayload.ts';
import type { BoardEpic, BoardRow, BoardTicket }                       from '../@types/PageBoard.ts';
import type { Timeline }                                               from '../@types/Timeline.ts';
import type { NameColumnWidth, StoredViewOverride, ViewerPreferences } from '../@types/ViewerChoices.ts';
import { NO_EPIC_CHIP }                                                from '../constants/EpicChips.ts';
import {
  AXIS_TICKS_ELEMENT_ID,
  CHART_ELEMENT_ID,
  CHART_OVERLAY_ELEMENT_ID,
  RANGE_NOTE_ELEMENT_ID,
  TASK_ROWS_ELEMENT_ID,
} from '../constants/TemplateIds.ts';
import { EpicMarkup }                             from '../epics/EpicMarkup.ts';
import { ViewerPreferenceUtil }                   from '../preferences/utils/ViewerPreferenceUtil.ts';
import { DomUtil }                                from '../utils/DomUtil.ts';
import { GeometryUtil }                           from '../utils/GeometryUtil.ts';
import { TimeUtil }                               from '../utils/TimeUtil.ts';
import { createCustomRangePopover }               from './CustomRangePopover.ts';
import { effectiveViewRangeFor }                  from './EffectiveViewRange.ts';
import type { EpicGrouping, PlacedTick, TaskRow } from './GanttChartMarkup.ts';
import {
  overlayMarkup,
  rangeNoteMarkup,
  rangeNoteText,
  taskRowsMarkup,
  tickLayerMarkup,
} from './GanttChartMarkup.ts';
import { FIT_RANGE_PRESET, NAME_COLUMN_WIDTH_ATTRIBUTE, RANGE_PRESET_BOUNDS } from './constants/ProgressChart.ts';
import { AxisFitUtil }                                                        from './utils/AxisFitUtil.ts';
import { RangePresetUtil }                                                    from './utils/RangePresetUtil.ts';

export interface GanttChartControllerSources {
  payload:       PagePayload;
  rows:          readonly BoardRow[];
  tickets:       readonly BoardTicket[];
  /** Ordered by key; a board without epics draws its rows ungrouped. */
  epics:         readonly BoardEpic[];
  waitingOnById: ReadonlyMap<string, readonly string[]>;
  preferences:   ViewerPreferences;
}

export interface GanttChartController {
  applyNameColumnWidth(): void;
  setVisibleRows(visibleRows: readonly BoardRow[]): void;
  layOut(bringNowIntoView: boolean): void;
  wireRangeBar(): void;
  rangePopoverIsOpen(): boolean;
  reopenRangePopover(fromText: string, toText: string): void;
  wireNameColumn(): void;
  wireChartWidth(): void;
  wireReviewRows(): void;
  wireEpicGroups(): void;
}

const EPIC_HEAD_ROW_SELECTOR = '.ap-epic-head-row[data-epic-key]';
/** A click on one of these inside a head row belongs to it: the epic chip opens the epic. */
const OWN_CLICK_SELECTOR     = 'a, button';

const REVIEW_ROWS_CONTROL_ELEMENT_ID = 'ap-review-rows';
const FIT_PRESET_ELEMENT_ID          = 'ap-range-fit';
const NAME_COLUMN_WIDTH_PROPERTY     = '--col-name';

function reflectNameColumnWidth(width: NameColumnWidth): void {
  document.documentElement.setAttribute(NAME_COLUMN_WIDTH_ATTRIBUTE, width);
  const control = document.getElementById('ap-name-column');
  if (control !== null) {
    control.setAttribute('aria-pressed', String(width === 'wide'));
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

/** A hidden chart measures every label at zero width, so its labels are only marked once it is laid out on screen. */
function markCoveredAxisLabels(chartIsOnScreen: boolean): void {
  const ticks  = [...document.querySelectorAll(`#${AXIS_TICKS_ELEMENT_ID} > .ap-tick`)];
  const labels = ticks.map((tick) => tick.firstElementChild?.getBoundingClientRect() ?? { left: 0, right: 0 });
  const covered = chartIsOnScreen ? GeometryUtil.coveredTickLabels(labels, []) : [];
  ticks.forEach((tick, index) => {
    tick.toggleAttribute('data-covered', covered[index] ?? false);
  });
}

function taskRowsFor(visibleRows: readonly BoardRow[], timeline: Timeline, waitingOnById: ReadonlyMap<string, readonly string[]>): TaskRow[] {
  return visibleRows.flatMap((task, index) => {
    const bar = timeline.bars[index];
    if (bar === undefined) {
      return [];
    }
    return [{
      task,
      bar,
      waitingOn: task.ticket === null ? [] : waitingOnById.get(task.ticket) ?? [],
    }];
  });
}

// The popover's fields and ticks are a draft, filled from the override when it opens, so a layout never touches them.
function reflectRangeBar(pressedPreset: string, rowsChangedUnderHeldRange: boolean): void {
  DomUtil.reflectSegment('ap-range-presets', 'preset', pressedPreset);
  document.getElementById(FIT_PRESET_ELEMENT_ID)?.toggleAttribute('data-refit', rowsChangedUnderHeldRange && pressedPreset !== FIT_RANGE_PRESET);
}

function wireRangePresets(readOverride: () => StoredViewOverride, applyOverride: (next: StoredViewOverride) => void): void {
  document.getElementById('ap-range-presets')?.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('[data-preset]') : null;
    if (!(button instanceof HTMLElement)) {
      return;
    }
    const key = button.dataset['preset'] ?? FIT_RANGE_PRESET;
    if (!Object.hasOwn(RANGE_PRESET_BOUNDS, key)) {
      return;
    }
    const bounds = RANGE_PRESET_BOUNDS[key] ?? { fromText: null, toText: null };
    applyOverride({
      presetKey:   key,
      fromText:    bounds.fromText,
      toText:      bounds.toText,
      // Fit chooses its ticks for the span it fits.
      tickMinutes: key === FIT_RANGE_PRESET ? null : readOverride().tickMinutes,
    });
  });
}

function rowIdsOf(rows: readonly BoardRow[]): string {
  return rows.map((row) => row.id).join(',');
}

export function createGanttChartController(sources: GanttChartControllerSources): GanttChartController {
  const {
    payload,
    rows,
    tickets,
    epics,
    waitingOnById,
    preferences,
  } = sources;
  const { progress, limits } = payload;
  const chart                = document.getElementById(CHART_ELEMENT_ID);
  const epicsInShownOrder    = EpicMarkup.epicsInShownOrder(epics);
  const epicsOfTicket        = new Map(tickets.map((ticket) => [ticket.id, ticket.memberOfEpics]));
  const knownGroupKeys       = new Set([...epics.map((epic) => epic.key), NO_EPIC_CHIP]);
  let foldedGroupKeys        = new Set(preferences.readFoldedEpicGroups().filter((groupKey) => knownGroupKeys.has(groupKey)));
  let override               = preferences.readRangeOverride();
  let nameColumnWidth        = preferences.readNameColumnWidth();
  let reviewRowsAreShown     = preferences.readReviewRowsAreShown();
  let visibleRows            = rows;
  let visibleProgress        = { ...progress, tasks: [...visibleRows] };
  let rowsChangedUnderHeldRange = false;
  let visibleRowsWereSet        = false;

  const layOut = (bringNowIntoView: boolean): void => {
    const nowEpochMilliseconds = Date.now();
    const range: ViewRange     = effectiveViewRangeFor(visibleProgress, override, nowEpochMilliseconds);
    const timeline             = GeometryUtil.computeTimeline({
      progress: visibleProgress,
      range,
      nowEpochMilliseconds,
      limits,
    });

    const pinnedWidth     = pinnedColumnsWidth();
    const availablePixels = chart === null ? 0 : Math.max(0, chart.clientWidth - pinnedWidth);
    const neededPixels    = AxisFitUtil.axisPixelsNeededFor(timeline.ticks);
    const axisScrolls     = neededPixels > availablePixels;
    const axisWidthPixels = axisScrolls ? neededPixels : availablePixels;
    // Written first: every bar, tick, grid line and the marker is a percentage of this column.
    chart?.style.setProperty('--timeline-w', axisScrolls ? `${Math.round(neededPixels)}px` : '1fr');

    const placedTicks: PlacedTick[] = timeline.ticks.map((tick) => ({
      ...tick,
      labelSitsLeftOfItsLine: AxisFitUtil.labelSitsLeftOfItsLine(tick, axisWidthPixels),
    }));
    DomUtil.setMarkup(AXIS_TICKS_ELEMENT_ID, tickLayerMarkup(placedTicks));
    markCoveredAxisLabels(availablePixels > 0);
    const nowLabelSitsLeftOfMarker = timeline.nowPercent !== null && AxisFitUtil.nowLabelSitsLeftOfMarker(timeline.nowPercent, axisWidthPixels);
    DomUtil.setMarkup(CHART_OVERLAY_ELEMENT_ID, overlayMarkup(timeline.ticks, timeline.nowPercent, nowLabelSitsLeftOfMarker));
    const epicGrouping: EpicGrouping | null = epics.length === 0 ? null : {
      epics:                   epicsInShownOrder,
      epicsOfTicket,
      foldedGroupKeys,
      axis:                    timeline,
      nowEpochMilliseconds,
      minimumSpanWidthPercent: limits.minimumBarWidthPercent,
    };
    DomUtil.setMarkup(TASK_ROWS_ELEMENT_ID, taskRowsMarkup(taskRowsFor(visibleRows, timeline, waitingOnById), {
      slices:            limits,
      todayCalendarDate: TimeUtil.calendarDateOf(nowEpochMilliseconds),
      reviewRowsAreShown,
      epicGrouping,
    }));
    DomUtil.setHidden('ap-chart-empty', visibleProgress.tasks.length > 0);

    const rangeNote = rangeNoteText(timeline.fromEpochMilliseconds, timeline.toEpochMilliseconds, timeline.stepMinutes, TimeUtil.calendarDateOf(nowEpochMilliseconds), limits);
    const pressedPreset = RangePresetUtil.pressedPresetOf(override);
    const modeLabel     = RangePresetUtil.modeLabelOf(pressedPreset);
    DomUtil.setMarkup(RANGE_NOTE_ELEMENT_ID, rangeNoteMarkup(modeLabel, RangePresetUtil.rangeIsHeld(override), rangeNote));
    document.getElementById(RANGE_NOTE_ELEMENT_ID)?.setAttribute('title', `${modeLabel} · ${rangeNote.title ?? rangeNote.text}`);
    reflectRangeBar(pressedPreset, rowsChangedUnderHeldRange);

    if (bringNowIntoView && chart !== null && timeline.nowPercent !== null) {
      scrollNowIntoView(chart, timeline.nowPercent, axisWidthPixels, pinnedWidth);
    }
  };

  const applyOverride = (next: StoredViewOverride): void => {
    override = next;
    rowsChangedUnderHeldRange = false;
    preferences.writeRangeOverride(next);
    layOut(true);
  };
  const rangePopover = createCustomRangePopover({
    resolveBound:      (text) => GeometryUtil.resolveRangeBound(text, visibleProgress, Date.now(), limits),
    todayCalendarDate: () => TimeUtil.calendarDateOf(Date.now()),
    readOverride:      () => override,
    applyOverride,
  });

  return {
    applyNameColumnWidth: () => {
      reflectNameColumnWidth(nameColumnWidth);
    },
    setVisibleRows: (nextVisibleRows) => {
      // The first rows a load hands in are the starting point, not a change under the held range.
      if (visibleRowsWereSet && RangePresetUtil.rangeIsHeld(override) && rowIdsOf(nextVisibleRows) !== rowIdsOf(visibleRows)) {
        rowsChangedUnderHeldRange = true;
      }
      visibleRowsWereSet = true;
      visibleRows     = nextVisibleRows;
      visibleProgress = { ...progress, tasks: [...visibleRows] };
    },
    layOut,
    wireRangeBar: () => {
      wireRangePresets(() => override, applyOverride);
      rangePopover.wire();
    },
    rangePopoverIsOpen: () => rangePopover.isOpen(),
    reopenRangePopover: (fromText, toText) => {
      rangePopover.open(fromText, toText);
    },
    wireNameColumn: () => {
      document.getElementById('ap-name-column')?.addEventListener('click', () => {
        nameColumnWidth = ViewerPreferenceUtil.toggledNameColumnWidth(nameColumnWidth);
        preferences.writeNameColumnWidth(nameColumnWidth);
        reflectNameColumnWidth(nameColumnWidth);
        layOut(false);
      });
      // The template eases --col-name, so the layout taken at the click measured the old width; it is taken again once the column settles.
      document.documentElement.addEventListener('transitionend', (event) => {
        if (event.target === document.documentElement && event.propertyName === NAME_COLUMN_WIDTH_PROPERTY) {
          layOut(false);
        }
      });
    },
    wireChartWidth: () => {
      // A chart laid out while its tab was hidden measured nothing, so it is laid out again once it has a width, and on every change of it.
      if (chart === null) {
        return;
      }
      let laidOutWidth = chart.clientWidth;
      const widthObserver = new ResizeObserver(() => {
        if (chart.clientWidth !== laidOutWidth) {
          laidOutWidth = chart.clientWidth;
          layOut(false);
        }
      });
      widthObserver.observe(chart);
    },
    wireReviewRows: () => {
      const control = document.getElementById(REVIEW_ROWS_CONTROL_ELEMENT_ID);
      control?.setAttribute('aria-pressed', String(reviewRowsAreShown));
      control?.addEventListener('click', () => {
        reviewRowsAreShown = !reviewRowsAreShown;
        preferences.writeReviewRowsAreShown(reviewRowsAreShown);
        control.setAttribute('aria-pressed', String(reviewRowsAreShown));
        layOut(false);
      });
    },
    wireEpicGroups: () => {
      const rowsElement = document.getElementById(TASK_ROWS_ELEMENT_ID);
      const toggleFold = (headRow: HTMLElement): void => {
        const groupKey = headRow.dataset['epicKey'] ?? '';
        foldedGroupKeys = new Set(foldedGroupKeys);
        if (!foldedGroupKeys.delete(groupKey)) {
          foldedGroupKeys.add(groupKey);
        }
        preferences.writeFoldedEpicGroups([...foldedGroupKeys]);
        layOut(false);
        // The rows were drawn afresh, so the focus moves to the new head row of the same group.
        document.querySelector<HTMLElement>(`#${TASK_ROWS_ELEMENT_ID} > ${EPIC_HEAD_ROW_SELECTOR}[data-epic-key="${CSS.escape(groupKey)}"]`)?.focus();
      };
      rowsElement?.addEventListener('click', (event) => {
        const target  = event.target instanceof Element ? event.target : null;
        const headRow = target?.closest(EPIC_HEAD_ROW_SELECTOR);
        if (headRow instanceof HTMLElement && target?.closest(OWN_CLICK_SELECTOR) === null) {
          toggleFold(headRow);
        }
      });
      rowsElement?.addEventListener('keydown', (event) => {
        if ((event.key === 'Enter' || event.key === ' ') && event.target instanceof HTMLElement && event.target.matches(EPIC_HEAD_ROW_SELECTOR)) {
          event.preventDefault();
          toggleFold(event.target);
        }
      });
    },
  };
}
