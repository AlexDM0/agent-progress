/**
 * The contract of `lib/render/page/GanttGeometry.ts`, tested against the numbers rather than through the
 * page; it sits above `lib/render/page/` because a spec inside it could not import `bun:test`.
 */

import { describe, expect, test } from 'bun:test';
import type {
  ProgressFile,
  Task,
  TaskStatus,
  ViewRange,
} from '../constants/Types.ts';
import type { TimelineLimits } from './page/GanttGeometry.ts';
import { computeTimeline }     from './page/GanttGeometry.ts';

const MILLISECONDS_PER_MINUTE = 60_000;

const EXAMPLE_LIMITS: TimelineLimits = {
  tickStepLadderMinutes:      [5, 10, 15, 30, 60, 120, 180, 360, 720, 1440],
  maximumTicksPerAxis:        12,
  axisMinimumSpanMinutes:     60,
  axisPaddingMinutes:         15,
  minimumBarWidthPercent:     0.6,
  hoursAxisLabelLimitMinutes: 1440,
  weekAxisLabelLimitMinutes:  10_080,
  hourMinutes:                60,
  dayMinutes:                 1440,
  tickCountSafetyBound:       500,
};

const EXAMPLE_START_EPOCH_MILLISECONDS = Date.UTC(2026, 8, 18, 18, 0, 0);

function minutesAsMilliseconds(count: number): number {
  return count * MILLISECONDS_PER_MINUTE;
}

function timestampAt(offsetMinutes: number): string {
  return new Date(EXAMPLE_START_EPOCH_MILLISECONDS + minutesAsMilliseconds(offsetMinutes)).toISOString();
}

function exampleTask(id: number, startOffsetMinutes: number | null, endOffsetMinutes: number | null, status: TaskStatus = 'finished'): Task {
  return {
    id,
    name:   `Example task ${id}`,
    status,
    start:  startOffsetMinutes === null ? null : timestampAt(startOffsetMinutes),
    end:    endOffsetMinutes === null ? null : timestampAt(endOffsetMinutes),
    owner:  'Alex Example',
    note:   '',
    ticket: null,
    tokens: null,
  };
}

function exampleProgress(tasks: Task[], view: ViewRange = { kind: 'auto' }): ProgressFile {
  return {
    version:    1,
    trackerId:  'example-tracker',
    project:    'Example Agency',
    startedAt:  timestampAt(0),
    nextTaskId: 99,
    view,
    tasks,
    log:        [],
  };
}

function absoluteRange(fromOffsetMinutes: number, toOffsetMinutes: number, tickMinutes: number | null = null): ViewRange {
  return {
    kind: 'absolute',
    from: timestampAt(fromOffsetMinutes),
    to:   timestampAt(toOffsetMinutes),
    tickMinutes,
  };
}

function timelineFor(input: { tasks: Task[]; range?: ViewRange; nowOffsetMinutes: number }): ReturnType<typeof computeTimeline> {
  const range = input.range ?? { kind: 'auto' };
  return computeTimeline({
    progress:             exampleProgress(input.tasks, range),
    range,
    nowEpochMilliseconds: EXAMPLE_START_EPOCH_MILLISECONDS + minutesAsMilliseconds(input.nowOffsetMinutes),
    limits:               EXAMPLE_LIMITS,
  });
}

function localWallClockMinutesOf(epochMilliseconds: number): number {
  return Math.floor(epochMilliseconds / MILLISECONDS_PER_MINUTE) - new Date(epochMilliseconds).getTimezoneOffset();
}

function tickEpochMillisecondsOf(timeline: ReturnType<typeof computeTimeline>, leftPercent: number): number {
  return timeline.fromEpochMilliseconds + (timeline.toEpochMilliseconds - timeline.fromEpochMilliseconds) * leftPercent / 100;
}

