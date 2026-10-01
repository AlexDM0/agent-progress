/**
 * Every epic mark the page draws, shaped by the epic markup of `resources/template.html`: the chips, the roll-up's bar, legend and
 * facts, an epic's ticket list, its detail, the Epics tab's cards, the Tickets table's group rows and the epic filter chips. Every value
 * passes `escapeHtml` once, except an epic's `descriptionHtml`, already escaped by `src/services/render/MarkdownRenderer.ts`.
 */

import { HtmlEscapeUtil }                from '../../src/lib/html-escape/HtmlEscapeUtil.ts';
import { TokenCountUtil }                from '../../src/lib/token-count/TokenCountUtil.ts';
import type { TicketStatus }             from '../../src/lib/tracker-model/@types/Ticket.ts';
import { FIRST_REPEAT_REVIEW_ROUND }     from '../../src/lib/tracker-model/constants/ReviewRounds.ts';
import type { PageLimits }               from '../../src/shared/@types/PagePayload.ts';
import type { BoardEpic, BoardTicket }   from '../@types/PageBoard.ts';
import { NO_EPIC_CHIP }                  from '../constants/EpicChips.ts';
import { STATE_LABEL_FOR_DISPLAY_STATE } from '../constants/StateLabels.ts';
import { DetailMarkupUtil }              from '../detail-dialog/utils/DetailMarkupUtil.ts';
import { MarkupUtil }                    from '../utils/MarkupUtil.ts';
import { TimeUtil }                      from '../utils/TimeUtil.ts';
import { WorkItemMarkupUtil }            from '../utils/WorkItemMarkupUtil.ts';

/** A Kanban card and a table line show this many epic chips, then "+N" for the rest. */
export const CARD_EPIC_CHIP_LIMIT = 2;

/** The roll-up bar's segments, settled work first. */
const ROLLUP_STATUS_ORDER: readonly TicketStatus[] = ['delivered', 'reviewed', 'in-review', 'in-progress', 'pending', 'abandoned'];

const SWATCH_MARKUP = '<span class="ap-epic-swatch"></span>';
/** The first paragraph of a rendered description, which the Epics tab's card shows as its summary. */
const FIRST_PARAGRAPH_PATTERN = /<p>([\s\S]*?)<\/p>/;

export interface EpicMarkupFormat {
  limits:               PageLimits;
  todayCalendarDate:    string;
  nowEpochMilliseconds: number;
}

function slotAttribute(epic: BoardEpic): string {
  return MarkupUtil.attribute('data-epic-slot', String(epic.slot));
}

function countOf(epic: BoardEpic, status: TicketStatus): number {
  const count = epic.ticketCountByStatus[status];
  return typeof count === 'number' ? count : 0;
}

function openTicketCountOf(epic: BoardEpic): number {
  return epic.ticketIds.length - countOf(epic, 'delivered') - countOf(epic, 'abandoned');
}

function doneTicketCountOf(epic: BoardEpic): number {
  return countOf(epic, 'delivered');
}

function doneTextOf(epic: BoardEpic): string {
  return `${doneTicketCountOf(epic)} of ${epic.ticketIds.length} done`;
}

function epicChipMarkup(epic: BoardEpic): string {
  return `<button type="button" class="ap-epic-chip" ${MarkupUtil.attribute('data-epic', epic.key)} ${slotAttribute(epic)} ${MarkupUtil.attribute('title', `Epic: ${epic.title}`)}>`
    + `${SWATCH_MARKUP}<span class="ap-epic-chip-text">${HtmlEscapeUtil.escapeHtml(epic.title)}</span></button>`;
}

/** Up to `limit` chips, then a "+N" naming the rest on hover. */
function epicChipsMarkup(epics: readonly BoardEpic[], limit = Number.POSITIVE_INFINITY): string {
  const chips = epics.slice(0, limit).map(epicChipMarkup);
  const rest  = epics.slice(limit);
  if (rest.length > 0) {
    chips.push(`<span class="ap-epic-more" ${MarkupUtil.attribute('title', `Also in ${rest.map((epic) => epic.title).join(', ')}`)}>+${rest.length}</span>`);
  }
  return chips.join('');
}

