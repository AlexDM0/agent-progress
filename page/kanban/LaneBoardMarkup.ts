/** A board of lanes, shaped by the placeholder board in `resources/template.html`; the lanes, their words and their cards are the model's. */

import { HtmlEscapeUtil }     from '../../src/lib/html-escape/HtmlEscapeUtil.ts';
import { MarkupUtil }         from '../utils/MarkupUtil.ts';
import type { LaneBody }      from './@types/LaneBoard.ts';
import type { LaneCardGroup } from './@types/LaneBoard.ts';
import type { LaneFooter }    from './@types/LaneBoard.ts';
import type { LaneModel }     from './@types/LaneBoard.ts';
import type { LanePaging }    from './@types/LaneBoard.ts';
import type { LaneSubtitle }  from './@types/LaneBoard.ts';
import { laneCardMarkup }     from './LaneCardMarkup.ts';

function subtitleMarkup(subtitle: LaneSubtitle): string {
  if (subtitle.kind === 'text') {
    return subtitle.text === '' ? '' : `<span class="ap-lane-sub">${HtmlEscapeUtil.escapeHtml(subtitle.text)}</span>`;
  }
  const counts = subtitle.counts.map((entry) => {
    const dot  = entry.dotState === null ? '' : `<span class="ap-lane-dot" ${MarkupUtil.attribute('data-state', entry.dotState)}></span>`;
    const mark = entry.reviewedMark ? '<span class="ap-reviewed-mark" data-state="reviewed" aria-hidden="true">✓</span>' : '';
    return `${dot}${mark}${entry.count} ${HtmlEscapeUtil.escapeHtml(entry.label)}`;
  });
  const parts = [...subtitle.leading === null ? [] : [HtmlEscapeUtil.escapeHtml(subtitle.leading)], ...counts];
  return parts.length === 0 ? '' : `<span class="ap-lane-sub">${parts.join(' · ')}</span>`;
}

function headMarkup(lane: LaneModel): string {
  const headInner = [
    `<span class="ap-lane-dot" ${MarkupUtil.attribute('data-state', lane.dotState)}></span>`,
    `<span class="ap-card-title">${HtmlEscapeUtil.escapeHtml(lane.title)}</span>`,
    `<span class="ap-lane-count">${lane.count}</span>`,
  ].join('');
  const subtitle = subtitleMarkup(lane.subtitle);
  if (lane.collapse === null) {
    return `<div class="ap-card-head">${headInner}${subtitle}</div>`;
  }
  const toggle = [
    `<button type="button" class="ap-lane-toggle" aria-expanded="${String(!lane.collapse.isCollapsed)}" ${MarkupUtil.attribute('aria-controls', lane.cardsElementId)}`,
    ` ${MarkupUtil.attribute('title', lane.collapse.toggleTitle)}>${headInner}</button>`,
  ].join('');
  return `<div class="ap-card-head">${toggle}${subtitle}</div>`;
}

function groupMarkup(group: LaneCardGroup): string {
  const cards = group.cards.map(laneCardMarkup).join('');
  switch (group.kind) {
    case 'plain':
      return cards;
    case 'priority':
      return `<div class="ap-lane-group" ${MarkupUtil.attribute('data-priority', group.priority)}>${HtmlEscapeUtil.escapeHtml(group.title)} `
        + `<span class="ap-lane-group-count">${group.count}</span></div>${cards}`;
    case 'wave':
      return [
        `<div class="ap-lane-wave" ${MarkupUtil.attribute('data-wave', String(group.index))}${group.isNarrow ? ' data-narrow=""' : ''}>`,
        `<div class="ap-lane-group">${HtmlEscapeUtil.escapeHtml(group.label)} <span class="ap-lane-group-note">${HtmlEscapeUtil.escapeHtml(group.note)}</span></div>`,
        cards,
        '</div>',
      ].join('');
  }
}

function bodyMarkup(body: LaneBody): string {
  return body.kind === 'empty' ? `<div class="ap-empty">${HtmlEscapeUtil.escapeHtml(body.text)}</div>` : body.groups.map(groupMarkup).join('');
}

function pagingMarkup(laneKey: string, paging: LanePaging): string {
  const buttons = [
    paging.nextPageSize > 0 ? `<button type="button" ${MarkupUtil.attribute('data-lane-more', laneKey)}>Show ${paging.nextPageSize} more</button>` : '',
    paging.firstPageSize === null ? '' : `<button type="button" ${MarkupUtil.attribute('data-lane-reset', laneKey)}>Latest ${paging.firstPageSize}</button>`,
  ].join('');
  return `<span>${paging.shownCount} of ${paging.laneCount} shown</span><div class="ap-seg">${buttons}</div>`;
}

/** The paging while the lane holds more than a page, then what the finished-work switch leaves out of it, with a way to show it all. */
export function laneFooterMarkup(laneKey: string, footer: LaneFooter | null): string {
  if (footer === null) {
    return '';
  }
  const hiddenLine = footer.hiddenCount > 0
    ? `<div class="ap-lane-hidden-line"><span>${footer.hiddenCount} earlier hidden</span>`
      + '<button type="button" class="ap-link-button" data-show-all-finished>show all</button></div>'
    : '';
  const contents = `${footer.paging === null ? '' : pagingMarkup(laneKey, footer.paging)}${hiddenLine}`;
  return contents === '' ? '' : `<div class="ap-lane-more">${contents}</div>`;
}

export function laneMarkup(lane: LaneModel): string {
  return [
    `<section class="ap-card ap-lane" ${MarkupUtil.attribute('data-lane', lane.key)}${lane.collapse?.isCollapsed === true ? ' data-collapsed=""' : ''}`,
    ` ${MarkupUtil.attribute('aria-label', lane.title)}>`,
    headMarkup(lane),
    `<div class="ap-lane-cards" ${MarkupUtil.attribute('id', lane.cardsElementId)}>${bodyMarkup(lane.body)}</div>`,
    laneFooterMarkup(lane.key, lane.footer),
    '</section>',
  ].join('');
}

export function laneBoardMarkup(lanes: readonly LaneModel[]): string {
  return lanes.map(laneMarkup).join('');
}