describe('computeTimeline', () => {
  // The frozen example from the Python predecessor's renderer; retake it by re-deriving the fractions by hand.
  test('places a task running from ten to twenty minutes one sixth into a sixty-minute axis, one sixth wide', () => {
    const timeline = timelineFor({ tasks: [exampleTask(1, 10, 20), exampleTask(2, 0, 5)], nowOffsetMinutes: 20 });
    const [bar]    = timeline.bars;

    expect(timeline.toEpochMilliseconds - timeline.fromEpochMilliseconds).toBe(minutesAsMilliseconds(60));
    expect(bar?.visible).toBe(true);
    expect(bar?.leftPercent.toFixed(2)).toBe('16.67');
    expect(bar?.widthPercent.toFixed(2)).toBe('16.67');
    expect(bar?.clippedLeft).toBe(false);
    expect(bar?.clippedRight).toBe(false);
    expect(timeline.nowPercent?.toFixed(2)).toBe('33.33');
  });

  test('grows the automatic axis past its minimum only once the work plus the padding exceeds it', () => {
    const shortTimeline = timelineFor({ tasks: [exampleTask(1, 0, 44)], nowOffsetMinutes: 44 });
    const longTimeline  = timelineFor({ tasks: [exampleTask(1, 0, 90)], nowOffsetMinutes: 90 });

    expect(shortTimeline.toEpochMilliseconds - shortTimeline.fromEpochMilliseconds).toBe(minutesAsMilliseconds(60));
    expect(longTimeline.toEpochMilliseconds - longTimeline.fromEpochMilliseconds).toBe(minutesAsMilliseconds(105));
  });

  test('starts the automatic axis at the earliest task, not at a startedAt that was reset after it', () => {
    const timeline = timelineFor({ tasks: [exampleTask(1, -180, -60)], nowOffsetMinutes: 10 });
    const [bar]    = timeline.bars;

    expect(timeline.fromEpochMilliseconds).toBe(EXAMPLE_START_EPOCH_MILLISECONDS + minutesAsMilliseconds(-180));
    expect(bar?.leftPercent).toBe(0);
    expect(bar?.clippedLeft).toBe(false);
    expect(bar?.widthPercent).toBeGreaterThan(EXAMPLE_LIMITS.minimumBarWidthPercent);
  });

  test('starts the automatic axis at the earliest task even when every task starts after startedAt', () => {
    const timeline = timelineFor({ tasks: [exampleTask(1, 20, 40)], nowOffsetMinutes: 40 });

    expect(timeline.fromEpochMilliseconds).toBe(EXAMPLE_START_EPOCH_MILLISECONDS + minutesAsMilliseconds(20));
  });

  // The page hands in only the visible rows; a startedAt ten days back must not stretch the axis once the old work is hidden.
  test('starts a ten-day-old tracker at its earliest visible row, not at startedAt', () => {
    const tenDaysMinutes = 10 * 1440;
    const timeline       = timelineFor({
      tasks:            [exampleTask(1, tenDaysMinutes - 180, tenDaysMinutes - 120), exampleTask(2, tenDaysMinutes - 60, null, 'running')],
      nowOffsetMinutes: tenDaysMinutes,
    });

    expect(timeline.fromEpochMilliseconds).toBe(EXAMPLE_START_EPOCH_MILLISECONDS + minutesAsMilliseconds(tenDaysMinutes - 180));
    expect(timeline.stepMinutes).toBe(30);
  });

  test('falls back to startedAt when no visible row has started', () => {
    const timeline = timelineFor({ tasks: [exampleTask(1, null, null, 'pending')], nowOffsetMinutes: 40 });

    expect(timeline.fromEpochMilliseconds).toBe(EXAMPLE_START_EPOCH_MILLISECONDS);
  });

  test('counts a task start beyond every recorded end towards the automatic horizon', () => {
    const timeline = timelineFor({ tasks: [exampleTask(1, 0, 5), exampleTask(2, 200, null, 'running')], nowOffsetMinutes: 5 });

    expect(timeline.toEpochMilliseconds - timeline.fromEpochMilliseconds).toBe(minutesAsMilliseconds(215));
  });

  test('marks a bar that overruns both edges as clipped on both sides and fills the axis', () => {
    const timeline = timelineFor({ tasks: [exampleTask(1, -30, 150)], range: absoluteRange(0, 60), nowOffsetMinutes: 30 });
    const [bar]    = timeline.bars;

    expect(bar?.clippedLeft).toBe(true);
    expect(bar?.clippedRight).toBe(true);
    expect(bar?.leftPercent).toBe(0);
    expect(bar?.widthPercent).toBe(100);
  });

  test('clips only the side a bar overruns', () => {
    const timeline = timelineFor({ tasks: [exampleTask(1, -30, 10), exampleTask(2, 50, 150)], range: absoluteRange(0, 60), nowOffsetMinutes: 30 });
    const [leftBar, rightBar] = timeline.bars;

    expect(leftBar?.clippedLeft).toBe(true);
    expect(leftBar?.clippedRight).toBe(false);
    expect(leftBar?.leftPercent).toBe(0);
    expect(leftBar?.widthPercent.toFixed(2)).toBe('16.67');
    expect(rightBar?.clippedLeft).toBe(false);
    expect(rightBar?.clippedRight).toBe(true);
    expect(rightBar?.widthPercent.toFixed(2)).toBe('16.67');
  });

  test('pins a bar that lies entirely outside the range against the edge it fell off, still clipped', () => {
    const timeline = timelineFor({ tasks: [exampleTask(1, 120, 130)], range: absoluteRange(0, 60), nowOffsetMinutes: 30 });
    const [bar]    = timeline.bars;

    expect(bar?.visible).toBe(true);
    expect(bar?.clippedRight).toBe(true);
    expect(bar?.widthPercent).toBe(EXAMPLE_LIMITS.minimumBarWidthPercent);
    expect(bar?.leftPercent).toBeCloseTo(100 - EXAMPLE_LIMITS.minimumBarWidthPercent, 10);
  });

  test('floors a zero-length bar at the minimum width so an instant task is still findable', () => {
    const timeline = timelineFor({ tasks: [exampleTask(1, 30, 30)], range: absoluteRange(0, 60), nowOffsetMinutes: 30 });
    const [bar]    = timeline.bars;

    expect(bar?.widthPercent).toBe(EXAMPLE_LIMITS.minimumBarWidthPercent);
    expect(bar?.leftPercent).toBe(50);
  });

  test('extends a started task with no recorded end to now', () => {
    const timeline = timelineFor({ tasks: [exampleTask(1, 0, null, 'running')], range: absoluteRange(0, 60), nowOffsetMinutes: 30 });
    const [bar]    = timeline.bars;

    expect(bar?.widthPercent).toBe(50);
  });

  test('draws an end that precedes its start as a zero-length bar rather than backwards', () => {
    const timeline = timelineFor({ tasks: [exampleTask(1, 40, 10)], range: absoluteRange(0, 60), nowOffsetMinutes: 30 });
    const [bar]    = timeline.bars;

    expect(bar?.leftPercent).toBeCloseTo(100 * 40 / 60, 10);
    expect(bar?.widthPercent).toBe(EXAMPLE_LIMITS.minimumBarWidthPercent);
  });

  test('hides a task that has never started instead of placing it at the origin', () => {
    const timeline = timelineFor({ tasks: [exampleTask(1, null, null, 'pending')], nowOffsetMinutes: 30 });
    const [bar]    = timeline.bars;

    expect(bar?.visible).toBe(false);
    expect(bar?.leftPercent).toBe(0);
    expect(bar?.widthPercent).toBe(0);
  });

  test('still produces an axis when every timestamp is null', () => {
    const timeline = timelineFor({ tasks: [exampleTask(1, null, null, 'pending'), exampleTask(2, null, null, 'pending')], nowOffsetMinutes: 10 });

    expect(timeline.toEpochMilliseconds - timeline.fromEpochMilliseconds).toBe(minutesAsMilliseconds(60));
    expect(timeline.ticks.length).toBeGreaterThan(0);
    expect(timeline.bars.every((bar) => !bar.visible)).toBe(true);
  });

  test.each([
    [60, 5],
    [61, 10],
    [180, 15],
    [360, 30],
    [720, 60],
    [1440, 120],
    [10_080, 1440],
  ])('gives a span of %i minutes a tick step of %i minutes', (spanMinutes, expectedStepMinutes) => {
    const timeline = timelineFor({ tasks: [], range: absoluteRange(0, spanMinutes), nowOffsetMinutes: 0 });

    expect(timeline.stepMinutes).toBe(expectedStepMinutes);
    expect(timeline.ticks.length).toBeLessThanOrEqual(EXAMPLE_LIMITS.maximumTicksPerAxis + 1);
  });

  test('falls back to a whole number of days once the ladder runs out', () => {
    const timeline = timelineFor({ tasks: [], range: absoluteRange(0, 14 * 1440), nowOffsetMinutes: 0 });

    expect(timeline.stepMinutes).toBe(2880);
  });

  test('honours an explicit tick step even when the ladder would have chosen another', () => {
    const timeline = timelineFor({ tasks: [], range: absoluteRange(0, 60, 15), nowOffsetMinutes: 0 });

    expect(timeline.stepMinutes).toBe(15);
    for (const tick of timeline.ticks) {
      expect(localWallClockMinutesOf(tickEpochMillisecondsOf(timeline, tick.leftPercent)) % 15).toBe(0);
    }
  });

  test('truncates an explicit tick step that would flood the axis', () => {
    const timeline = timelineFor({ tasks: [], range: absoluteRange(0, 7 * 1440, 1), nowOffsetMinutes: 0 });

    expect(timeline.ticks.length).toBe(EXAMPLE_LIMITS.tickCountSafetyBound);
  });

  test('starts the ticks at a round time on the local wall clock, not on UTC', () => {
    const timeline = timelineFor({ tasks: [], range: absoluteRange(7, 67), nowOffsetMinutes: 0 });

    expect(timeline.ticks.length).toBeGreaterThan(0);
    for (const tick of timeline.ticks) {
      expect(localWallClockMinutesOf(tickEpochMillisecondsOf(timeline, tick.leftPercent)) % timeline.stepMinutes).toBe(0);
    }
    expect(timeline.ticks[0]?.leftPercent).toBeGreaterThan(0);
  });

  test.each([
    [360, /^\d{2}:\d{2}$/],
    [1440, /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d{2}:\d{2}$/],
    [3 * 1440, /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d{2}:\d{2}$/],
    [30 * 1440, /^\d{2}-\d{2}$/],
  ])('labels a %i-minute axis in the format its span calls for', (spanMinutes, expectedShape) => {
    const timeline = timelineFor({ tasks: [], range: absoluteRange(0, spanMinutes), nowOffsetMinutes: 0 });

    expect(timeline.ticks.length).toBeGreaterThan(0);
    for (const tick of timeline.ticks) {
      expect(tick.label).toMatch(expectedShape);
    }
  });

  test('resolves a relative range against now and the tracker start rather than storing absolute times', () => {
    const timeline = timelineFor({
      tasks: [],
      range: {
        kind: 'relative', from: '-2h', to: 'now', tickMinutes: null 
      },
      nowOffsetMinutes: 300 
    });

    expect(timeline.fromEpochMilliseconds).toBe(EXAMPLE_START_EPOCH_MILLISECONDS + minutesAsMilliseconds(180));
    expect(timeline.toEpochMilliseconds).toBe(EXAMPLE_START_EPOCH_MILLISECONDS + minutesAsMilliseconds(300));
  });

  test('reads `start` as the tracker start and a positive offset as time past now', () => {
    const timeline = timelineFor({
      tasks: [],
      range: {
        kind: 'relative', from: 'start', to: '+30m', tickMinutes: null 
      },
      nowOffsetMinutes: 90 
    });

    expect(timeline.fromEpochMilliseconds).toBe(EXAMPLE_START_EPOCH_MILLISECONDS);
    expect(timeline.toEpochMilliseconds).toBe(EXAMPLE_START_EPOCH_MILLISECONDS + minutesAsMilliseconds(120));
    expect(timeline.nowPercent).toBe(75);
  });

  // The "All" preset is `start` → `now`; backfilled or re-seeded rows begin before the tracker start.
  test('reads `start` as the earliest row start when a row began before the tracker start', () => {
    const timeline = timelineFor({
      tasks: [exampleTask(1, -150, -60)],
      range: {
        kind: 'relative', from: 'start', to: 'now', tickMinutes: null
      },
      nowOffsetMinutes: 30
    });

    expect(timeline.fromEpochMilliseconds).toBe(EXAMPLE_START_EPOCH_MILLISECONDS - minutesAsMilliseconds(150));
    expect(timeline.bars[0]?.leftPercent).toBe(0);
    expect(timeline.bars[0]?.clippedLeft).toBe(false);
  });

  test('reads an absolute range as the two timestamps it names', () => {
    const timeline = timelineFor({ tasks: [], range: absoluteRange(30, 90), nowOffsetMinutes: 60 });

    expect(timeline.fromEpochMilliseconds).toBe(EXAMPLE_START_EPOCH_MILLISECONDS + minutesAsMilliseconds(30));
    expect(timeline.toEpochMilliseconds).toBe(EXAMPLE_START_EPOCH_MILLISECONDS + minutesAsMilliseconds(90));
    expect(timeline.nowPercent).toBe(50);
  });

  test('reads an offsetless timestamp as local wall-clock time', () => {
    const timeline = computeTimeline({
      progress: exampleProgress([]),
      range:    {
        kind: 'absolute', from: '2026-09-18T08:00', to: '2026-09-18T09:00', tickMinutes: null 
      },
      nowEpochMilliseconds: EXAMPLE_START_EPOCH_MILLISECONDS,
      limits:               EXAMPLE_LIMITS,
    });

    expect(timeline.fromEpochMilliseconds).toBe(new Date(2026, 8, 18, 8, 0, 0).getTime());
    expect(timeline.toEpochMilliseconds - timeline.fromEpochMilliseconds).toBe(minutesAsMilliseconds(60));
  });

  test('falls back to the automatic axis when a stored range cannot be read', () => {
    const timeline = timelineFor({
      tasks: [exampleTask(1, 0, 90)],
      range: {
        kind: 'absolute', from: 'not a time', to: 'also not', tickMinutes: null 
      },
      nowOffsetMinutes: 90 
    });

    expect(timeline.fromEpochMilliseconds).toBe(EXAMPLE_START_EPOCH_MILLISECONDS);
    expect(timeline.toEpochMilliseconds - timeline.fromEpochMilliseconds).toBe(minutesAsMilliseconds(105));
  });

  test('widens an inverted range to the minimum span instead of dividing by zero', () => {
    const timeline = timelineFor({ tasks: [exampleTask(1, 0, 30)], range: absoluteRange(90, 30), nowOffsetMinutes: 30 });

    expect(timeline.toEpochMilliseconds - timeline.fromEpochMilliseconds).toBe(minutesAsMilliseconds(60));
    expect(timeline.bars[0]?.widthPercent).toBe(EXAMPLE_LIMITS.minimumBarWidthPercent);
  });

  test('reports no now-marker when the present moment falls outside the range', () => {
    const beforeRange = timelineFor({ tasks: [], range: absoluteRange(60, 120), nowOffsetMinutes: 0 });
    const afterRange  = timelineFor({ tasks: [], range: absoluteRange(0, 60), nowOffsetMinutes: 600 });

    expect(beforeRange.nowPercent).toBeNull();
    expect(afterRange.nowPercent).toBeNull();
  });
});