function epicProgressMarkup(epic: BoardEpic): string {
  const segments = ROLLUP_STATUS_ORDER.filter((status) => countOf(epic, status) > 0).map((status) => (
    `<span ${MarkupUtil.attribute('data-state', status)} style="flex-grow:${countOf(epic, status)}" `
    + `${MarkupUtil.attribute('title', `${STATE_LABEL_FOR_DISPLAY_STATE[status]}: ${countOf(epic, status)}`)}></span>`
  ));
  return `<div class="ap-epic-progress" role="img" ${MarkupUtil.attribute('aria-label', `${doneTextOf(epic)} tickets`)}>${segments.join('')}</div>`;
}

function epicLegendMarkup(epic: BoardEpic): string {
  const items = ROLLUP_STATUS_ORDER.filter((status) => countOf(epic, status) > 0).map((status) => (
    `<li><span class="ap-lane-dot" ${MarkupUtil.attribute('data-state', status)}></span>`
    + `${HtmlEscapeUtil.escapeHtml(STATE_LABEL_FOR_DISPLAY_STATE[status])} <b>${countOf(epic, status)}</b></li>`
  ));
  return `<ul class="ap-epic-legend">${items.join('')}</ul>`;
}

function spanMarkup(epic: BoardEpic, format: EpicMarkupFormat): string {
  const { span } = epic;
  if (span === null) {
    return '<span>not started</span>';
  }
  const { limits, todayCalendarDate } = format;
  const startMilliseconds = TimeUtil.epochMillisecondsOf(span.start);
  const endMilliseconds   = span.end === null ? format.nowEpochMilliseconds : TimeUtil.epochMillisecondsOf(span.end);
  const duration          = startMilliseconds === null || endMilliseconds === null ? null : TimeUtil.formatDuration(endMilliseconds - startMilliseconds, limits);
  const endText           = span.end === null ? 'now' : TimeUtil.shortStampText(span.end, todayCalendarDate, limits);
  const title             = `${TimeUtil.fullStampText(span.start, limits)} → ${span.end === null ? 'still open' : TimeUtil.fullStampText(span.end, limits)}`;
  const text              = `${TimeUtil.shortStampText(span.start, todayCalendarDate, limits)} → ${endText}${duration === null ? '' : ` · ${duration}`}`;
  return `<span ${MarkupUtil.attribute('title', title)}>${HtmlEscapeUtil.escapeHtml(text)}</span>`;
}

function plainFactMarkup(label: string, value: string): string {
  return DetailMarkupUtil.factMarkup(label, `<span>${HtmlEscapeUtil.escapeHtml(value)}</span>`);
}

function epicRollupFactsMarkup(epic: BoardEpic, format: EpicMarkupFormat): string {
  const abandonedCount = countOf(epic, 'abandoned');
  return [
    '<div class="ap-ticket-meta">',
    plainFactMarkup('open', String(openTicketCountOf(epic))),
    plainFactMarkup('done', String(countOf(epic, 'delivered'))),
    abandonedCount > 0 ? plainFactMarkup('abandoned', String(abandonedCount)) : '',
    plainFactMarkup('tokens', TokenCountUtil.formatTokenCount(epic.tokens)),
    DetailMarkupUtil.factMarkup('span', spanMarkup(epic, format)),
    '</div>',
  ].join('');
}

/** The ticket's other epics as squares, led by "also in", or by "+" where the squares stand alone. */
function alsoInMarkup(epics: readonly BoardEpic[], leadText = 'also in '): string {
  if (epics.length === 0) {
    return '';
  }
  const swatches = epics.map((epic) => `<span class="ap-epic-swatch" ${slotAttribute(epic)}></span>`).join('');
  return `<span class="ap-epic-also" ${MarkupUtil.attribute('title', `Also in ${epics.map((epic) => epic.title).join(', ')}`)}>${leadText}${swatches}</span>`;
}

