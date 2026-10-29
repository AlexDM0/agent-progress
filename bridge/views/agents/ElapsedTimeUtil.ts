/** How long ago a stamped moment was, in the seconds-precise words the page's live cards use: `42s`, `4m 12s`, `1h 02m 17s`. */
const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;

function padToTwoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

/** A negative span, which a skewed clock can give, reads as `0s`. */
function formatElapsed(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / MILLISECONDS_PER_SECOND));
  const hours = Math.floor(totalSeconds / SECONDS_PER_HOUR);
  const minutes = Math.floor((totalSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;
  if (hours > 0) return `${hours}h ${padToTwoDigits(minutes)}m ${padToTwoDigits(seconds)}s`;
  if (minutes > 0) return `${minutes}m ${padToTwoDigits(seconds)}s`;
  return `${seconds}s`;
}

/** `null` for a missing or unreadable stamp, which shows no time rather than a wrong one. */
function elapsedSinceText(stamp: string | null, now: Date): string | null {
  if (stamp === null) return null;
  const startedEpochMilliseconds = Date.parse(stamp);
  return Number.isNaN(startedEpochMilliseconds) ? null : formatElapsed(now.getTime() - startedEpochMilliseconds);
}

export const ElapsedTimeUtil = Object.freeze({ formatElapsed, elapsedSinceText });
