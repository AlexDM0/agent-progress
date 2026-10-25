/** A board of lanes, shaped by the placeholder board in `resources/template.html`; the lanes, their words and their cards are the model's. */

import { HtmlEscapeUtil }     from '../../src/lib/html-escape/HtmlEscapeUtil.ts';
import type { DisplayState }  from '../../src/lib/tracker-model/@types/Task.ts';
import { MarkupUtil }         from '../utils/MarkupUtil.ts';
import type { LaneBody }      from './@types/LaneBoard.ts';
import type { LaneCardGroup } from './@types/LaneBoard.ts';
import type { LaneFooter }    from './@types/LaneBoard.ts';
import type { LaneModel }     from './@types/LaneBoard.ts';
import type { LanePaging }    from './@types/LaneBoard.ts';
import type { LaneSubtitle }  from './@types/LaneBoard.ts';
import { laneCardMarkup }     from './LaneCardMarkup.ts';

/** Waiting is hollow, working is filled: the same rule as the dashed and solid card outlines. */
const HOLLOW_DOT_STATES: ReadonlySet<DisplayState> = new Set(['paused', 'in-review']);

function dotGlyphOf(dotState: DisplayState | null): string {
  if (dotState === null) {
    return '';
  }
  return HOLLOW_DOT_STATES.has(dotState) ? '○ ' : '• ';
}

/** The head's subtitle as one plain line for its hover; zero counts were already left out by the model. */
function subtitleTextOf(subtitle: LaneSubtitle): string {
  if (subtitle.kind === 'text') {
    return subtitle.text;
  }
  const counts = subtitle.counts.map((entry) => `${dotGlyphOf(entry.dotState)}${entry.reviewedMark ? '✓' : ''}${entry.count} ${entry.label}`);
  return [...subtitle.leading === null ? [] : [subtitle.leading], ...counts].join(' · ');
}

function headMarkup(lane: LaneModel): string {
  const headInner      = `<span class="ap-card-title">${HtmlEscapeUtil.escapeHtml(lane.title)}</span><span class="ap-lane-count">${lane.count}</span>`;
  const subtitleText   = subtitleTextOf(lane.subtitle);
  const titleAttribute = subtitleText === '' ? '' : ` ${MarkupUtil.attribute('title', subtitleText)}`;
  const headOpening    = `<div class="ap-card-head" ${MarkupUtil.attribute('data-state', lane.dotState)}${titleAttribute}>`;
  if (lane.collapse === null) {
    return `${headOpening}${headInner}</div>`;
  }
  const toggle = [
    `<button type="button" class="ap-lane-toggle" aria-expanded="${String(!lane.collapse.isCollapsed)}" ${MarkupUtil.attribute('aria-controls', lane.cardsElementId)}`,
    ` ${MarkupUtil.attribute('title', lane.collapse.toggleTitle)}>${headInner}</button>`,
  ].join('');
  return `${headOpening}${toggle}</div>`;
}

function groupMarkup(group: LaneCardGroup): string {
  const cards = group.cards.map(laneCardMarkup).join('');
  switch (group.kind) {
    case 'plain':
      return cards;
    case 'priority':
      return `<div class="ap-lane-group" ${MarkupUtil.attribute('data-priority', group.priority)}>${HtmlEscapeUtil.escapeHtml(group.title)} `
        + `<span class="ap-lane-group-count">${group.count}</span></div>${cards}`;
    case 'state':
      return `<div class="ap-lane-group" ${MarkupUtil.attribute('data-state-group', group.stateGroup)}>${HtmlEscapeUtil.escapeHtml(group.title)} `
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

/** The paging while the lane holds more than a page, then what the finished-work choice leaves out of it, with a way to show it all. */
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
