/**
 * The marks any grouping draws, worded by the page's vocabulary: its chips, swatches and squares, its roll-up bar and legend, its facts
 * line and item list, its title button, and the frames of its card and its detail.
 */

import { HtmlEscapeUtil }                from '../../src/lib/html-escape/HtmlEscapeUtil.ts';
import type { GroupCardModel }           from '../@types/GroupMarks.ts';
import type { GroupDetailModel }         from '../@types/GroupMarks.ts';
import type { GroupFactModel }           from '../@types/GroupMarks.ts';
import type { GroupItemRowModel }        from '../@types/GroupMarks.ts';
import type { GroupMark }                from '../@types/GroupMarks.ts';
import type { GroupMarkVocabulary }      from '../@types/GroupMarks.ts';
import type { GroupRollupModel }         from '../@types/GroupMarks.ts';
import type { GroupRollupSegment }       from '../@types/GroupMarks.ts';
import { STATE_LABEL_FOR_DISPLAY_STATE } from '../constants/StateLabels.ts';
import { DetailMarkupUtil }              from '../detail-dialog/utils/DetailMarkupUtil.ts';
import { MarkupUtil }                    from '../utils/MarkupUtil.ts';
import { WorkItemMarkupUtil }            from '../utils/WorkItemMarkupUtil.ts';

/** A Kanban card and a table line show this many group chips, then "+N" for the rest. */
export const CARD_EPIC_CHIP_LIMIT = 2;

function slotAttribute(group: GroupMark): string {
  return MarkupUtil.attribute('data-epic-slot', String(group.slot));
}

/** The group's colour square; without a group it takes the colour of the mark around it. */
function swatchMarkup(group: GroupMark | null = null): string {
  return group === null ? '<span class="ap-epic-swatch"></span>' : `<span class="ap-epic-swatch" ${slotAttribute(group)}></span>`;
}

function groupChipMarkup(group: GroupMark, vocabulary: GroupMarkVocabulary): string {
  const opener = MarkupUtil.attribute(vocabulary.chipOpenerAttribute, group.key);
  return `<button type="button" class="ap-epic-chip" ${opener} ${slotAttribute(group)} ${MarkupUtil.attribute('title', `${vocabulary.noun}: ${group.title}`)}>`
    + `${swatchMarkup()}<span class="ap-epic-chip-text">${HtmlEscapeUtil.escapeHtml(group.title)}</span></button>`;
}

/** Up to `limit` chips, then a "+N" naming the rest on hover. */
function groupChipsMarkup(groups: readonly GroupMark[], vocabulary: GroupMarkVocabulary, limit = Number.POSITIVE_INFINITY): string {
  const chips = groups.slice(0, limit).map((group) => groupChipMarkup(group, vocabulary));
  const rest  = groups.slice(limit);
  if (rest.length > 0) {
    chips.push(`<span class="ap-epic-more" ${MarkupUtil.attribute('title', `Also in ${rest.map((group) => group.title).join(', ')}`)}>+${rest.length}</span>`);
  }
  return chips.join('');
}

/** An item's other groups as squares, led by `leadText`. */
function otherGroupSquaresMarkup(groups: readonly GroupMark[], leadText: string): string {
  if (groups.length === 0) {
    return '';
  }
  const swatches = groups.map((group) => swatchMarkup(group)).join('');
  const title    = MarkupUtil.attribute('title', `Also in ${groups.map((group) => group.title).join(', ')}`);
  return `<span class="ap-epic-also" ${title}>${HtmlEscapeUtil.escapeHtml(leadText)}${swatches}</span>`;
}

function segmentTitleOf(segment: GroupRollupSegment): string {
  return `${STATE_LABEL_FOR_DISPLAY_STATE[segment.state]}: ${segment.count}`;
}

function rollupBarMarkup(rollup: GroupRollupModel): string {
  const segments = rollup.segments.map((segment) => (
    `<span ${MarkupUtil.attribute('data-state', segment.state)} style="flex-grow:${segment.count}" ${MarkupUtil.attribute('title', segmentTitleOf(segment))}></span>`
  ));
  return `<div class="ap-epic-progress" role="img" ${MarkupUtil.attribute('aria-label', rollup.ariaLabel)}>${segments.join('')}</div>`;
}

function rollupLegendMarkup(rollup: GroupRollupModel): string {
  const items = rollup.segments.map((segment) => (
    `<li><span class="ap-lane-dot" ${MarkupUtil.attribute('data-state', segment.state)}></span>`
    + `${HtmlEscapeUtil.escapeHtml(STATE_LABEL_FOR_DISPLAY_STATE[segment.state])} <b>${segment.count}</b></li>`
  ));
  return `<ul class="ap-epic-legend">${items.join('')}</ul>`;
}

