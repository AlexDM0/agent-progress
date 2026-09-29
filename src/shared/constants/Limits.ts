/** The app-wide tuning bounds. */
export const LIMITS = {
  LOCK_STALE_MILLISECONDS:            30_000,
  LOCK_RETRY_COUNT:                   50,
  LOCK_RETRY_INTERVAL_MILLISECONDS:   100,
  TICK_STEP_LADDER_MINUTES:           [5, 10, 15, 30, 60, 120, 180, 360, 720, 1440],
  MAXIMUM_TICKS_PER_AXIS:             12,
  AXIS_MINIMUM_SPAN_MINUTES:          60,
  AXIS_PADDING_MINUTES:               15,
  MINIMUM_BAR_WIDTH_PERCENT:          0.6,
  HOURS_AXIS_LABEL_LIMIT_MINUTES:     1440,
  WEEK_AXIS_LABEL_LIMIT_MINUTES:      10_080,
  // The axis truncates past this rather than refusing: a crowded axis is cosmetic, a page that stops responding is not.
  TICK_COUNT_SAFETY_BOUND:            500,
  // A call above this context counts as oversized: a brief asks an agent to hand its work on rather than let its window grow past it.
  OVERSIZED_CONTEXT_THRESHOLD_TOKENS: 200_000,
} as const;
