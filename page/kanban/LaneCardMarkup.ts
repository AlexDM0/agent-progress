/** One lane card, shaped by the placeholder cards of `resources/template.html`; a part the model leaves out is left out of the card. */

import { HtmlEscapeUtil }                    from '../../src/lib/html-escape/HtmlEscapeUtil.ts';
import { TokenCountUtil }                    from '../../src/lib/token-count/TokenCountUtil.ts';
import type { TicketSize }                   from '../../src/lib/tracker-model/@types/Ticket.ts';
import { CARD_EPIC_CHIP_LIMIT, GroupMarkup } from '../epics/GroupMarkup.ts';
import { MarkupUtil }                        from '../utils/MarkupUtil.ts';
import { WorkItemMarkupUtil }                from '../utils/WorkItemMarkupUtil.ts';
import type { LaneCardHead }                 from './@types/LaneBoard.ts';
import type { LaneCardMarks }                from './@types/LaneBoard.ts';
import type { LaneCardModel }                from './@types/LaneBoard.ts';

/** The "needed first" slot, then the head's right end: the held count and the token count, kept together so a crowded head wraps them as one. */
function headTailMarkup(head: LaneCardHead): string {
  const neededFirst = head.hasNeededFirst ? '<span class="ap-kanban-needed-first" aria-hidden="true">needed first</span>' : '';
  const { heldCount } = head;
  const held        = heldCount === null
    ? ''
    : `<span class="ap-kanban-held-count"${heldCount.isHeavy ? ' data-heavy=""' : ''} ${MarkupUtil.attribute('title', heldCount.title)}>↦ ${heldCount.count}</span>`;
  const tokens      = head.tokenCount === null ? '' : `<span class="ap-tokens">${HtmlEscapeUtil.escapeHtml(TokenCountUtil.formatTokenCount(head.tokenCount))} tokens</span>`;
  const headEnd     = `${held}${tokens}`;
  return `${neededFirst}${headEnd === '' ? '' : `<span class="ap-kanban-head-end">${headEnd}</span>`}`;
}

/** The size borrows the quiet ticket badge, as the low priority mark does: the template has no size style of its own. */
function sizeMarkup(size: TicketSize | null): string {
  return size === null
    ? ''
    : `<span class="ap-ticket-badge" ${MarkupUtil.attribute('data-size', size)} ${MarkupUtil.attribute('title', `Size ${size}`)}>${HtmlEscapeUtil.escapeHtml(size)}</span>`;
}

function headMarkup(head: LaneCardHead): string {
  const priorityMark = head.priority === null ? '' : WorkItemMarkupUtil.priorityLevelMarkMarkup(head.priority);
  return [
    `<div class="ap-kanban-card-head"><span class="ap-ticket-id">${HtmlEscapeUtil.escapeHtml(head.idText)}</span>${sizeMarkup(head.size)}${priorityMark}`,
    `${head.ticketType === null ? '' : WorkItemMarkupUtil.ticketTypeMarkMarkup(head.ticketType)}${head.slotMarkup ?? ''}${headTailMarkup(head)}</div>`,
  ].join('');
}

function marksMarkup(marks: LaneCardMarks): string {
  const markup = [
    WorkItemMarkupUtil.waitingOnLinksMarkup(marks.waitingOn),
    marks.heldTitle === null ? '' : `<span class="ap-kanban-held" ${MarkupUtil.attribute('title', marks.heldTitle)}>held</span>`,
    marks.noRowTitle === null ? '' : `<span class="ap-kanban-no-row" ${MarkupUtil.attribute('title', marks.noRowTitle)}>no row yet</span>`,
  ].join('');
  return markup === '' ? '' : `<div class="ap-kanban-marks">${markup}</div>`;
}

function stateMarkup(card: LaneCardModel): string {
  const reviewed = card.reviewedTitle === null ? '' : `${WorkItemMarkupUtil.titledReviewedMarkMarkup(card.reviewedTitle)}<span>reviewed</span>`;
  return `<div class="ap-kanban-state">${reviewed}</div>`;
}

/** A ticking stamp names its label and start, so the page's ticker can re-measure it without the model. */
function stampMarkup(card: LaneCardModel): string {
  const { stamp, elapsedStamp } = card;
  if (stamp === null) {
    return '';
  }
  if (elapsedStamp === null) {
    return MarkupUtil.shortenedTextMarkup('span', stamp.shortText, stamp.fullText, 'ap-kanban-stamp');
  }
  const ticker = `${MarkupUtil.attribute('data-elapsed-label', elapsedStamp.label)} ${MarkupUtil.attribute('data-elapsed-since', String(elapsedStamp.startEpochMilliseconds))}`;
  return `<span class="ap-kanban-stamp" ${ticker}>${HtmlEscapeUtil.escapeHtml(stamp.shortText)}</span>`;
}

export function laneCardMarkup(card: LaneCardModel): string {
  const identities = [
    MarkupUtil.attribute('id', card.elementId),
    MarkupUtil.attribute(card.identity.attribute, card.identity.value),
    MarkupUtil.attribute('data-state', card.stateToken),
  ].join(' ');
  const { chips } = card;
  return [
    `<article class="ap-kanban-card" ${identities}${card.hasStripe ? '' : ' data-row="none"'}${card.isLive ? ' data-live=""' : ''}${card.opensDetail ? ' tabindex="0"' : ''}`,
    ` ${MarkupUtil.attribute('aria-label', card.ariaLabel)}>`,
    headMarkup(card.head),
    `<p class="ap-kanban-title" ${MarkupUtil.attribute('title', card.title)}>${HtmlEscapeUtil.escapeHtml(card.title)}</p>`,
    chips === null ? '' : `<div class="ap-epic-chips">${GroupMarkup.groupChipsMarkup(chips.groups, chips.vocabulary, CARD_EPIC_CHIP_LIMIT)}</div>`,
    marksMarkup(card.marks),
    card.note === null ? '' : `<p class="ap-kanban-note">${HtmlEscapeUtil.escapeHtml(card.note)}</p>`,
    stateMarkup(card),
    stampMarkup(card),
    '</article>',
  ].join('');
}
