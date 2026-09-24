/**
 * The Gantt axis and bar geometry as pure arithmetic over epoch milliseconds: no DOM, no clock. Its bounds arrive as a parameter instead of
 * from `lib/constants/Limits.ts`, so `lib/render/GanttGeometry.spec.ts` drives it with a constructed tick ladder; the page passes what
 * `lib/render/Template.ts` put in the progress island.
 */

import type { ProgressFile, Task, ViewRange } from '../../constants/Types.ts';

const MILLISECONDS_PER_MINUTE = 60_000;
const PERCENT_OF_A_WHOLE      = 100;
const MINIMUM_STEP_MINUTES    = 1;

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export interface TimelineLimits {
  tickStepLadderMinutes:      readonly number[];
  maximumTicksPerAxis:        number;
  axisMinimumSpanMinutes:     number;
  axisPaddingMinutes:         number;
  minimumBarWidthPercent:     number;
  hoursAxisLabelLimitMinutes: number;
  weekAxisLabelLimitMinutes:  number;
  hourMinutes:                number;
  dayMinutes:                 number;
  tickCountSafetyBound:       number;
}

export interface TimelineTick {
  leftPercent: number;
  label:       string;
}

export interface TimelineBar {
  taskId:       number;
  leftPercent:  number;
  widthPercent: number;
  clippedLeft:  boolean;
  clippedRight: boolean;
  visible:      boolean;
}

export interface Timeline {
  fromEpochMilliseconds: number;
  toEpochMilliseconds:   number;
  stepMinutes:           number;
  ticks:                 TimelineTick[];
  bars:                  TimelineBar[];
  nowPercent:            number | null;
}

interface ResolvedSpan {
  fromEpochMilliseconds: number;
  toEpochMilliseconds:   number;
}

