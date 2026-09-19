/**
 * The tuning decisions: every number that is a bound rather than a fact. This file imports nothing,
 * so the browser page's project (`lib/render/page/tsconfig.json`) compiles it too.
 */

export const LOCK_STALE_MILLISECONDS = 30_000;

export const LOCK_RETRY_COUNT = 50;

export const LOCK_RETRY_INTERVAL_MILLISECONDS = 100;

export const TICK_STEP_LADDER_MINUTES = [5, 10, 15, 30, 60, 120, 180, 360, 720, 1440] as const;

export const MAXIMUM_TICKS_PER_AXIS = 12;

export const AXIS_MINIMUM_SPAN_MINUTES = 60;

export const AXIS_PADDING_MINUTES = 15;

export const MINIMUM_BAR_WIDTH_PERCENT = 0.6;

export const TICKET_ID_DIGITS = 3;

/** The page hides tasks and tickets that have been done for longer than this, until the viewer asks for all of them. */
export const DONE_WORK_VISIBLE_MILLISECONDS = 86_400_000;

export const HOUR_MINUTES = 60;

export const DAY_MINUTES = 1440;

export const HOURS_AXIS_LABEL_LIMIT_MINUTES = 1440;

export const WEEK_AXIS_LABEL_LIMIT_MINUTES = 10_080;

/** The axis truncates past this rather than refusing: a crowded axis is cosmetic, a page that stops responding is not. */
export const TICK_COUNT_SAFETY_BOUND = 500;

/** A stored timestamp is sliced, never re-parsed, so a reader in another zone is never shown a time nobody recorded. */
export const DATE_AND_CLOCK_LENGTH = 16;

export const CALENDAR_DATE_LENGTH = 10;

export const MONTH_AND_DAY_SLICE_START = 5;

export const CLOCK_SLICE_START = 11;

export const CLOCK_SLICE_END = 16;

export const JSON_INDENT = 2;
