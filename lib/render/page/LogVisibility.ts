/** How much of the log the page's log card shows: the newest entries by default, the whole log once the viewer asks for it. */

export type LogVisibility = 'newest' | 'all';

export const DEFAULT_LOG_VISIBILITY: LogVisibility = 'newest';

export const LOG_ENTRIES_SHOWN_BY_DEFAULT = 10;

export function logVisibilityFrom(value: unknown): LogVisibility {
  return value === 'all' ? 'all' : DEFAULT_LOG_VISIBILITY;
}

export function toggledLogVisibility(visibility: LogVisibility): LogVisibility {
  return visibility === 'all' ? 'newest' : 'all';
}

export function logVisibilityStorageKeyFor(trackerId: string): string {
  return `agent-progress:${trackerId}:log`;
}

export function logControlIsNeeded(entryCount: number): boolean {
  return entryCount > LOG_ENTRIES_SHOWN_BY_DEFAULT;
}

/** `null` means every entry: a log short enough to need no control is never cut. */
export function logEntryLimitFor(visibility: LogVisibility): number | null {
  return visibility === 'all' ? null : LOG_ENTRIES_SHOWN_BY_DEFAULT;
}

export function logControlText(entryCount: number): string {
  return `Show all ${entryCount}`;
}

export function logNoteText(entryCount: number, visibility: LogVisibility): string {
  if (!logControlIsNeeded(entryCount) || visibility === 'all') {
    return 'newest first';
  }
  return `newest ${LOG_ENTRIES_SHOWN_BY_DEFAULT} of ${entryCount}, ${entryCount - LOG_ENTRIES_SHOWN_BY_DEFAULT} hidden`;
}
