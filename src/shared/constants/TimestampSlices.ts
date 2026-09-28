/** Where a stored stamp is cut: it is sliced, never re-parsed, so a reader in another zone is never shown a time nobody recorded. */
export const TIMESTAMP_SLICES = {
  DATE_AND_CLOCK_LENGTH_CHARACTERS:           16,
  CALENDAR_DATE_LENGTH_CHARACTERS:            10,
  MONTH_AND_DAY_SLICE_START_CHARACTER_OFFSET: 5,
  CLOCK_SLICE_START_CHARACTER_OFFSET:         11,
  CLOCK_SLICE_END_CHARACTER_OFFSET:           16,
} as const;