function otherEpicSquaresMarkup(epics: readonly BoardEpic[]): string {
  return alsoInMarkup(epics, '+');
}

/** Newest first; each line opens its ticket's own detail. */
function epicTicketListMarkup(epic: BoardEpic, ticketById: ReadonlyMap<string, BoardTicket>): string {
  const items = epic.ticketIds
    .flatMap((ticketId) => ticketById.get(ticketId) ?? [])
    .toSorted((a, b) => Number(b.id) - Number(a.id))
    .map((ticket) => {
      const label = WorkItemMarkupUtil.stateLabelOf(ticket.displayState, ticket.ownRow?.reviewRound ?? FIRST_REPEAT_REVIEW_ROUND);
      return `<li><button type="button" class="ap-epic-ticket" ${MarkupUtil.attribute('data-open-ticket', ticket.id)}>`
        + `<span class="ap-ticket-id">#${HtmlEscapeUtil.escapeHtml(ticket.id)}</span>`
        + `<span class="ap-epic-ticket-title">${HtmlEscapeUtil.escapeHtml(ticket.title)}${alsoInMarkup(ticket.memberOfEpics.filter((other) => other.key !== epic.key))}</span>`
        + `<span class="ap-badge" ${MarkupUtil.attribute('data-state', ticket.displayState)}>${HtmlEscapeUtil.escapeHtml(label)}</span></button></li>`;
    });
  return `<ul class="ap-epic-tickets">${items.join('')}</ul>`;
}

function settledTextOf(epic: BoardEpic): string {
  if (epic.ticketIds.length === 0) {
    return 'no tickets';
  }
  const openCount = openTicketCountOf(epic);
  return openCount === 0 ? 'all settled' : `${openCount} open`;
}

function epicDetailMarkup(epic: BoardEpic, ticketById: ReadonlyMap<string, BoardTicket>, format: EpicMarkupFormat): string {
  return [
    `<div class="ap-epic-detail" ${slotAttribute(epic)}>`,
    `<div class="ap-detail-head">${SWATCH_MARKUP}<h2 class="ap-detail-title">${HtmlEscapeUtil.escapeHtml(epic.title)}</h2>`,
    `<span class="ap-detail-type">epic</span><span class="ap-detail-type">${HtmlEscapeUtil.escapeHtml(settledTextOf(epic))}</span></div>`,
    `<div class="ap-ticket-meta">${plainFactMarkup('key', epic.key)}${plainFactMarkup('tickets', String(epic.ticketIds.length))}</div>`,
    DetailMarkupUtil.sectionMarkup('Progress', `${epicProgressMarkup(epic)}${epicLegendMarkup(epic)}${epicRollupFactsMarkup(epic, format)}`),
    epic.descriptionHtml === '' ? '' : DetailMarkupUtil.sectionMarkup('Description', `<div class="ap-ticket-body md">${epic.descriptionHtml}</div>`),
    DetailMarkupUtil.sectionMarkup('Tickets', epicTicketListMarkup(epic, ticketById)),
    '</div>',
  ].join('');
}

/** Open epics first, then the settled ones, each part in the Board's key order. */
function epicsInShownOrder(epics: readonly BoardEpic[]): BoardEpic[] {
  return epics.toSorted((a, b) => Number(openTicketCountOf(a) === 0) - Number(openTicketCountOf(b) === 0));
}

function epicTitleButtonMarkup(epic: BoardEpic): string {
  return `<button type="button" class="ap-epic-title" ${MarkupUtil.attribute('data-open-epic', epic.key)}>${SWATCH_MARKUP}${HtmlEscapeUtil.escapeHtml(epic.title)}</button>`;
}

