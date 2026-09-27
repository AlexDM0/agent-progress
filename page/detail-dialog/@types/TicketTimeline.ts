import type { DisplayState, Task }           from '../../../src/lib/tracker-model/@types/Task.ts';
import type { PageTicket }                   from '../../../src/shared/@types/PagePayload.ts';
import type { TimelineLimits, TimelineTick } from '../../@types/Timeline.ts';
import type { TimestampSlices }              from '../../utils/TimeUtil.ts';

export type TicketTimelineLimits = TimelineLimits & TimestampSlices;

export interface TicketTimelineInput {
  ticket:               PageTicket;
  /** The ticket's own row, the Board's fact. */
  ownRow:               Task | null;
  /** Oldest filed first. */
  reviewBars:           readonly Task[];
  waitingOn:            readonly string[];
  nowEpochMilliseconds: number;
  todayCalendarDate:    string;
  limits:               TicketTimelineLimits;
}

export interface TimelineSpan {
  state:                  DisplayState;
  label:                  string;
  startEpochMilliseconds: number;
  endEpochMilliseconds:   number;
  isLive:                 boolean;
}

export interface ReviewSpan extends TimelineSpan {
  round:  number;
  tokens: number | null;
}

export interface TicketTimelineAxis {
  fromEpochMilliseconds:       number;
  toEpochMilliseconds:         number;
  filedEpochMilliseconds:      number;
  lastMomentEpochMilliseconds: number;
}

export interface LegendEntry {
  state:        DisplayState;
  label:        string;
  durationText: string;
}

export type ClosedTicketState = 'delivered' | 'abandoned';

export interface TimelineEnd {
  closedState: ClosedTicketState | null;
  label:       string;
  leftPercent: number;
}

export interface TicketTimeline {
  axis:          TicketTimelineAxis;
  ticks:         TimelineTick[];
  queue:         TimelineSpan;
  queueTimeText: string;
  ownRowId:      number | null;
  buildSegments: TimelineSpan[];
  buildTimeText: string;
  reviews:       ReviewSpan[];
  afterBuild:    TimelineSpan[];
  legend:        LegendEntry[];
  end:           TimelineEnd;
  note:          string | null;
}
