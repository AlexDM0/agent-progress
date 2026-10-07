/** The spec page's detail targets: a spec by its folder name and a work item by its id, each showing its title and its lane or state. */

import { HtmlEscapeUtil }                from '../../../src/lib/html-escape/HtmlEscapeUtil.ts';
import type { SpecSnapshot }             from '../../../src/lib/spec-snapshot/@types/SpecSnapshot.ts';
import type { DetailTargetRegistration } from '../../detail-dialog/@types/DetailTargetRegistration.ts';
import { DetailMarkupUtil }              from '../../detail-dialog/utils/DetailMarkupUtil.ts';

export type SpecDetailTargetKind = 'spec' | 'work-item';

const SPEC_OPENER_SELECTOR      = '[data-open-spec]';
const WORK_ITEM_OPENER_SELECTOR = '[data-open-work-item]';

function titledFactMarkup(title: string, label: string, value: string): string {
  return DetailMarkupUtil.sectionMarkup(title, DetailMarkupUtil.factMarkup(label, `<span>${HtmlEscapeUtil.escapeHtml(value)}</span>`));
}

export function specDetailTargetsOf(snapshot: SpecSnapshot): Readonly<Record<SpecDetailTargetKind, DetailTargetRegistration>> {
  const specByFolderName   = new Map(snapshot.specs.map((spec) => [spec.folderName, spec]));
  const workItemById       = new Map(snapshot.specs.flatMap((spec) => spec.workItems).map((workItem) => [workItem.id, workItem]));

  return {
    'spec': {
      openerSelector: SPEC_OPENER_SELECTOR,
      idOf:           (opener) => opener.dataset['specKey'] ?? '',
      selectorFor:    (escapedId) => `${SPEC_OPENER_SELECTOR}[data-spec-key="${escapedId}"]`,
      markupOf:       (folderName) => {
        const spec = specByFolderName.get(folderName);
        return spec === undefined ? '' : titledFactMarkup(spec.title, 'lane', spec.lane);
      },
    },
    'work-item': {
      openerSelector: WORK_ITEM_OPENER_SELECTOR,
      idOf:           (opener) => opener.dataset['workItemId'] ?? '',
      selectorFor:    (escapedId) => `${WORK_ITEM_OPENER_SELECTOR}[data-work-item-id="${escapedId}"]`,
      markupOf:       (workItemId) => {
        const workItem = workItemById.get(workItemId);
        return workItem === undefined ? '' : titledFactMarkup(workItem.title, 'state', workItem.state);
      },
    },
  };
}
