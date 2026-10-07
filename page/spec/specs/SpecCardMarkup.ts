/** The Specs tab's cards, one per spec on the shared group card, the specs in flight first and the done ones last. */

import type { SnapshotSpec }           from '../../../src/lib/spec-snapshot/@types/SpecSnapshot.ts';
import type { GroupMarkupFormat }      from '../../@types/GroupMarks.ts';
import { GroupMarkup }                 from '../../epics/GroupMarkup.ts';
import { MarkupUtil }                  from '../../utils/MarkupUtil.ts';
import { SPEC_MARK_VOCABULARY }        from '../constants/SpecMarkVocabulary.ts';
import { DISPLAY_STATE_FOR_SPEC_LANE } from '../constants/WorkItemStateTranslations.ts';
import { specStepperMarkup }           from '../marks/SpecStepperMarkup.ts';
import { SpecCardSections }            from './SpecCardSections.ts';

/** The stepper takes its colour from the state of the lane the spec is in. */
function stepperRowMarkup(spec: SnapshotSpec): string {
  return `<div class="ap-spec-stepper-row" ${MarkupUtil.attribute('data-state', DISPLAY_STATE_FOR_SPEC_LANE[spec.lane])}>${specStepperMarkup(spec.stepper, 'full')}</div>`;
}

function specCardMarkup(spec: SnapshotSpec, format: GroupMarkupFormat): string {
  const doneMark = SpecCardSections.doneMarkOf(spec);
  return GroupMarkup.groupCardMarkup({
    slot:      spec.colourSlot,
    ariaLabel: spec.title,
    head:      {
      titleMarkup:   GroupMarkup.groupTitleButtonMarkup({ key: spec.folderName, title: spec.title, slot: spec.colourSlot }, SPEC_MARK_VOCABULARY),
      keyText:       spec.folderName,
      doneText:      doneMark.text,
      doneTitleText: doneMark.titleText,
    },
    bodyParts: [
      stepperRowMarkup(spec),
      SpecCardSections.factsMarkup(spec),
      SpecCardSections.storiesMarkup(spec),
      SpecCardSections.filesMarkup(spec),
      SpecCardSections.checklistsMarkup(spec),
      SpecCardSections.rollupMarkup(spec),
      GroupMarkup.factsLineMarkup([SpecCardSections.spanFactOf(spec, format)]),
    ],
  });
}

function specsInShownOrder(specs: readonly SnapshotSpec[]): SnapshotSpec[] {
  return specs.toSorted((a, b) => Number(a.lane === 'done') - Number(b.lane === 'done'));
}

function specCardsMarkup(specs: readonly SnapshotSpec[], format: GroupMarkupFormat): string {
  return specsInShownOrder(specs).map((spec) => specCardMarkup(spec, format)).join('');
}

export const SpecCardMarkup = Object.freeze({ stepperRowMarkup, specCardsMarkup });