function factsLineMarkup(facts: readonly GroupFactModel[]): string {
  return `<div class="ap-ticket-meta">${facts.map((fact) => DetailMarkupUtil.factMarkup(fact.label, fact.valueMarkup)).join('')}</div>`;
}

function groupItemRowMarkup(row: GroupItemRowModel, vocabulary: GroupMarkVocabulary): string {
  const note    = row.note === null ? '' : ` <span class="ap-card-note">${HtmlEscapeUtil.escapeHtml(row.note)}</span>`;
  const content = `<span class="ap-ticket-id">${HtmlEscapeUtil.escapeHtml(row.leadText)}</span>`
    + `<span class="ap-epic-ticket-title">${HtmlEscapeUtil.escapeHtml(row.title)}${otherGroupSquaresMarkup(row.otherGroups, 'also in ')}${note}</span>`
    + (row.badge === null ? '' : WorkItemMarkupUtil.stateBadgeMarkup(row.badge.stateToken, row.badge.label));
  const live = row.isLive ? ' data-live' : '';
  return row.opener === null
    ? `<li><span class="ap-epic-ticket"${live}>${content}</span></li>`
    : `<li><button type="button" class="ap-epic-ticket" ${MarkupUtil.attribute(vocabulary.itemOpenerAttribute, row.opener)}${live}>${content}</button></li>`;
}

function groupItemListMarkup(rows: readonly GroupItemRowModel[], vocabulary: GroupMarkVocabulary): string {
  return `<ul class="ap-epic-tickets">${rows.map((row) => groupItemRowMarkup(row, vocabulary)).join('')}</ul>`;
}

function groupTitleButtonMarkup(group: GroupMark, vocabulary: GroupMarkVocabulary): string {
  const opener = MarkupUtil.attribute(vocabulary.titleOpenerAttribute, group.key);
  return `<button type="button" class="ap-epic-title" ${opener}>${swatchMarkup()}${HtmlEscapeUtil.escapeHtml(group.title)}</button>`;
}

/** A table's head row for a group, spanning every column; a row of no group takes no colour slot. */
function groupRowMarkup(slot: number | null, columnCount: number, lineMarkup: string): string {
  const slotPart = slot === null ? '' : ` ${MarkupUtil.attribute('data-epic-slot', String(slot))}`;
  return `<tr class="ap-epic-group-row"${slotPart}><td colspan="${columnCount}"><div class="ap-epic-group-line">${lineMarkup}</div></td></tr>`;
}

function groupCardMarkup(card: GroupCardModel): string {
  const { head } = card;
  const slot      = card.slot === null ? '' : `${MarkupUtil.attribute('data-epic-slot', String(card.slot))} `;
  const doneTitle = head.doneTitleText === null ? '' : ` ${MarkupUtil.attribute('title', head.doneTitleText)}`;
  return [
    `<article class="ap-card" ${slot}${MarkupUtil.attribute('aria-label', card.ariaLabel)}${card.isLive ? ' data-live' : ''}>`,
    `<div class="ap-epic-card-head">${head.titleMarkup}<span class="ap-epic-key">${HtmlEscapeUtil.escapeHtml(head.keyText)}</span>`,
    `<span class="ap-epic-done-mark"${doneTitle}>${HtmlEscapeUtil.escapeHtml(head.doneText)}</span></div>`,
    '<div class="ap-epic-card-body">',
    ...card.bodyParts,
    '</div></article>',
  ].join('');
}

function groupDetailMarkup(detail: GroupDetailModel): string {
  const typeTags = detail.typeTags.map((typeTag) => `<span class="ap-detail-type">${HtmlEscapeUtil.escapeHtml(typeTag)}</span>`).join('');
  return [
    `<div class="ap-epic-detail" ${MarkupUtil.attribute('data-epic-slot', String(detail.slot))}>`,
    `<div class="ap-detail-head">${swatchMarkup()}<h2 class="ap-detail-title">${HtmlEscapeUtil.escapeHtml(detail.title)}</h2>`,
    `${typeTags}</div>`,
    ...detail.bodyParts,
    '</div>',
  ].join('');
}

export const GroupMarkup = {
  groupChipsMarkup,
  swatchMarkup,
  otherGroupSquaresMarkup,
  rollupBarMarkup,
  rollupLegendMarkup,
  factsLineMarkup,
  groupItemListMarkup,
  groupTitleButtonMarkup,
  groupRowMarkup,
  groupCardMarkup,
  groupDetailMarkup,
} as const;
