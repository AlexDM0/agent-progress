/** The marks any grouping draws: its chips, swatches and squares, and its roll-up bar and legend, worded by the page's vocabulary. */

import { HtmlEscapeUtil }                from '../../src/lib/html-escape/HtmlEscapeUtil.ts';
import type { GroupMark }                from '../@types/GroupMarks.ts';
import type { GroupMarkVocabulary }      from '../@types/GroupMarks.ts';
import type { GroupRollupModel }         from '../@types/GroupMarks.ts';
import type { GroupRollupSegment }       from '../@types/GroupMarks.ts';
import { STATE_LABEL_FOR_DISPLAY_STATE } from '../constants/StateLabels.ts';
import { MarkupUtil }                    from '../utils/MarkupUtil.ts';

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

export const GroupMarkup = {
  groupChipsMarkup,
  swatchMarkup,
  otherGroupSquaresMarkup,
  rollupBarMarkup,
  rollupLegendMarkup,
} as const;
