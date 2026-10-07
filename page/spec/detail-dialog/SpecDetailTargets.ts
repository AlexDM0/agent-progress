/**
 * The spec page's detail targets: a spec by its folder name and a work item by its id, each showing its title and its lane or state, a work
 * item its task lines too. A card opens what it carries the key of; a link opener names what it opens by its own value.
 */

import { HtmlEscapeUtil }                                  from '../../../src/lib/html-escape/HtmlEscapeUtil.ts';
import type { SpecSnapshot, WorkItem, WorkItemTask }       from '../../../src/lib/spec-snapshot/@types/SpecSnapshot.ts';
import type { DetailLinkOpener, DetailTargetRegistration } from '../../detail-dialog/@types/DetailTargetRegistration.ts';
import { DetailMarkupUtil }                                from '../../detail-dialog/utils/DetailMarkupUtil.ts';
import { MarkupUtil }                                      from '../../utils/MarkupUtil.ts';
import { SPEC_KEY_ATTRIBUTE, WORK_ITEM_ID_ATTRIBUTE }      from '../constants/SpecCardIdentityAttributes.ts';
import { SPEC_MARK_VOCABULARY }                            from '../constants/SpecMarkVocabulary.ts';

export type SpecDetailTargetKind = 'spec' | 'work-item';

const SPEC_OPENER_SELECTOR      = `[${SPEC_KEY_ATTRIBUTE}]`;
const WORK_ITEM_OPENER_SELECTOR = `[${WORK_ITEM_ID_ATTRIBUTE}]`;

function titledFactMarkup(title: string, label: string, value: string, extraMarkup = ''): string {
  return DetailMarkupUtil.sectionMarkup(title, `${DetailMarkupUtil.factMarkup(label, `<span>${HtmlEscapeUtil.escapeHtml(value)}</span>`)}${extraMarkup}`);
}

function taskLineMarkup(task: WorkItemTask): string {
  const parallel = task.isParallel ? '<span class="ap-spec-task-mark">[P]</span>' : '';
  const story    = task.storyNumber === null ? '' : `<span class="ap-spec-task-mark">${HtmlEscapeUtil.escapeHtml(`[US${task.storyNumber}]`)}</span>`;
  const done     = task.isDone
    ? '<span class="ap-spec-task-done" title="Done">✓</span>'
    : '<span class="ap-spec-task-done" title="Not done">○</span>';
  return `<li ${MarkupUtil.attribute('data-done', String(task.isDone))}><code>${HtmlEscapeUtil.escapeHtml(task.id)}</code>${done}${parallel}${story}`
    + `<span>${HtmlEscapeUtil.escapeHtml(task.description)}</span></li>`;
}

function taskLinesMarkup(workItem: WorkItem): string {
  return workItem.tasks.length === 0 ? '' : `<ul class="ap-spec-task-lines">${workItem.tasks.map(taskLineMarkup).join('')}</ul>`;
}

/** A spec chip or a spec title opens the spec, checked before a work item link, so a chip on a work card opens its spec, not the card. */
export const SPEC_DETAIL_LINK_OPENERS: readonly DetailLinkOpener<SpecDetailTargetKind>[] = Object.freeze([
  {
    kind:     'spec',
    selector: `[${SPEC_MARK_VOCABULARY.chipOpenerAttribute}], [${SPEC_MARK_VOCABULARY.titleOpenerAttribute}]`,
    idOf:     (link) => link.getAttribute(SPEC_MARK_VOCABULARY.chipOpenerAttribute) ?? link.getAttribute(SPEC_MARK_VOCABULARY.titleOpenerAttribute) ?? '',
  },
  {
    kind:     'work-item',
    selector: `[${SPEC_MARK_VOCABULARY.itemOpenerAttribute}]`,
    idOf:     (link) => link.getAttribute(SPEC_MARK_VOCABULARY.itemOpenerAttribute) ?? '',
  },
]);

export function specDetailTargetsOf(snapshot: SpecSnapshot): Readonly<Record<SpecDetailTargetKind, DetailTargetRegistration>> {
  const specByFolderName   = new Map(snapshot.specs.map((spec) => [spec.folderName, spec]));
  const workItemById       = new Map(snapshot.specs.flatMap((spec) => spec.workItems).map((workItem) => [workItem.id, workItem]));

  return {
    'spec': {
      openerSelector: SPEC_OPENER_SELECTOR,
      idOf:           (opener) => opener.getAttribute(SPEC_KEY_ATTRIBUTE) ?? '',
      selectorFor:    (escapedId) => `[${SPEC_KEY_ATTRIBUTE}="${escapedId}"]`,
      markupOf:       (folderName) => {
        const spec = specByFolderName.get(folderName);
        return spec === undefined ? '' : titledFactMarkup(spec.title, 'lane', spec.lane);
      },
    },
    'work-item': {
      openerSelector: WORK_ITEM_OPENER_SELECTOR,
      idOf:           (opener) => opener.getAttribute(WORK_ITEM_ID_ATTRIBUTE) ?? '',
      selectorFor:    (escapedId) => `[${WORK_ITEM_ID_ATTRIBUTE}="${escapedId}"]`,
      markupOf:       (workItemId) => {
        const workItem = workItemById.get(workItemId);
        return workItem === undefined ? '' : titledFactMarkup(workItem.title, 'state', workItem.state, taskLinesMarkup(workItem));
      },
    },
  };
}
