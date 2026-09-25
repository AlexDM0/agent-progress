/**
 * The app-wide numbers: tuning bounds, plus the time units and stamp-format offsets the page shares.
 * It imports nothing, so the page's project (`lib/render/page/tsconfig.json`) compiles it too.
 */
export const LIMITS = {
  LOCK_STALE_MILLISECONDS:            30_000,
  LOCK_RETRY_COUNT:                   50,
  LOCK_RETRY_INTERVAL_MILLISECONDS:   100,
  TICK_STEP_LADDER_MINUTES:           [5, 10, 15, 30, 60, 120, 180, 360, 720, 1440],
  MAXIMUM_TICKS_PER_AXIS:             12,
  AXIS_MINIMUM_SPAN_MINUTES:          60,
  AXIS_PADDING_MINUTES:               15,
  MINIMUM_BAR_WIDTH_PERCENT:          0.6,
  TICKET_ID_DIGITS:                   3,
  // The page hides tasks and tickets that have been done for longer than this, until the viewer asks for all of them.
  DONE_WORK_VISIBLE_MILLISECONDS:     86_400_000,
  HOUR_MINUTES:                       60,
  DAY_MINUTES:                        1440,
  HOURS_AXIS_LABEL_LIMIT_MINUTES:     1440,
  WEEK_AXIS_LABEL_LIMIT_MINUTES:      10_080,
  // The axis truncates past this rather than refusing: a crowded axis is cosmetic, a page that stops responding is not.
  TICK_COUNT_SAFETY_BOUND:            500,
  // A stored timestamp is sliced, never re-parsed, so a reader in another zone is never shown a time nobody recorded.
  DATE_AND_CLOCK_LENGTH:              16,
  CALENDAR_DATE_LENGTH:               10,
  MONTH_AND_DAY_SLICE_START:          5,
  CLOCK_SLICE_START:                  11,
  CLOCK_SLICE_END:                    16,
  JSON_INDENT:                        2,
  // The round a row reaches the first time its ticket is sent back for review again; the first pass is round 1 and records no number.
  FIRST_REPEAT_REVIEW_ROUND:          2,
  // A call above this context counts as oversized: a brief asks an agent to hand its work on rather than let its window grow past it.
  OVERSIZED_CONTEXT_THRESHOLD_TOKENS: 200_000,
  // What a tracker that never set a limit reads: the two-slot dispatch the orchestrate skill was written around.
  DEFAULT_CONCURRENCY_LIMIT:          2,
  // The most agents allowed in flight at once: `concurrency` refuses a higher limit, and a higher stored one reads as this.
  CONCURRENCY_LIMIT_CEILING_AGENTS:   10,
} as const;
