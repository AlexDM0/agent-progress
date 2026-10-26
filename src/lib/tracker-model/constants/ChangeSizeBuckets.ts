/** The builder change-size buckets `review-stats` splits on, by the insertions plus deletions the review measured at its start. */

export const CHANGE_SIZE_BUCKETS = ['small', 'medium', 'large', 'oversized'] as const;

export const SMALL_CHANGE_MAXIMUM_CHANGED_LINES = 50;

export const MEDIUM_CHANGE_MAXIMUM_CHANGED_LINES = 200;

export const LARGE_CHANGE_MAXIMUM_CHANGED_LINES = 750;

/** Every bucket but the last is bounded; a change above the last bound is `oversized`. */
export const CHANGE_SIZE_BUCKET_MAXIMUM_CHANGED_LINES = {
  small:     SMALL_CHANGE_MAXIMUM_CHANGED_LINES,
  medium:    MEDIUM_CHANGE_MAXIMUM_CHANGED_LINES,
  large:     LARGE_CHANGE_MAXIMUM_CHANGED_LINES,
  oversized: Number.POSITIVE_INFINITY,
} as const;
