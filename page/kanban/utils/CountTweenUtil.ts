/** The figures a changed Kanban lane count shows on its way from the old value to the new, timed by a motion token of the template. */

const MILLISECONDS_PER_SECOND = 1000;
const DURATION_PATTERN        = /^(\d+(?:\.\d+)?)(ms|s)$/;

/** A token that is empty or no CSS time reads as 0, which shows the final figure at once. */
function durationMillisecondsOf(tokenValue: string): number {
  const match = DURATION_PATTERN.exec(tokenValue.trim());
  if (match === null) {
    return 0;
  }
  const amount = Number(match[1] ?? '0');
  return match[2] === 's' ? amount * MILLISECONDS_PER_SECOND : amount;
}

/** Ease-out cubic over the elapsed share of the duration; a duration of 0 is already finished. */
function easedProgressOf(elapsedMilliseconds: number, durationMilliseconds: number): number {
  if (durationMilliseconds <= 0) {
    return 1;
  }
  const linearProgress = Math.min(1, Math.max(0, elapsedMilliseconds / durationMilliseconds));
  return 1 - (1 - linearProgress) ** 3;
}

function countAt(fromCount: number, toCount: number, easedProgress: number): number {
  return Math.round(fromCount + (toCount - fromCount) * easedProgress);
}

export const CountTweenUtil = { durationMillisecondsOf, easedProgressOf, countAt } as const;
