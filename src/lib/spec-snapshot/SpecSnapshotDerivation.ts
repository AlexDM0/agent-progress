/**
 * Everything a spec page shows, derived from a scanned repository and the caller's time, so the page keeps no copy of the rules. The package
 * depends on `src/lib/tracker-model` and `src/lib/local-time`.
 */
import { LocalTimeUtil }                                       from '../local-time/LocalTimeUtil.ts';
import { TicketBodyHashUtil }                                  from '../tracker-model/utils/TicketBodyHashUtil.ts';
import type { SnapshotOpenMarker, SnapshotSpec, SpecSnapshot } from './@types/SpecSnapshot.ts';
import type { SourceFeature, SpecSnapshotSource }              from './@types/SpecSnapshotSource.ts';
import type { SpecLane }                                       from './constants/SpecLanes.ts';
import { SPEC_COLOUR_SLOT_COUNT, SPEC_LANES }                  from './constants/SpecLanes.ts';
import { SpecArtefactUtil }                                    from './utils/SpecArtefactUtil.ts';
import { SpecStageUtil }                                       from './utils/SpecStageUtil.ts';
import { SpecWorkItemUtil }                                    from './utils/SpecWorkItemUtil.ts';

const LEADING_NUMBER_PATTERN = /^(\d+)/;

function lastPathSegmentOf(path: string): string {
  return path.split(/[\\/]/).filter((segment) => segment !== '').at(-1) ?? path;
}

function folderNumberOf(folderName: string): number | null {
  const digits = LEADING_NUMBER_PATTERN.exec(folderName)?.[1];
  return digits === undefined ? null : Number(digits);
}

function specOf(feature: SourceFeature, folderIndex: number): SnapshotSpec {
  const spec = feature.spec.document;
  const plan = SpecArtefactUtil.countedPlanOf(feature);
  const lane = SpecStageUtil.laneOf(feature);
  const workItems = SpecWorkItemUtil.workItemsOf(feature);
  const everyTask = SpecArtefactUtil.countedTasksOf(feature)?.document.phases.flatMap((phase) => phase.tasks) ?? [];
  return {
    folderName: feature.folderName,
    number:     folderNumberOf(feature.folderName),
    title:      spec.title,
    colourSlot: (folderIndex % SPEC_COLOUR_SLOT_COUNT) + 1,
    lane,
    stepper:    SpecStageUtil.stepperOf(lane),
    stories:    spec.userStories.map(({ number, title, priority }) => ({
      number,
      title,
      priority,
      phaseState: workItems.find((item) => item.kind === 'user-story' && item.storyNumber === number)?.state ?? null,
    })),
    counts: {
      functionalRequirements: spec.requirementIds.length,
      successCriteria:        spec.successCriterionIds.length,
      openMarkers:            spec.openClarifications.length + (plan?.document.openClarificationCount ?? 0),
      clarificationSessions:  spec.clarificationSessions.length,
      clarificationAnswers:   spec.clarificationSessions.reduce((sum, session) => sum + session.answers.length, 0),
    },
    artefacts:  SpecArtefactUtil.artefactsOf(feature),
    checklists: feature.checklists.map((checklist) => ({
      relativePath: checklist.relativePath,
      title:        checklist.document.title,
      checked:      checklist.document.items.filter((item) => item.isChecked).length,
      total:        checklist.document.items.length,
    })),
    tasks:      SpecWorkItemUtil.tickCountOf(everyTask),
    workItems,
    stageSpans: SpecStageUtil.stageSpansOf(feature),
  };
}

function openMarkersOf(feature: SourceFeature): readonly SnapshotOpenMarker[] {
  return feature.spec.document.openClarifications.map(({ text, line }) => ({
    folderName:   feature.folderName,
    relativePath: feature.spec.relativePath,
    text,
    line,
  }));
}

export function deriveSpecSnapshot(source: SpecSnapshotSource, generatedAt: Date): SpecSnapshot {
  const specs = source.features.map(specOf);
  const laneCounts = Object.fromEntries(SPEC_LANES.map((lane) => [lane, specs.filter((spec) => spec.lane === lane).length])) as Record<SpecLane, number>;
  const { constitution } = source;
  return {
    project:        lastPathSegmentOf(source.rootDirectory),
    repositoryKey:  TicketBodyHashUtil.bodyHashOf(source.rootDirectory),
    generatedAt:    LocalTimeUtil.formatLocalIso(generatedAt),
    specKitVersion: source.initOptions?.document.speckitVersion ?? null,
    constitution:   constitution === null ? null : {
      state:       constitution.fillState,
      version:     constitution.document.version,
      ratified:    constitution.document.ratifiedDate,
      lastAmended: constitution.document.lastAmendedDate,
      principles:  constitution.document.principleNames,
    },
    laneCounts,
    tasks: {
      ticked: specs.reduce((sum, spec) => sum + spec.tasks.ticked, 0),
      total:  specs.reduce((sum, spec) => sum + spec.tasks.total, 0),
    },
    openMarkers: source.features.flatMap(openMarkersOf),
    unreadable:  source.unreadable,
    specs,
  };
}
