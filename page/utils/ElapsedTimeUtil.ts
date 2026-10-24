/** How long an agent has been at work, in the seconds-precise words the activity banner and the live Kanban cards share. */

import type { DurationUnits } from './TimeUtil.ts';

const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE      = 60;

function padToTwoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

/** `42s`, `4m 12s`, `1h 02m 17s`; a start after the reference moment, which a skewed clock can give, reads as `0s`. */
function formatElapsed(milliseconds: number, units: DurationUnits): string {
  const totalSeconds   = Math.max(0, Math.floor(milliseconds / MILLISECONDS_PER_SECOND));
  const secondsPerHour = units.hourMinutes * SECONDS_PER_MINUTE;
  const hours          = Math.floor(totalSeconds / secondsPerHour);
  const minutes        = Math.floor((totalSeconds % secondsPerHour) / SECONDS_PER_MINUTE);
  const seconds        = totalSeconds % SECONDS_PER_MINUTE;
  if (hours > 0) {
    return `${hours}h ${padToTwoDigits(minutes)}m ${padToTwoDigits(seconds)}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${padToTwoDigits(seconds)}s`;
  }
  return `${seconds}s`;
}

/** "building 2h 36m 13s": the label, then the time from the start to the reference moment. */
function labelledElapsedTextOf(label: string, startEpochMilliseconds: number, referenceEpochMilliseconds: number, units: DurationUnits): string {
  return `${label} ${formatElapsed(referenceEpochMilliseconds - startEpochMilliseconds, units)}`;
}

export const ElapsedTimeUtil = {
  formatElapsed,
  labelledElapsedTextOf,
} as const;
