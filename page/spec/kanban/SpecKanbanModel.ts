/**
 * The spec Kanban's two bands as shared lane boards: the Specs band, one card per spec in the lane of its phase, and the work band, one card
 * per `tasks.md` phase in the lane of its state. Every fact comes from the snapshot; the model only orders and words it.
 */

import { HtmlEscapeUtil }                             from '../../../src/lib/html-escape/HtmlEscapeUtil.ts';
import type { SnapshotSpec, SpecSnapshot, WorkItem }  from '../../../src/lib/spec-snapshot/@types/SpecSnapshot.ts';
import type { SpecLane, WorkItemState }               from '../../../src/lib/spec-snapshot/constants/SpecSnapshotVocabulary.ts';
import { SPEC_LANES, WORK_ITEM_STATES }               from '../../../src/lib/spec-snapshot/constants/SpecSnapshotVocabulary.ts';
import type { DisplayState }                          from '../../../src/lib/tracker-model/@types/Task.ts';
import { STATE_LABEL_FOR_DISPLAY_STATE }              from '../../constants/StateLabels.ts';
import { GroupMarkup }                                from '../../epics/GroupMarkup.ts';
import type { LaneCardHead, LaneCardModel }           from '../../kanban/@types/LaneBoard.ts';
import type { LaneModel }                             from '../../kanban/@types/LaneBoard.ts';
import { MarkupUtil }                                 from '../../utils/MarkupUtil.ts';
import type { TimestampSlices }                       from '../../utils/TimeUtil.ts';
import { TimeUtil }                                   from '../../utils/TimeUtil.ts';
import { SPEC_KEY_ATTRIBUTE, WORK_ITEM_ID_ATTRIBUTE } from '../constants/SpecCardIdentityAttributes.ts';
import { SPEC_LANE_TITLES }                           from '../constants/SpecLaneTitles.ts';
import { SPEC_MARK_VOCABULARY }                       from '../constants/SpecMarkVocabulary.ts';
import { DISPLAY_STATE_FOR_SPEC_LANE }                from '../constants/WorkItemStateTranslations.ts';
import { DISPLAY_STATE_FOR_WORK_ITEM_STATE }          from '../constants/WorkItemStateTranslations.ts';
import { SpecGroupMarks }                             from '../marks/SpecGroupMarks.ts';
import { specStepperMarkup }                          from '../marks/SpecStepperMarkup.ts';

export type SpecKanbanBandName = 'specs' | 'work';

export interface SpecKanbanBand {
  readonly cardCount: number;
  readonly lanes:     readonly LaneModel[];
}

export interface SpecKanbanModel {
  readonly specsBand: SpecKanbanBand;
  readonly workBand:  SpecKanbanBand;
}

export interface SpecKanbanInput {
  readonly snapshot:          SpecSnapshot;
  readonly todayCalendarDate: string;
  readonly slices:            TimestampSlices;
}

const SPEC_LANE_LINES: Readonly<Record<SpecLane, string>> = {
  specify:   'spec.md and its clarifications',
  plan:      'plan.md and its design',
  tasks:     'tasks.md written, none ticked',
  implement: 'ticking tasks.md',
  converge:  'the convergence tasks',
  done:      'every task ticked',
};

const SPEC_LANE_EMPTY_TEXTS: Readonly<Record<SpecLane, string>> = {
  specify:   'No spec being specified',
  plan:      'No spec being planned',
  tasks:     'No spec waiting on its tasks',
  implement: 'No spec being implemented',
  converge:  'No spec converging',
  done:      'No spec done yet',
};


interface SpecWorkItem {
  readonly spec:     SnapshotSpec;
  readonly workItem: WorkItem;
}

