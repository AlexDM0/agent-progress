/** The Progress tab: the summary, the generated stamp, the hidden-work note, the chart's layout, the range bar and the name column. */

import type { ProgressFile, ViewRange }                                from '../../src/lib/tracker-model/@types/ProgressFile.ts';
import type { Task }                                                   from '../../src/lib/tracker-model/@types/Task.ts';
import type { TicketStatus }                                           from '../../src/lib/tracker-model/@types/Ticket.ts';
import type { PagePayload }                                            from '../../src/shared/@types/PagePayload.ts';
import type { NameColumnWidth, StoredViewOverride, ViewerPreferences } from '../preferences/ViewerPreferences.ts';
import { toggledNameColumnWidth }                                      from '../preferences/ViewerPreferences.ts';
import { DomUtil }                                                     from '../utils/DomUtil.ts';
import type { Timeline }                                               from '../utils/GeometryUtil.ts';
import { GeometryUtil }                                                from '../utils/GeometryUtil.ts';
import { TimeUtil }                                                    from '../utils/TimeUtil.ts';
import type { PlacedTick, TaskRow }                                    from './ProgressMarkup.ts';
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
} from './ProgressMarkup.ts';
import {
  AUTOMATIC_RANGE_PRESET,
  AUTOMATIC_TICK_CHOICE,
  NAME_COLUMN_WIDTH_ATTRIBUTE,
  RANGE_PRESET_BOUNDS,
} from './constants/ProgressChart.ts';
import { ViewRangeUtil } from './utils/ViewRangeUtil.ts';

export interface ProgressControllerSources {
  payload:          PagePayload;
  ticketStatusById: ReadonlyMap<string, TicketStatus>;
  waitingOnById:    ReadonlyMap<string, readonly string[]>;
  preferences:      ViewerPreferences;
}

export interface ProgressController {
  showSummary(): void;
  applyNameColumnWidth(): void;
  showVisibleTasks(visibleTasks: Task[]): void;
  showGeneratedStamp(todayCalendarDate: string): void;
  showHiddenNote(hiddenTaskCount: number, hiddenTicketCount: number): void;
  layOut(bringNowIntoView: boolean): void;
  wireRangeBar(): void;
  wireNameColumn(): void;
}

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

function taskRowsFor(
  progress: ProgressFile,
  timeline: Timeline,
  ticketStatusById: ReadonlyMap<string, TicketStatus>,
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

function reflectRangeBar(override: StoredViewOverride): void {
  const boundsAreUnset = override.fromText === null && override.toText === null;
  DomUtil.reflectSegment('ap-range-presets', 'preset', override.presetKey ?? (boundsAreUnset ? AUTOMATIC_RANGE_PRESET : ''));
  DomUtil.reflectSegment('ap-range-ticks', 'tick', override.tickMinutes === null ? AUTOMATIC_TICK_CHOICE : String(override.tickMinutes));
  const fromInput = document.getElementById('ap-range-from');
  const toInput   = document.getElementById('ap-range-to');
  if (fromInput instanceof HTMLInputElement && document.activeElement !== fromInput) {
    fromInput.value = override.fromText ?? '';
  }
  if (toInput instanceof HTMLInputElement && document.activeElement !== toInput) {
    toInput.value = override.toText ?? '';
  }
}

function wireRangeControls(readOverride: () => StoredViewOverride, applyOverride: (next: StoredViewOverride) => void): void {
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

export function createProgressController(sources: ProgressControllerSources): ProgressController {
  const {
    payload,
    ticketStatusById,
    waitingOnById,
    preferences,
  } = sources;
  const { progress, limits } = payload;
  const chart                = document.getElementById('ap-chart');
  let override               = preferences.readRangeOverride();
  let nameColumnWidth        = preferences.readNameColumnWidth();
  let visibleProgress        = progress;

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
    DomUtil.setMarkup('ap-ticks', tickLayerMarkup(placedTicks));
    DomUtil.setMarkup('ap-overlay', overlayMarkup(timeline.ticks, timeline.nowPercent));
    DomUtil.setMarkup('ap-rows', taskRowsMarkup(taskRowsFor(visibleProgress, timeline, ticketStatusById, waitingOnById), limits));
    DomUtil.setHidden('ap-chart-empty', visibleProgress.tasks.length > 0);

    const rangeNote = rangeNoteText(timeline.fromEpochMilliseconds, timeline.toEpochMilliseconds, timeline.stepMinutes, TimeUtil.calendarDateOf(nowEpochMilliseconds), limits);
    DomUtil.setShortenedText('ap-range-note', rangeNote);
    reflectRangeBar(override);

    if (bringNowIntoView && chart !== null && timeline.nowPercent !== null) {
      scrollNowIntoView(chart, timeline.nowPercent, axisWidthPixels, pinnedWidth);
    }
  };

  return {
    showSummary: () => {
      DomUtil.setMarkup('ap-summary', summaryStatsMarkup(progress.tasks, payload.concurrency));
    },
    applyNameColumnWidth: () => {
      reflectNameColumnWidth(nameColumnWidth);
    },
    showVisibleTasks: (visibleTasks) => {
      visibleProgress = { ...progress, tasks: visibleTasks };
    },
    showGeneratedStamp: (todayCalendarDate) => {
      DomUtil.setShortenedText('ap-generated', generatedStampText(payload.generatedAtEpochMilliseconds, todayCalendarDate));
    },
    showHiddenNote: (hiddenTaskCount, hiddenTicketCount) => {
      DomUtil.setText('ap-hidden-note', hiddenWorkNoteText(hiddenTaskCount, hiddenTicketCount));
    },
    layOut,
    wireRangeBar: () => {
      wireRangeControls(() => override, (next) => {
        override = next;
        preferences.writeRangeOverride(next);
        layOut(true);
      });
    },
    wireNameColumn: () => {
      document.getElementById('ap-name-column')?.addEventListener('click', () => {
        nameColumnWidth = toggledNameColumnWidth(nameColumnWidth);
        preferences.writeNameColumnWidth(nameColumnWidth);
        reflectNameColumnWidth(nameColumnWidth);
        layOut(false);
      });
    },
  };
}
