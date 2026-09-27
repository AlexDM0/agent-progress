import { PERCENT_OF_A_WHOLE }           from '../../constants/Units.ts';
import { TimeUtil, type DurationUnits } from '../../utils/TimeUtil.ts';
import type { TicketTimelineAxis }      from '../@types/TicketTimeline.ts';

function percentAlong(axis: TicketTimelineAxis, epochMilliseconds: number): number {
  return (epochMilliseconds - axis.fromEpochMilliseconds) / (axis.toEpochMilliseconds - axis.fromEpochMilliseconds) * PERCENT_OF_A_WHOLE;
}

function durationTextOf(milliseconds: number, units: DurationUnits): string {
  return TimeUtil.formatDuration(milliseconds, units) ?? '';
}

export const TicketTimelineUtil = { percentAlong, durationTextOf } as const;