function countedText(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function cardsElementIdOf(band: SpecKanbanBandName, laneKey: string): string {
  return `ap-spec-${band}-lane-${laneKey}-cards`;
}

export function cardElementIdOf(band: SpecKanbanBandName, identity: string): string {
  return `ap-spec-${band}-card-${identity}`;
}

function plainHead(idText: string, slotMarkup: string): LaneCardHead {
  return {
    idText, priority: 'normal', ticketType: null, slotMarkup, hasNeededFirst: false, heldCount: null, tokenCount: null
  };
}

function specPlanDateText(spec: SnapshotSpec, input: SpecKanbanInput): string {
  const plan = spec.artefacts.find((artefact) => artefact.kind === 'plan');
  const date = plan?.modified ?? plan?.created ?? null;
  return date === null ? 'Plan written' : `Plan written ${TimeUtil.shortStampText(date.at, input.todayCalendarDate, input.slices)}`;
}

function specSpecifyLine(spec: SnapshotSpec): string {
  const { openMarkers, clarificationSessions } = spec.counts;
  if (openMarkers > 0) {
    return countedText(openMarkers, 'open clarification', 'open clarifications');
  }
  return clarificationSessions > 0 ? countedText(clarificationSessions, 'clarify session', 'clarify sessions') : 'No open clarifications';
}

function specConvergeLine(spec: SnapshotSpec): string {
  const convergence = spec.workItems.filter((workItem) => workItem.kind === 'convergence');
  const ticked = convergence.reduce((sum, workItem) => sum + workItem.tickedCount, 0);
  const total  = convergence.reduce((sum, workItem) => sum + workItem.taskCount, 0);
  return `Convergence ${ticked} of ${total}`;
}

function specLaneLine(spec: SnapshotSpec, input: SpecKanbanInput): string {
  switch (spec.lane) {
    case 'specify':
      return specSpecifyLine(spec);
    case 'plan':
      return specPlanDateText(spec, input);
    case 'tasks':
      return `${countedText(spec.tasks.total, 'task', 'tasks')} written, none ticked`;
    case 'implement':
      return `${spec.tasks.ticked} of ${countedText(spec.tasks.total, 'task', 'tasks')} ticked`;
    case 'converge':
      return specConvergeLine(spec);
    case 'done':
      return 'Every task ticked';
  }
}

function specSlotMarkup(spec: SnapshotSpec): string {
  const rollup = spec.lane === 'implement' ? `<span class="ap-spec-card-rollup">${GroupMarkup.rollupBarMarkup(SpecGroupMarks.specRollupOf(spec))}</span>` : '';
  return `${GroupMarkup.swatchMarkup(SpecGroupMarks.specMarkOf(spec))}${specStepperMarkup(spec.stepper, 'compact')}${rollup}`;
}

function specCardOf(spec: SnapshotSpec, input: SpecKanbanInput): LaneCardModel {
  return {
    elementId:     cardElementIdOf('specs', spec.folderName),
    identity:      { attribute: SPEC_KEY_ATTRIBUTE, value: spec.folderName },
    stateToken:    DISPLAY_STATE_FOR_SPEC_LANE[spec.lane],
    hasStripe:     true,
    ariaLabel:     `Spec ${SpecGroupMarks.specMarkOf(spec).title}, ${SPEC_LANE_TITLES[spec.lane]}`,
    head:          plainHead(SpecGroupMarks.specKeyOf(spec), specSlotMarkup(spec)),
    title:         spec.title,
    chips:         null,
    marks:         { waitingOn: [], heldTitle: null, noRowTitle: null },
    note:          specLaneLine(spec, input),
    pill:          null,
    reviewedTitle: null,
    stamp:         null,
    opensDetail:   true,
  };
}

function laneOf(band: SpecKanbanBandName, key: string, title: string, dotState: DisplayState, line: string, cards: readonly LaneCardModel[], emptyText: string): LaneModel {
  return {
    key,
    title,
    dotState,
    count:          cards.length,
    subtitle:       { kind: 'text', text: line },
    cardsElementId: cardsElementIdOf(band, key),
    collapse:       null,
    body:           cards.length === 0 ? { kind: 'empty', text: emptyText } : { kind: 'groups', groups: [{ kind: 'plain', cards }] },
    footer:         null,
  };
}

function specsBandOf(input: SpecKanbanInput): SpecKanbanBand {
  const lanes = SPEC_LANES.map((lane) => laneOf(
    'specs',
    lane,
    SPEC_LANE_TITLES[lane],
    DISPLAY_STATE_FOR_SPEC_LANE[lane],
    SPEC_LANE_LINES[lane],
    input.snapshot.specs.filter((spec) => spec.lane === lane).map((spec) => specCardOf(spec, input)),
    SPEC_LANE_EMPTY_TEXTS[lane],
  ));
  return { cardCount: input.snapshot.specs.length, lanes };
}

function tickBarMarkup(workItem: WorkItem): string {
  const share = workItem.taskCount === 0 ? 0 : workItem.tickedCount / workItem.taskCount;
  const text  = `${workItem.tickedCount} of ${countedText(workItem.taskCount, 'task', 'tasks')}`;
  return `<span class="ap-spec-ticks"><span>${HtmlEscapeUtil.escapeHtml(text)}</span>`
    + `<span class="ap-spec-tick-bar" aria-hidden="true"><span ${MarkupUtil.attribute('style', `width:${MarkupUtil.percentText(share * 100)}`)}></span></span></span>`;
}

function workSlotMarkup(workItem: WorkItem): string {
  const minimumViableProduct = workItem.isMinimumViableProduct ? '<span class="ap-spec-mvp" title="Minimum viable product">MVP</span>' : '';
  return `${SpecGroupMarks.phaseTagMarkup(workItem)}${minimumViableProduct}${tickBarMarkup(workItem)}`;
}

function taskRangeTextOf(workItem: WorkItem): string {
  const first = workItem.tasks[0];
  const last  = workItem.tasks.at(-1);
  if (first === undefined || last === undefined) {
    return '';
  }
  return first === last ? first.id : `${first.id}–${last.id}`;
}

function workCardOf(entry: SpecWorkItem, phaseTagTextById: ReadonlyMap<string, string>): LaneCardModel {
  const { spec, workItem } = entry;
  const displayState = DISPLAY_STATE_FOR_WORK_ITEM_STATE[workItem.state];
  const waitingOn    = workItem.waitingOn.map((workItemId) => ({
    text:          phaseTagTextById.get(workItemId) ?? workItemId,
    href:          `#${cardElementIdOf('work', workItemId)}`,
    hookAttribute: { name: SPEC_MARK_VOCABULARY.itemOpenerAttribute, value: workItemId },
  }));
  const specMark = SpecGroupMarks.specMarkOf(spec);
  return {
    elementId:     cardElementIdOf('work', workItem.id),
    identity:      { attribute: WORK_ITEM_ID_ATTRIBUTE, value: workItem.id },
    stateToken:    displayState,
    hasStripe:     true,
    ariaLabel:     `${specMark.title} ${SpecGroupMarks.phaseTagTextOf(workItem)} ${workItem.title}, ${STATE_LABEL_FOR_DISPLAY_STATE[displayState]}`,
    head:          plainHead(taskRangeTextOf(workItem), workSlotMarkup(workItem)),
    title:         workItem.title,
    chips:         { groups: [specMark], vocabulary: SPEC_MARK_VOCABULARY },
    marks:         { waitingOn, heldTitle: null, noRowTitle: null },
    note:          null,
    pill:          null,
    reviewedTitle: null,
    stamp:         null,
    opensDetail:   true,
  };
}

/** By spec in folder order, then by phase; in To do the items waiting on nothing come first. */
function orderedWorkItems(entries: readonly SpecWorkItem[], state: WorkItemState): SpecWorkItem[] {
  const byPlace = [...entries].sort((a, b) => a.spec.folderName.localeCompare(b.spec.folderName) || a.workItem.ordinal - b.workItem.ordinal);
  if (state !== 'to-do') {
    return byPlace;
  }
  return [...byPlace.filter((entry) => entry.workItem.waitingOn.length === 0), ...byPlace.filter((entry) => entry.workItem.waitingOn.length > 0)];
}

function workBandOf(snapshot: SpecSnapshot): SpecKanbanBand {
  const entries          = snapshot.specs.flatMap((spec) => spec.workItems.map((workItem) => ({ spec, workItem })));
  const phaseTagTextById = new Map(entries.map((entry) => [entry.workItem.id, SpecGroupMarks.phaseTagTextOf(entry.workItem)]));
  const lanes = WORK_ITEM_STATES.map((state) => {
    const displayState = DISPLAY_STATE_FOR_WORK_ITEM_STATE[state];
    const title        = STATE_LABEL_FOR_DISPLAY_STATE[displayState];
    return laneOf(
      'work',
      state,
      title,
      displayState,
      state === 'to-do' ? 'ready first, then waiting' : 'by spec and phase',
      orderedWorkItems(entries.filter((entry) => entry.workItem.state === state), state).map((entry) => workCardOf(entry, phaseTagTextById)),
      `Nothing ${title.toLowerCase()}`,
    );
  });
  return { cardCount: entries.length, lanes };
}

export function specKanbanModelOf(input: SpecKanbanInput): SpecKanbanModel {
  return { specsBand: specsBandOf(input), workBand: workBandOf(input.snapshot) };
}
