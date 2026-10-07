/** One filter chip of a chip row on either page; its pressed state and count are the chip group's to set. */

import { HtmlEscapeUtil } from '../../src/lib/html-escape/HtmlEscapeUtil.ts';
import { GroupMarkup }    from '../epics/GroupMarkup.ts';
import { MarkupUtil }     from '../utils/MarkupUtil.ts';

export interface FilterChipModel {
  readonly value:       string;
  readonly label:       string;
  /** A state chip leads with the lane dot of this state. */
  readonly stateToken?: string;
  /** A group chip leads with the swatch of this colour slot. */
  readonly slot?:       number;
}

export function filterChipMarkup(attributeName: string, chip: FilterChipModel): string {
  const stateAttribute = chip.stateToken === undefined ? '' : ` ${MarkupUtil.attribute('data-state', chip.stateToken)}`;
  const slotAttribute  = chip.slot === undefined ? '' : ` ${MarkupUtil.attribute('data-epic-slot', String(chip.slot))}`;
  const laneDot        = chip.stateToken === undefined ? '' : `<span class="ap-lane-dot" ${MarkupUtil.attribute('data-state', chip.stateToken)}></span>`;
  const swatch         = chip.slot === undefined ? '' : GroupMarkup.swatchMarkup();
  return `<button type="button" class="ap-chip" ${MarkupUtil.attribute(attributeName, chip.value)}${stateAttribute}${slotAttribute} aria-pressed="false">`
    + `${laneDot}${swatch}${HtmlEscapeUtil.escapeHtml(chip.label)} <span class="ap-chip-count"></span></button>`;
}
