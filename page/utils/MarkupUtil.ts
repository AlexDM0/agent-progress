/** The markup primitives several parts of the page emit. Every value passes `escapeHtml` exactly once here. */

import { HtmlEscapeUtil }          from '../../src/lib/html-escape/HtmlEscapeUtil.ts';
import type { IdentifiedLogEntry } from '../../src/shared/@types/WordedLogEntry.ts';
import { ticketReferencesIn }      from './NoteNamesTaskOrTicket.ts';
import { TemplateIdUtil }          from './TemplateIdUtil.ts';
import type { TimestampSlices }    from './TimeUtil.ts';
import { TimeUtil }                from './TimeUtil.ts';


const PERCENT_DECIMAL_PLACES = 2;

/** Text shortened for display, and its full form for the hover, or `null` where nothing was shortened. */
export interface ShortenedText {
  text:  string;
  title: string | null;
}

function attribute(name: string, value: string): string {
  return `${name}="${HtmlEscapeUtil.escapeHtml(value)}"`;
}

function percentText(value: number): string {
  return `${value.toFixed(PERCENT_DECIMAL_PLACES)}%`;
}

function shortenedText(text: string, fullText: string): ShortenedText {
  return { text, title: text === fullText ? null : fullText };
}

/** The element carrying a shortened text gets its full form as `title`; an element showing the full form carries none. */
function shortenedTextMarkup(tagName: string, text: string, fullText: string, className = ''): string {
  const classAttribute = className === '' ? '' : ` ${attribute('class', className)}`;
  const titleAttribute = text === fullText ? '' : ` ${attribute('title', fullText)}`;
  return `<${tagName}${classAttribute}${titleAttribute}>${HtmlEscapeUtil.escapeHtml(text)}</${tagName}>`;
}

function stampMarkup(tagName: string, stamp: string, todayCalendarDate: string, slices: TimestampSlices): string {
  return shortenedTextMarkup(tagName, TimeUtil.shortStampText(stamp, todayCalendarDate, slices), TimeUtil.fullStampText(stamp, slices));
}

export interface LogItemsOptions {
  /** The positions, newest first, of the lines to print; every line when absent. */
  shownRange?:      { start: number; end: number };
  /** The tickets a `#N` in a line may link to; no links when absent. */
  linkedTicketIds?: ReadonlySet<string>;
}

/** A record links only the tickets its ids hold; a note, which carries none, links every ticket its sentence names. */
function logTextMarkup(entry: IdentifiedLogEntry, linkedTicketIds: ReadonlySet<string> | undefined): string {
  if (linkedTicketIds === undefined) {
    return HtmlEscapeUtil.escapeHtml(entry.text);
  }
  let markup        = '';
  let consumedIndex = 0;
  for (const reference of ticketReferencesIn(entry.text)) {
    if (!linkedTicketIds.has(reference.ticketId) || (entry.ticketIds !== undefined && !entry.ticketIds.includes(reference.ticketId))) {
      continue;
    }
    const destination = attribute('href', `#${TemplateIdUtil.ticketCardElementIdOf(reference.ticketId)}`);
    const linkText    = HtmlEscapeUtil.escapeHtml(entry.text.slice(reference.start, reference.end));
    const link        = `<a ${destination} ${attribute('data-log-ticket-id', reference.ticketId)}>${linkText}</a>`;
    markup           += `${HtmlEscapeUtil.escapeHtml(entry.text.slice(consumedIndex, reference.start))}${link}`;
    consumedIndex     = reference.end;
  }
  return markup + HtmlEscapeUtil.escapeHtml(entry.text.slice(consumedIndex));
}

/** Each stamp is shortened against the viewer's day on its own. */
function logItemsMarkup(entries: readonly IdentifiedLogEntry[], slices: TimestampSlices, todayCalendarDate: string, options: LogItemsOptions = {}): string {
  // Sorting by stamp is a stated clock exception that decides only the display order, because `--at` backfills.
  // Within one second the later append is the newer line, so a shown range never keeps an older one over it.
  return entries
    .map((entry, appendIndex) => ({ entry, appendIndex }))
    .sort((a, b) => b.entry.at.localeCompare(a.entry.at) || b.appendIndex - a.appendIndex)
    .slice(options.shownRange?.start ?? 0, options.shownRange?.end ?? entries.length)
    .map(({ entry }) => `<li>${stampMarkup('time', entry.at, todayCalendarDate, slices)}<span>${logTextMarkup(entry, options.linkedTicketIds)}</span></li>`)
    .join('');
}

export const MarkupUtil = {
  attribute,
  logItemsMarkup,
  percentText,
  shortenedText,
  shortenedTextMarkup,
  stampMarkup,
} as const;
