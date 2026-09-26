/** The log's lines, for the log card and the task dialog alike. */

import type { LogEntry }        from '../../src/lib/tracker-model/@types/ProgressFile.ts';
import { HtmlEscapeUtil }       from '../../src/lib/utils/HtmlEscapeUtil.ts';
import { MarkupUtil }           from './MarkupUtil.ts';
import type { TimestampSlices } from './TimeUtil.ts';


/** `entryLimit` keeps the newest that many, `null` all; each stamp is shortened against the viewer's day on its own. */
function logItemsMarkup(entries: readonly LogEntry[], slices: TimestampSlices, todayCalendarDate: string, entryLimit: number | null = null): string {
  // Sorting by stamp is a stated clock exception that decides only the display order, because `--at` backfills.
  // Within one second the later append is the newer line, so the cap never keeps an older one over it.
  return entries
    .map((entry, appendIndex) => ({ entry, appendIndex }))
    .sort((a, b) => b.entry.at.localeCompare(a.entry.at) || b.appendIndex - a.appendIndex)
    .slice(0, entryLimit ?? entries.length)
    .map(({ entry }) => `<li>${MarkupUtil.stampMarkup('time', entry.at, todayCalendarDate, slices)}<span>${HtmlEscapeUtil.escapeHtml(entry.text)}</span></li>`)
    .join('');
}

export const LogMarkupUtil = { logItemsMarkup } as const;
