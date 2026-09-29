/** The Progress tab: the hidden-work note, the chart's layout, the range bar and the name column. */

import type { ViewRange }                                              from '../../src/lib/tracker-model/@types/TrackerProgress.ts';
import type { PagePayload }                                            from '../../src/shared/@types/PagePayload.ts';
import type { BoardRow }                                               from '../@types/PageBoard.ts';
import type { Timeline }                                               from '../@types/Timeline.ts';
import type { NameColumnWidth, StoredViewOverride, ViewerPreferences } from '../@types/ViewerChoices.ts';
import {
  AXIS_TICKS_ELEMENT_ID,
  CHART_ELEMENT_ID,
  CHART_OVERLAY_ELEMENT_ID,
  HIDDEN_WORK_NOTE_ELEMENT_ID,
  RANGE_NOTE_ELEMENT_ID,
  TASK_ROWS_ELEMENT_ID,
} from '../constants/TemplateIds.ts';
import { ViewerPreferenceUtil }     from '../preferences/utils/ViewerPreferenceUtil.ts';
import { DomUtil }                  from '../utils/DomUtil.ts';
import { GeometryUtil }             from '../utils/GeometryUtil.ts';
import { TimeUtil }                 from '../utils/TimeUtil.ts';
import { createCustomRangePopover } from './CustomRangePopover.ts';
import { effectiveViewRangeFor }    from './EffectiveViewRange.ts';
import type { PlacedTick, TaskRow } from './GanttChartMarkup.ts';
import {
  hiddenWorkNoteText,
  overlayMarkup,
  rangeNoteText,
  taskRowsMarkup,
  tickLayerMarkup,
} from './GanttChartMarkup.ts';
import {
  AUTOMATIC_RANGE_PRESET,
  CUSTOM_RANGE_PRESET,
  NAME_COLUMN_WIDTH_ATTRIBUTE,
  RANGE_PRESET_BOUNDS,
} from './constants/ProgressChart.ts';
import { AxisFitUtil } from './utils/AxisFitUtil.ts';

export interface GanttChartControllerSources {
  payload:       PagePayload;
  rows:          readonly BoardRow[];
  waitingOnById: ReadonlyMap<string, readonly string[]>;
  preferences:   ViewerPreferences;
}

export interface GanttChartController {
  applyNameColumnWidth(): void;
  setVisibleRows(visibleRows: readonly BoardRow[]): void;
  showHiddenNote(hiddenTaskCount: number, hiddenTicketCount: number): void;
  layOut(bringNowIntoView: boolean): void;
  wireRangeBar(): void;
  rangePopoverIsOpen(): boolean;
  reopenRangePopover(fromText: string, toText: string): void;
  wireNameColumn(): void;
  wireReviewRows(): void;
}

const REVIEW_ROWS_CONTROL_ELEMENT_ID = 'ap-review-rows';
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
function reflectRangeBar(override: StoredViewOverride): void {
  const boundsAreUnset = override.fromText === null && override.toText === null;
  DomUtil.reflectSegment('ap-range-presets', 'preset', override.presetKey ?? (boundsAreUnset ? AUTOMATIC_RANGE_PRESET : CUSTOM_RANGE_PRESET));
}

function wireRangePresets(readOverride: () => StoredViewOverride, applyOverride: (next: StoredViewOverride) => void): void {
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
}

export function createGanttChartController(sources: GanttChartControllerSources): GanttChartController {
  const {
    payload,
    rows,
    waitingOnById,
    preferences,
  } = sources;
  const { progress, limits } = payload;
  const chart                = document.getElementById(CHART_ELEMENT_ID);
  let override               = preferences.readRangeOverride();
  let nameColumnWidth        = preferences.readNameColumnWidth();
  let reviewRowsAreShown     = preferences.readReviewRowsAreShown();
  let visibleRows            = rows;
  let visibleProgress        = { ...progress, tasks: [...visibleRows] };

  const layOut = (bringNowIntoView: boolean): void => {
    const nowEpochMilliseconds = Date.now();
    const range: ViewRange     = effectiveViewRangeFor(visibleProgress, override, nowEpochMilliseconds, limits);
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
    DomUtil.setMarkup(CHART_OVERLAY_ELEMENT_ID, overlayMarkup(timeline.ticks, timeline.nowPercent));
    DomUtil.setMarkup(TASK_ROWS_ELEMENT_ID, taskRowsMarkup(taskRowsFor(visibleRows, timeline, waitingOnById), {
      slices:            limits,
      todayCalendarDate: TimeUtil.calendarDateOf(nowEpochMilliseconds),
      reviewRowsAreShown,
    }));
    DomUtil.setHidden('ap-chart-empty', visibleProgress.tasks.length > 0);

    const rangeNote = rangeNoteText(timeline.fromEpochMilliseconds, timeline.toEpochMilliseconds, timeline.stepMinutes, TimeUtil.calendarDateOf(nowEpochMilliseconds), limits);
    DomUtil.setShortenedText(RANGE_NOTE_ELEMENT_ID, rangeNote);
    reflectRangeBar(override);

    if (bringNowIntoView && chart !== null && timeline.nowPercent !== null) {
      scrollNowIntoView(chart, timeline.nowPercent, axisWidthPixels, pinnedWidth);
    }
  };

  const applyOverride = (next: StoredViewOverride): void => {
    override = next;
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
      visibleRows     = nextVisibleRows;
      visibleProgress = { ...progress, tasks: [...visibleRows] };
    },
    showHiddenNote: (hiddenTaskCount, hiddenTicketCount) => {
      DomUtil.setText(HIDDEN_WORK_NOTE_ELEMENT_ID, hiddenWorkNoteText(hiddenTaskCount, hiddenTicketCount));
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
  };
}
