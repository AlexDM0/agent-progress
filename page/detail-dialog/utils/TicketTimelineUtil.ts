import { TimeUtil, type DurationUnits } from '../../utils/TimeUtil.ts';
import type { TicketTimelineAxis }      from '../@types/TicketTimeline.ts';

function percentAlong(axis: TicketTimelineAxis, epochMilliseconds: number): number {
  return (epochMilliseconds - axis.fromEpochMilliseconds) / (axis.toEpochMilliseconds - axis.fromEpochMilliseconds) * 100;
}

function durationTextOf(milliseconds: number, units: DurationUnits): string {
  return TimeUtil.formatDuration(milliseconds, units) ?? '';
}

export const TicketTimelineUtil = { percentAlong, durationTextOf } as const;
