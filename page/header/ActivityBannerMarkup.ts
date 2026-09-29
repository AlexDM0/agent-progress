/** The activity banner's rows, one per running agent, or its idle line. */

import { HtmlEscapeUtil }                   from '../../src/lib/html-escape/HtmlEscapeUtil.ts';
import type { DisplayState }                from '../../src/lib/tracker-model/@types/Task.ts';
import { MarkupUtil }                       from '../utils/MarkupUtil.ts';
import type { DurationUnits }               from '../utils/TimeUtil.ts';
import type { ActivityEntry, ActivityKind } from './utils/ActivityBannerUtil.ts';
import { ActivityBannerUtil }               from './utils/ActivityBannerUtil.ts';

export const IDLE_ACTIVITY_TEXT = 'No agent is working right now.';

const KIND_LABELS: Readonly<Record<ActivityKind, string>> = { building: 'Building', reviewing: 'Reviewing' };

/** The chart's and Kanban's state colours, so a running agent looks the same everywhere. */
const KIND_STATES: Readonly<Record<ActivityKind, DisplayState>> = { building: 'in-progress', reviewing: 'reviewing' };

/** The elapsed time is hidden from assistive technology: the banner is a live region, and a tick must never be announced. */
function activityRowMarkup(entry: ActivityEntry, referenceEpochMilliseconds: number, units: DurationUnits): string {
  const ticketMarkup = entry.ticketId === null ? '' : `<span class="ap-activity-id">#${HtmlEscapeUtil.escapeHtml(entry.ticketId)}</span>`;
  const elapsedText  = ActivityBannerUtil.elapsedTextOf(entry, referenceEpochMilliseconds, units);
  return `<div class="ap-activity-row" ${MarkupUtil.attribute('data-state', KIND_STATES[entry.kind])}>`
    + '<span class="ap-activity-dot" aria-hidden="true"></span>'
    + `<span class="ap-activity-kind">${KIND_LABELS[entry.kind]}</span>`
    + ticketMarkup
    + `<span class="ap-activity-title" ${MarkupUtil.attribute('title', entry.title)}>${HtmlEscapeUtil.escapeHtml(entry.title)}</span>`
    + `<span class="ap-activity-elapsed" aria-hidden="true">${HtmlEscapeUtil.escapeHtml(elapsedText)}</span>`
    + '</div>';
}

export function activityBannerMarkup(entries: readonly ActivityEntry[], referenceEpochMilliseconds: number, units: DurationUnits): string {
  if (entries.length === 0) {
    return `<div class="ap-activity-idle">${IDLE_ACTIVITY_TEXT}</div>`;
  }
  return entries.map((entry) => activityRowMarkup(entry, referenceEpochMilliseconds, units)).join('');
}