function parseTimestamp(text: string | null): number | null {
  if (text === null || text === '') {
    return null;
  }
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseOffsetMinutes(text: string, limits: TimelineLimits): number | null {
  const match = /^([+-])(\d+)([mhd])$/.exec(text.trim());
  if (match === null) {
    return null;
  }
  const [, sign, amount, unit] = match;
  if (sign === undefined || amount === undefined || unit === undefined) {
    return null;
  }
  const magnitude = Number(amount);
  const perUnit   = unit === 'h' ? limits.hourMinutes : unit === 'd' ? limits.dayMinutes : 1;
  return (sign === '-' ? -magnitude : magnitude) * perUnit;
}

/** The page hands in only the visible rows, so `startedAt` is the answer only when none of them has started. */
function earliestRecordedMoment(progress: ProgressFile, startedAtEpochMilliseconds: number): number {
  let earliestEpochMilliseconds: number | null = null;
  for (const task of progress.tasks) {
    const startEpochMilliseconds = parseTimestamp(task.start);
    if (startEpochMilliseconds !== null && (earliestEpochMilliseconds === null || startEpochMilliseconds < earliestEpochMilliseconds)) {
      earliestEpochMilliseconds = startEpochMilliseconds;
    }
  }
  return earliestEpochMilliseconds ?? startedAtEpochMilliseconds;
}

export function spanFitsClockOnlyLabels(spanMinutes: number, hoursAxisLabelLimitMinutes: number): boolean {
  return spanMinutes < hoursAxisLabelLimitMinutes;
}

// `start` is the earliest visible row start, not `startedAt`: hidden work must not stretch the axis, and backfilled rows begin earlier.
function resolveEndpoint(text: string, earliestEpochMilliseconds: number, nowEpochMilliseconds: number, limits: TimelineLimits): number | null {
  const trimmed = text.trim();
  if (trimmed === 'start') {
    return earliestEpochMilliseconds;
  }
  if (trimmed === 'now') {
    return nowEpochMilliseconds;
  }
  const offsetMinutes = parseOffsetMinutes(trimmed, limits);
  if (offsetMinutes !== null) {
    return nowEpochMilliseconds + offsetMinutes * MILLISECONDS_PER_MINUTE;
  }
  return parseTimestamp(trimmed);
}

function resolveAutomaticSpan(progress: ProgressFile, earliestEpochMilliseconds: number, nowEpochMilliseconds: number, limits: TimelineLimits): ResolvedSpan {
  let horizonEpochMilliseconds = nowEpochMilliseconds;
  for (const task of progress.tasks) {
    const startEpochMilliseconds = parseTimestamp(task.start);
    const endEpochMilliseconds   = parseTimestamp(task.end);
    if (startEpochMilliseconds !== null && startEpochMilliseconds > horizonEpochMilliseconds) {
      horizonEpochMilliseconds = startEpochMilliseconds;
    }
    if (endEpochMilliseconds !== null && endEpochMilliseconds > horizonEpochMilliseconds) {
      horizonEpochMilliseconds = endEpochMilliseconds;
    }
  }
  const measuredMinutes = (horizonEpochMilliseconds - earliestEpochMilliseconds) / MILLISECONDS_PER_MINUTE;
  const spanMinutes     = Math.max(limits.axisMinimumSpanMinutes, measuredMinutes + limits.axisPaddingMinutes);
  return {
    fromEpochMilliseconds: earliestEpochMilliseconds,
    toEpochMilliseconds:   earliestEpochMilliseconds + spanMinutes * MILLISECONDS_PER_MINUTE,
  };
}

function resolveSpan(progress: ProgressFile, range: ViewRange, nowEpochMilliseconds: number, limits: TimelineLimits): ResolvedSpan {
  const startedAtEpochMilliseconds = parseTimestamp(progress.startedAt) ?? nowEpochMilliseconds;
  const earliestEpochMilliseconds  = earliestRecordedMoment(progress, startedAtEpochMilliseconds);
  if (range.kind === 'auto') {
    return resolveAutomaticSpan(progress, earliestEpochMilliseconds, nowEpochMilliseconds, limits);
  }
  const fromEpochMilliseconds = resolveEndpoint(range.from, earliestEpochMilliseconds, nowEpochMilliseconds, limits);
  const toEpochMilliseconds   = resolveEndpoint(range.to, earliestEpochMilliseconds, nowEpochMilliseconds, limits);
  if (fromEpochMilliseconds === null || toEpochMilliseconds === null) {
    return resolveAutomaticSpan(progress, earliestEpochMilliseconds, nowEpochMilliseconds, limits);
  }
  if (toEpochMilliseconds <= fromEpochMilliseconds) {
    return {
      fromEpochMilliseconds,
      toEpochMilliseconds: fromEpochMilliseconds + limits.axisMinimumSpanMinutes * MILLISECONDS_PER_MINUTE,
    };
  }
  return { fromEpochMilliseconds, toEpochMilliseconds };
}

function chooseStepMinutes(spanMinutes: number, tickMinutes: number | null, limits: TimelineLimits): number {
  if (tickMinutes !== null && tickMinutes > 0) {
    return Math.max(MINIMUM_STEP_MINUTES, tickMinutes);
  }
  for (const candidateMinutes of limits.tickStepLadderMinutes) {
    if (candidateMinutes > 0 && spanMinutes / candidateMinutes <= limits.maximumTicksPerAxis) {
      return candidateMinutes;
    }
  }
  const dayCount = Math.ceil(spanMinutes / Math.max(1, limits.maximumTicksPerAxis * limits.dayMinutes));
  return Math.max(MINIMUM_STEP_MINUTES, dayCount * limits.dayMinutes);
}

/** Local rather than UTC, or a 30-minute step lands on `:15`/`:45` in a half-hour zone. */
function localWallClockMinutes(epochMilliseconds: number): number {
  const moment = new Date(epochMilliseconds);
  return Math.floor(epochMilliseconds / MILLISECONDS_PER_MINUTE) - moment.getTimezoneOffset();
}

function padToTwoDigits(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function formatTickLabel(epochMilliseconds: number, spanMinutes: number, limits: TimelineLimits): string {
  const moment     = new Date(epochMilliseconds);
  const clockLabel = `${padToTwoDigits(moment.getHours())}:${padToTwoDigits(moment.getMinutes())}`;
  if (spanFitsClockOnlyLabels(spanMinutes, limits.hoursAxisLabelLimitMinutes)) {
    return clockLabel;
  }
  if (spanMinutes <= limits.weekAxisLabelLimitMinutes) {
    return `${WEEKDAY_NAMES[moment.getDay()] ?? ''} ${clockLabel}`;
  }
  return `${padToTwoDigits(moment.getMonth() + 1)}-${padToTwoDigits(moment.getDate())}`;
}

function buildTicks(span: ResolvedSpan, stepMinutes: number, spanMinutes: number, limits: TimelineLimits): TimelineTick[] {
  const stepMilliseconds       = stepMinutes * MILLISECONDS_PER_MINUTE;
  const spanMilliseconds       = span.toEpochMilliseconds - span.fromEpochMilliseconds;
  const fromWallClockMinutes   = localWallClockMinutes(span.fromEpochMilliseconds);
  const firstWallClockMinutes  = Math.ceil(fromWallClockMinutes / stepMinutes) * stepMinutes;
  const containingMinuteEpoch  = Math.floor(span.fromEpochMilliseconds / MILLISECONDS_PER_MINUTE) * MILLISECONDS_PER_MINUTE;
  let tickEpochMilliseconds    = containingMinuteEpoch + (firstWallClockMinutes - fromWallClockMinutes) * MILLISECONDS_PER_MINUTE;
  while (tickEpochMilliseconds < span.fromEpochMilliseconds) {
    tickEpochMilliseconds += stepMilliseconds;
  }
  const ticks: TimelineTick[] = [];
  while (tickEpochMilliseconds <= span.toEpochMilliseconds && ticks.length < limits.tickCountSafetyBound) {
    ticks.push({
      leftPercent: (tickEpochMilliseconds - span.fromEpochMilliseconds) / spanMilliseconds * PERCENT_OF_A_WHOLE,
      label:       formatTickLabel(tickEpochMilliseconds, spanMinutes, limits),
    });
    tickEpochMilliseconds += stepMilliseconds;
  }
  return ticks;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return value > PERCENT_OF_A_WHOLE ? PERCENT_OF_A_WHOLE : value;
}

/** Every bar is a percentage of the axis box and never narrower than `minimumBarWidthPercent`, so a zero-length task is still visible. */
function barForTask(task: Task, span: ResolvedSpan, nowEpochMilliseconds: number, limits: TimelineLimits): TimelineBar {
  const startEpochMilliseconds = parseTimestamp(task.start);
  if (startEpochMilliseconds === null) {
    return {
      taskId:       task.id,
      leftPercent:  0,
      widthPercent: 0,
      clippedLeft:  false,
      clippedRight: false,
      visible:      false,
    };
  }
  const endEpochMilliseconds = Math.max(startEpochMilliseconds, parseTimestamp(task.end) ?? nowEpochMilliseconds);
  const spanMilliseconds     = span.toEpochMilliseconds - span.fromEpochMilliseconds;
  const rawLeftPercent       = (startEpochMilliseconds - span.fromEpochMilliseconds) / spanMilliseconds * PERCENT_OF_A_WHOLE;
  const rawRightPercent      = (endEpochMilliseconds - span.fromEpochMilliseconds) / spanMilliseconds * PERCENT_OF_A_WHOLE;
  const widthPercent         = Math.min(PERCENT_OF_A_WHOLE, Math.max(clampPercent(rawRightPercent) - clampPercent(rawLeftPercent), limits.minimumBarWidthPercent));
  const leftPercent          = Math.min(clampPercent(rawLeftPercent), PERCENT_OF_A_WHOLE - widthPercent);
  return {
    taskId:       task.id,
    leftPercent:  Math.max(0, leftPercent),
    widthPercent,
    clippedLeft:  rawLeftPercent < 0,
    clippedRight: rawRightPercent > PERCENT_OF_A_WHOLE,
    visible:      true,
  };
}

/** `nowPercent` is `null` whenever the present moment falls outside the range, and every caller depends on that to hide the marker. */
export function computeTimeline(input: {
  progress:             ProgressFile;
  range:                ViewRange;
  nowEpochMilliseconds: number;
  limits:               TimelineLimits;
}): Timeline {
  const {
    progress,
    range,
    nowEpochMilliseconds,
    limits,
  } = input;
  const span             = resolveSpan(progress, range, nowEpochMilliseconds, limits);
  const spanMilliseconds = span.toEpochMilliseconds - span.fromEpochMilliseconds;
  const spanMinutes      = spanMilliseconds / MILLISECONDS_PER_MINUTE;
  const tickMinutes      = range.kind === 'auto' ? null : range.tickMinutes;
  const stepMinutes      = chooseStepMinutes(spanMinutes, tickMinutes, limits);
  const nowIsInRange     = nowEpochMilliseconds >= span.fromEpochMilliseconds && nowEpochMilliseconds <= span.toEpochMilliseconds;
  return {
    fromEpochMilliseconds: span.fromEpochMilliseconds,
    toEpochMilliseconds:   span.toEpochMilliseconds,
    stepMinutes,
    ticks:                 buildTicks(span, stepMinutes, spanMinutes, limits),
    bars:                  progress.tasks.map((task) => barForTask(task, span, nowEpochMilliseconds, limits)),
    nowPercent:            nowIsInRange ? (nowEpochMilliseconds - span.fromEpochMilliseconds) / spanMilliseconds * PERCENT_OF_A_WHOLE : null,
  };
}
