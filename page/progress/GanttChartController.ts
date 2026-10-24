/** The Progress tab: the chart's layout, the chart head's range menu with its Fit preset, and the row options. */

import type { ViewRange }                                              from '../../src/lib/tracker-model/@types/TrackerProgress.ts';
import type { PageLimits }                                             from '../../src/shared/@types/PagePayload.ts';
import type { Timeline, TimelineRowSource }                            from '../@types/Timeline.ts';
import type { NameColumnWidth, StoredViewOverride, ViewerPreferences } from '../@types/ViewerChoices.ts';
import {
  AXIS_TICKS_ELEMENT_ID,
  CHART_ELEMENT_ID,
  CHART_OVERLAY_ELEMENT_ID,
  RANGE_BUTTON_ELEMENT_ID,
  RANGE_NOTE_ELEMENT_ID,
  RANGE_SUMMARY_ELEMENT_ID,
  TASK_ROWS_ELEMENT_ID,
} from '../constants/TemplateIds.ts';
import { DomUtil }                                  from '../utils/DomUtil.ts';
import { GeometryUtil }                             from '../utils/GeometryUtil.ts';
import { TimeUtil }                                 from '../utils/TimeUtil.ts';
import { createCustomRangePopover }                 from './CustomRangePopover.ts';
import { effectiveViewRangeFor }                    from './EffectiveViewRange.ts';
import type { ChartRowSource, PlacedTick, TaskRow } from './GanttChartMarkup.ts';
import {
  overlayMarkup,
  rangeNoteText,
  rangeSummaryMarkup,
  taskRowsMarkup,
  tickLayerMarkup,
} from './GanttChartMarkup.ts';
import type { HeadMenu }                                                      from './HeadMenu.ts';
import { createHeadMenu }                                                     from './HeadMenu.ts';
import type { RowGrouping, RowGroupingSource }                                from './RowGrouping.ts';
import { FIT_RANGE_PRESET, NAME_COLUMN_WIDTH_ATTRIBUTE, RANGE_PRESET_BOUNDS } from './constants/ProgressChart.ts';
import { AxisFitUtil }                                                        from './utils/AxisFitUtil.ts';
import { ChartPreferenceUtil }                                                from './utils/ChartPreferenceUtil.ts';
import { RangePresetUtil }                                                    from './utils/RangePresetUtil.ts';

/** The chart's range, its rows and the moment its work started; the rows drawn are the visible ones handed in later. */
export interface ChartProgress {
  startedAt: string;
  view:      ViewRange;
  tasks:     readonly TimelineRowSource[];
}

export type GanttChartPreferences = Pick<ViewerPreferences,
  'readRangeOverride' | 'writeRangeOverride' | 'readNameColumnWidth' | 'writeNameColumnWidth' | 'readFoldedEpicGroups' | 'writeFoldedEpicGroups'>;

export type ReviewRowsPreference = Pick<ViewerPreferences, 'readReviewRowsAreShown' | 'writeReviewRowsAreShown'>;

export interface GanttChartControllerSources<Row extends ChartRowSource> {
  progress:              ChartProgress;
  limits:                PageLimits;
  rows:                  readonly Row[];
  /** Null draws the rows ungrouped. */
  rowGrouping:           NoInfer<RowGroupingSource<Row>> | null;
  waitingOnOf:           (row: Row) => readonly string[];
  trailingNameMarkupOf?: (row: Row) => string;
  /** A parameter, never the clock read here: the live page draws the present, a snapshot the moment it was taken. */
  nowEpochMilliseconds:  () => number;
  preferences:           GanttChartPreferences;
  /** Absent, review passes are always drawn as segments and the control is never wired. */
  reviewRows?:           ReviewRowsPreference;
}

