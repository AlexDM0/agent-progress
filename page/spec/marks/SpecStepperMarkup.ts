/** A spec's phases as a stepper: Specify · Plan · Tasks · Implement · Converge, the done ones filled and the current one marked. */

import { HtmlEscapeUtil }   from '../../../src/lib/html-escape/HtmlEscapeUtil.ts';
import type { SpecStepper } from '../../../src/lib/spec-snapshot/@types/SpecSnapshot.ts';
import type { SpecLane }    from '../../../src/lib/spec-snapshot/constants/SpecSnapshotVocabulary.ts';
import { SPEC_LANES }       from '../../../src/lib/spec-snapshot/constants/SpecSnapshotVocabulary.ts';
import { MarkupUtil }       from '../../utils/MarkupUtil.ts';
import { SPEC_LANE_TITLES } from '../constants/SpecLaneTitles.ts';

export type SpecStepperSize = 'compact' | 'full';

type StepProgress = 'done' | 'current' | 'next';

const STEPPER_STAGES = SPEC_LANES.slice(0, -1);

function stepProgressOf(stepper: SpecStepper, lane: SpecLane): StepProgress {
  if (stepper.doneLanes.includes(lane)) {
    return 'done';
  }
  return stepper.currentLane === lane ? 'current' : 'next';
}

function ariaLabelOf(stepper: SpecStepper): string {
  return stepper.currentLane === null ? 'Phase: every phase done' : `Phase: ${SPEC_LANE_TITLES[stepper.currentLane]}`;
}

export function specStepperMarkup(stepper: SpecStepper, size: SpecStepperSize): string {
  const steps = STEPPER_STAGES.map((lane) => (
    `<li class="ap-spec-step" ${MarkupUtil.attribute('data-step', stepProgressOf(stepper, lane))}>${HtmlEscapeUtil.escapeHtml(SPEC_LANE_TITLES[lane])}</li>`
  ));
  return `<ol class="ap-spec-steps" ${MarkupUtil.attribute('data-size', size)} ${MarkupUtil.attribute('aria-label', ariaLabelOf(stepper))}>${steps.join('')}</ol>`;
}