function epicCardMarkup(epic: BoardEpic, ticketById: ReadonlyMap<string, BoardTicket>, format: EpicMarkupFormat): string {
  const summary = FIRST_PARAGRAPH_PATTERN.exec(epic.descriptionHtml)?.[1] ?? '';
  const status  = openTicketCountOf(epic) === 0 ? settledTextOf(epic) : doneTextOf(epic);
  return [
    `<article class="ap-card" ${slotAttribute(epic)} ${MarkupUtil.attribute('aria-label', epic.title)}>`,
    `<div class="ap-epic-card-head">${epicTitleButtonMarkup(epic)}<span class="ap-epic-key">${HtmlEscapeUtil.escapeHtml(epic.key)}</span>`,
    `<span class="ap-epic-done-mark">${HtmlEscapeUtil.escapeHtml(status)}</span></div>`,
    '<div class="ap-epic-card-body">',
    summary === '' ? '' : `<p class="ap-epic-summary">${summary}</p>`,
    `<div>${epicProgressMarkup(epic)}${epicLegendMarkup(epic)}</div>`,
    epicRollupFactsMarkup(epic, format),
    epicTicketListMarkup(epic, ticketById),
    '</div></article>',
  ].join('');
}

function epicCardsMarkup(epics: readonly BoardEpic[], ticketById: ReadonlyMap<string, BoardTicket>, format: EpicMarkupFormat): string {
  return epicsInShownOrder(epics).map((epic) => epicCardMarkup(epic, ticketById, format)).join('');
}

/** The Tickets table's head row of one epic's tickets, or of the tickets in none when `epic` is null. */
function epicGroupRowMarkup(epic: BoardEpic | null, columnCount: number, format: EpicMarkupFormat): string {
  if (epic === null) {
    return `<tr class="ap-epic-group-row"><td colspan="${columnCount}"><div class="ap-epic-group-line"><span class="ap-epic-title">No epic</span></div></td></tr>`;
  }
  return `<tr class="ap-epic-group-row" ${slotAttribute(epic)}><td colspan="${columnCount}"><div class="ap-epic-group-line">`
    + `${epicTitleButtonMarkup(epic)}${epicProgressMarkup(epic)}<span class="ap-card-note">${HtmlEscapeUtil.escapeHtml(doneTextOf(epic))}</span>`
    + `${epicRollupFactsMarkup(epic, format)}</div></td></tr>`;
}

/** One chip per epic in shown order, then the no-epic chip; the counts and pressed states are the controller's to set. */
function epicFilterChipsMarkup(epics: readonly BoardEpic[]): string {
  const chips = epicsInShownOrder(epics).map((epic) => (
    `<button type="button" class="ap-chip" ${MarkupUtil.attribute('data-epic-chip', epic.key)} ${slotAttribute(epic)} aria-pressed="false">`
    + `${SWATCH_MARKUP}${HtmlEscapeUtil.escapeHtml(epic.title)} <span class="ap-chip-count"></span></button>`
  ));
  chips.push(`<button type="button" class="ap-chip" ${MarkupUtil.attribute('data-epic-chip', NO_EPIC_CHIP)} aria-pressed="false">`
    + 'no epic <span class="ap-chip-count"></span></button>');
  return chips.join('');
}

/** The Kanban strip's roll-up of one pressed epic. */
function epicStripRollupMarkup(epic: BoardEpic): string {
  return `<div class="ap-epic-strip-rollup" ${slotAttribute(epic)}>${epicProgressMarkup(epic)}`
    + `<span>${HtmlEscapeUtil.escapeHtml(`${doneTextOf(epic)} · ${TokenCountUtil.formatTokenCount(epic.tokens)} tokens`)}</span>`
    + `<button type="button" class="ap-link-button" ${MarkupUtil.attribute('data-open-epic', epic.key)}>${HtmlEscapeUtil.escapeHtml(epic.title)} details</button></div>`;
}

export const EpicMarkup = {
  epicChipsMarkup,
  epicsInShownOrder,
  epicDetailMarkup,
  epicCardsMarkup,
  epicGroupRowMarkup,
  epicFilterChipsMarkup,
  epicStripRollupMarkup,
  otherEpicSquaresMarkup,
  doneTicketCountOf,
  openTicketCountOf,
} as const;
