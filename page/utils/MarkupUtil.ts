/** The markup primitives several parts of the page emit. Every value passes `escapeHtml` exactly once here. */

import { HtmlEscapeUtil }       from '../../src/lib/html-escape/HtmlEscapeUtil.ts';
import type { TimestampSlices } from './TimeUtil.ts';
import { TimeUtil }             from './TimeUtil.ts';


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

export const MarkupUtil = {
  attribute,
  percentText,
  shortenedText,
  shortenedTextMarkup,
  stampMarkup,
} as const;
