import type { ProgressFile, ViewRange } from '../../src/lib/tracker-model/@types/ProgressFile.ts';
import type { PageLimits }              from '../../src/shared/@types/PagePayload.ts';

export type TimelineLimits = Pick<PageLimits, 'tickStepLadderMinutes' | 'maximumTicksPerAxis' | 'axisMinimumSpanMinutes' | 'axisPaddingMinutes'
  | 'minimumBarWidthPercent' | 'hoursAxisLabelLimitMinutes' | 'weekAxisLabelLimitMinutes' | 'hourMinutes' | 'dayMinutes' | 'tickCountSafetyBound'>;

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

export interface ResolvedSpan {
  fromEpochMilliseconds: number;
  toEpochMilliseconds:   number;
}

export interface TimelineInput {
  progress:             ProgressFile;
  range:                ViewRange;
  nowEpochMilliseconds: number;
  limits:               TimelineLimits;
}

export interface HorizontalExtent {
  left:  number;
  right: number;
}
