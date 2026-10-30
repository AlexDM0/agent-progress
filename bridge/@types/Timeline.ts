import type { TaskPhase, TaskStatus }      from '../../src/lib/tracker-model/@types/Task.ts';
import type { TrackerProgress, ViewRange } from '../../src/lib/tracker-model/@types/TrackerProgress.ts';

/** The page payload's `limits` fields the geometry reads, named here so the Bridge needs none of the payload's other types. */
export interface TimelineLimits {
  readonly tickStepLadderMinutes:      readonly number[];
  readonly maximumTicksPerAxis:        number;
  readonly axisMinimumSpanMinutes:     number;
  readonly axisPaddingMinutes:         number;
  readonly minimumBarWidthPercent:     number;
  readonly hoursAxisLabelLimitMinutes: number;
  readonly weekAxisLabelLimitMinutes:  number;
  readonly hourMinutes:                number;
  readonly dayMinutes:                 number;
  readonly tickCountSafetyBound:       number;
}

export interface TimelineTick {
  leftPercent: number;
  label:       string;
}

export interface TimelineBarPhase {
  status:       TaskStatus;
  leftPercent:  number;
  widthPercent: number;
  /** The open row's last phase, still running. */
  isLive:       boolean;
}

export interface TimelineBar {
  /** The row's task id, null for a row that has none. */
  taskId:       number | null;
  leftPercent:  number;
  widthPercent: number;
  clippedLeft:  boolean;
  clippedRight: boolean;
  visible:      boolean;
  /** The recorded phases the bar covers, oldest first, together spanning the bar exactly; empty for a hidden bar or a row with none. */
  phases:       readonly TimelineBarPhase[];
}

export interface Timeline {
  fromEpochMilliseconds: number;
  toEpochMilliseconds:   number;
  stepMinutes:           number;
  ticks:                 TimelineTick[];
  bars:                  TimelineBar[];
  nowPercent:            number | null;
}

export interface ResolvedSpan {
  fromEpochMilliseconds: number;
  toEpochMilliseconds:   number;
}

/** What the geometry reads of one chart row: a tracker task, or any row with a start and an end. */
export interface TimelineRowSource {
  id?:      number;
  start:    string | null;
  end:      string | null;
  history?: readonly TaskPhase[];
}

/** What the geometry reads of the chart: the moment the work started, and its rows. */
export interface TimelineSource {
  startedAt: string;
  tasks:     readonly TimelineRowSource[];
}

export interface TimelineInput {
  /** A tracker's progress is named beside the source it satisfies, so a literal one is not refused for its other keys. */
  progress:             TimelineSource | TrackerProgress;
  range:                ViewRange;
  nowEpochMilliseconds: number;
  limits:               TimelineLimits;
}

export interface HorizontalExtent {
  left:  number;
  right: number;
}
