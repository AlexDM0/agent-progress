import { HtmlEscapeUtil }             from '../../src/lib/html-escape/HtmlEscapeUtil.ts';
import type { SourceUnreadableEntry } from '../../src/lib/spec-snapshot/@types/SpecSnapshotSource.ts';

/** One list item per spec-kit entry the scan could not read: its path, its reason and, when known, its line. */
export function unreadableEntriesMarkup(entries: readonly SourceUnreadableEntry[]): string {
  return entries.map((entry) => {
    const lineText = entry.line === null ? '' : ` (line ${entry.line})`;
    return `<li><code>${HtmlEscapeUtil.escapeHtml(entry.relativePath)}</code> ${HtmlEscapeUtil.escapeHtml(`${entry.reason}${lineText}`)}</li>`;
  }).join('');
}
