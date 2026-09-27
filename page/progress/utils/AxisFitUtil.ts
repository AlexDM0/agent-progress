/** How many pixels the Progress chart's axis needs for its tick labels, and whether a label near the right edge must sit left of its line. */

import type { TimelineTick }        from '../../@types/Timeline.ts';
import { TICK_LABEL_GUTTER_PIXELS } from '../constants/ProgressChart.ts';

const TICK_MINIMUM_PIXELS             = 60;
const TICK_PIXELS_PER_LABEL_CHARACTER = 9;

function axisPixelsNeededFor(ticks: readonly TimelineTick[]): number {
  const longestLabel  = ticks.reduce((longest, tick) => Math.max(longest, tick.label.length), 0);
  const perTickPixels = Math.max(TICK_MINIMUM_PIXELS, longestLabel * TICK_PIXELS_PER_LABEL_CHARACTER);
  return ticks.length * perTickPixels;
}

function labelSitsLeftOfItsLine(tick: TimelineTick, axisWidthPixels: number): boolean {
  const remainingPixels = axisWidthPixels * (100 - tick.leftPercent) / 100;
  return remainingPixels < tick.label.length * TICK_PIXELS_PER_LABEL_CHARACTER + TICK_LABEL_GUTTER_PIXELS;
}

export const AxisFitUtil = { axisPixelsNeededFor, labelSitsLeftOfItsLine } as const;