export interface GanttChartController<Row extends ChartRowSource> {
  applyNameColumnWidth(): void;
  setVisibleRows(visibleRows: readonly Row[]): void;
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
const RANGE_MENU_ELEMENT_ID          = 'ap-range-menu';
const ROW_OPTIONS_BUTTON_ELEMENT_ID  = 'ap-row-options-button';
const ROW_OPTIONS_MENU_ELEMENT_ID    = 'ap-row-options-menu';
const NAME_COLUMN_WIDTH_PROPERTY     = '--col-name';

function reflectNameColumnWidth(width: NameColumnWidth): void {
  document.documentElement.setAttribute(NAME_COLUMN_WIDTH_ATTRIBUTE, width);
  const control = document.getElementById('ap-name-column');
  if (control !== null) {
    control.setAttribute('aria-pressed', String(width === 'wide'));
  }
}

function pinnedColumnWidth(): number {
  const headerName = document.querySelector('.ap-chart-head > .ap-cell-name');
  return headerName instanceof HTMLElement ? headerName.getBoundingClientRect().width : 0;
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

function taskRowsFor<Row extends ChartRowSource>(
  visibleRows: readonly Row[],
  timeline: Timeline,
  sources: Pick<GanttChartControllerSources<Row>, 'waitingOnOf' | 'trailingNameMarkupOf'>,
): TaskRow[] {
  const { waitingOnOf, trailingNameMarkupOf } = sources;
  return visibleRows.flatMap((task, index) => {
    const bar = timeline.bars[index];
    if (bar === undefined) {
      return [];
    }
    const row: TaskRow = { task, bar, waitingOn: waitingOnOf(task) };
    return [trailingNameMarkupOf === undefined ? row : { ...row, trailingNameMarkup: trailingNameMarkupOf(task) }];
  });
}

// The popover's fields and ticks are a draft, filled from the override when it opens, so a layout never touches them.
function reflectRangeBar(pressedPreset: string, rowsChangedUnderHeldRange: boolean): void {
  DomUtil.reflectSegment('ap-range-presets', 'preset', pressedPreset);
  const showsRefitDot = rowsChangedUnderHeldRange && pressedPreset !== FIT_RANGE_PRESET;
  for (const elementId of [FIT_PRESET_ELEMENT_ID, RANGE_BUTTON_ELEMENT_ID]) {
    document.getElementById(elementId)?.toggleAttribute('data-refit', showsRefitDot);
  }
}

function wireRangePresets(readOverride: () => StoredViewOverride, applyOverride: (next: StoredViewOverride) => void, rangeMenu: HeadMenu): void {
  document.getElementById('ap-range-presets')?.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('[data-preset]') : null;
    if (!(button instanceof HTMLElement)) {
      return;
    }
    const key = button.dataset['preset'] ?? FIT_RANGE_PRESET;
    // Custom… opens its popover, which takes the focus, so the menu closes without handing it back.
    rangeMenu.close(Object.hasOwn(RANGE_PRESET_BOUNDS, key));
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

function rowIdsOf(rows: readonly ChartRowSource[]): string {
  return rows.map((row) => row.id ?? row.name).join(',');
}

export function createGanttChartController<Row extends ChartRowSource>(sources: GanttChartControllerSources<Row>): GanttChartController<Row> {
  const {
    progress,
    limits,
    rows,
    rowGrouping,
    nowEpochMilliseconds: readNow,
    preferences,
    reviewRows,
  } = sources;
  const chart                = document.getElementById(CHART_ELEMENT_ID);
  const ungroupedHeadKeys    = rowGrouping?.ungroupedHead === null || rowGrouping === null ? [] : [rowGrouping.ungroupedHead.key];
  const knownGroupKeys       = new Set([...rowGrouping?.groups.map((group) => group.key) ?? [], ...ungroupedHeadKeys]);
  let foldedGroupKeys        = new Set(preferences.readFoldedEpicGroups().filter((groupKey) => knownGroupKeys.has(groupKey)));
  let override               = preferences.readRangeOverride();
  let nameColumnWidth        = preferences.readNameColumnWidth();
  let reviewRowsAreShown     = reviewRows?.readReviewRowsAreShown() ?? false;
  let visibleRows            = rows;
  let visibleProgress        = { ...progress, tasks: [...visibleRows] };
  let rowsChangedUnderHeldRange = false;
  let visibleRowsWereSet        = false;

  const layOut = (bringNowIntoView: boolean): void => {
    const nowEpochMilliseconds = readNow();
    const range: ViewRange     = effectiveViewRangeFor(visibleProgress, override, nowEpochMilliseconds);
    const timeline             = GeometryUtil.computeTimeline({
      progress: visibleProgress,
      range,
      nowEpochMilliseconds,
      limits,
    });

    const pinnedWidth     = pinnedColumnWidth();
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
    const drawnGrouping: RowGrouping<Row> | null = rowGrouping === null ? null : {
      ...rowGrouping,
      foldedGroupKeys,
      axis:                    timeline,
      nowEpochMilliseconds,
      minimumSpanWidthPercent: limits.minimumBarWidthPercent,
    };
    DomUtil.setMarkup(TASK_ROWS_ELEMENT_ID, taskRowsMarkup(taskRowsFor(visibleRows, timeline, sources), {
      slices:            limits,
      todayCalendarDate: TimeUtil.calendarDateOf(nowEpochMilliseconds),
      reviewRowsAreShown,
      rowGrouping:       drawnGrouping,
    }));
    DomUtil.setHidden('ap-chart-empty', visibleProgress.tasks.length > 0);

    const rangeNote = rangeNoteText(timeline.fromEpochMilliseconds, timeline.toEpochMilliseconds, timeline.stepMinutes, TimeUtil.calendarDateOf(nowEpochMilliseconds), limits);
    const pressedPreset = RangePresetUtil.pressedPresetOf(override);
    const modeLabel     = RangePresetUtil.modeLabelOf(pressedPreset);
    DomUtil.setMarkup(RANGE_SUMMARY_ELEMENT_ID, rangeSummaryMarkup(modeLabel, RangePresetUtil.rangeIsHeld(override), timeline.fromEpochMilliseconds, timeline.toEpochMilliseconds));
    const rangeNoteElement = document.getElementById(RANGE_NOTE_ELEMENT_ID);
    if (rangeNoteElement !== null) {
      rangeNoteElement.textContent = rangeNote.text;
      rangeNoteElement.setAttribute('title', `${modeLabel} · ${rangeNote.title ?? rangeNote.text}`);
    }
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
    resolveBound:      (text) => GeometryUtil.resolveRangeBound(text, visibleProgress, readNow(), limits),
    todayCalendarDate: () => TimeUtil.calendarDateOf(readNow()),
    readOverride:      () => override,
    applyOverride,
  });
  const rangeMenu      = createHeadMenu({ buttonElementId: RANGE_BUTTON_ELEMENT_ID, menuElementId: RANGE_MENU_ELEMENT_ID });
  const rowOptionsMenu = createHeadMenu({ buttonElementId: ROW_OPTIONS_BUTTON_ELEMENT_ID, menuElementId: ROW_OPTIONS_MENU_ELEMENT_ID });

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
      rangeMenu.wire();
      wireRangePresets(() => override, applyOverride, rangeMenu);
      rangePopover.wire();
    },
    rangePopoverIsOpen: () => rangePopover.isOpen(),
    reopenRangePopover: (fromText, toText) => {
      rangePopover.open(fromText, toText);
    },
    wireNameColumn: () => {
      rowOptionsMenu.wire();
      document.getElementById('ap-name-column')?.addEventListener('click', () => {
        rowOptionsMenu.close(true);
        nameColumnWidth = ChartPreferenceUtil.toggledNameColumnWidth(nameColumnWidth);
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
      if (reviewRows === undefined) {
        return;
      }
      const control = document.getElementById(REVIEW_ROWS_CONTROL_ELEMENT_ID);
      control?.setAttribute('aria-pressed', String(reviewRowsAreShown));
      control?.addEventListener('click', () => {
        rowOptionsMenu.close(true);
        reviewRowsAreShown = !reviewRowsAreShown;
        reviewRows.writeReviewRowsAreShown(reviewRowsAreShown);
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
