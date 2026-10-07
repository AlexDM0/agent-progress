import type {
  SourceArtefact,
  SourceFeature,
  SourceFileDates,
  SourceFillState,
  SourcePhaseKind,
  SourceTaskPhase,
  SpecSnapshotSource
} from '../lib/spec-snapshot/@types/SpecSnapshotSource.ts';

export const EXAMPLE_FILE_DATES: SourceFileDates = {
  created:  { at: '2026-09-01T08:00:00.000Z', source: 'birth-time' },
  modified: { at: '2026-09-02T08:00:00.000Z', source: 'modification-time' },
};

export interface PhaseDescription {
  readonly kind:         SourcePhaseKind;
  readonly ticked:       number;
  readonly total:        number;
  readonly storyNumber?: number;
}

/** A phase of `total` tasks, the first `ticked` of them done; ordinals are given by `sourceFeature` in list order. */
export function phase(kind: SourcePhaseKind, ticked: number, total: number, storyNumber?: number): PhaseDescription {
  return storyNumber === undefined ? { kind, ticked, total } : {
    kind, ticked, total, storyNumber
  };
}

function taskPhaseOf(description: PhaseDescription, index: number): SourceTaskPhase {
  const ordinal = index + 1;
  const storyNumber = description.storyNumber ?? null;
  return {
    ordinal,
    name:                   `Phase ${ordinal}: Example ${description.kind}`,
    kind:                   description.kind,
    storyNumber,
    storyPriority:          storyNumber,
    isMinimumViableProduct: storyNumber === 1,
    tasks:                  Array.from({ length: description.total }, (_unused, taskIndex) => ({
      id:          `T${ordinal}${taskIndex}`,
      isDone:      taskIndex < description.ticked,
      isParallel:  false,
      storyNumber,
      description: `Example task ${taskIndex}`,
    })),
  };
}

function artefactOf<Document>(relativePath: string, fillState: SourceFillState, document: Document, dates: SourceFileDates): SourceArtefact<Document> {
  return {
    relativePath, fillState, dates, document
  };
}

export interface FeatureDescription {
  readonly folderName?: string;
  /** Absent when the feature has no `plan.md`. */
  readonly plan?:       SourceFillState;
  /** Absent when the feature has no `tasks.md`; `template` for an untouched copy, whose phases are the template's. */
  readonly tasks?:      SourceFillState;
  readonly phases?:     readonly PhaseDescription[];
  readonly dates?:      SourceFileDates;
}

export function sourceFeature(description: FeatureDescription): SourceFeature {
  const folderName = description.folderName ?? '001-example-feature';
  const dates = description.dates ?? EXAMPLE_FILE_DATES;
  const phases = (description.phases ?? []).map(taskPhaseOf);
  return {
    folderName,
    relativePath: `specs/${folderName}`,
    spec:         artefactOf(`specs/${folderName}/spec.md`, 'filled', {
      title:                 'Example Feature',
      userStories:           [{ number: 1, title: 'Example story', priority: 1 }],
      requirementIds:        ['FR-001'],
      successCriterionIds:   ['SC-001'],
      openClarifications:    [],
      clarificationSessions: [],
    }, dates),
    plan:       description.plan === undefined ? null : artefactOf(`specs/${folderName}/plan.md`, description.plan, { openClarificationCount: 0 }, dates),
    research:   null,
    dataModel:  null,
    quickstart: null,
    contracts:  null,
    tasks:      description.tasks === undefined ? null : artefactOf(`specs/${folderName}/tasks.md`, description.tasks, { phases }, dates),
    checklists: [],
  };
}

export function sourceRepository(features: readonly SourceFeature[]): SpecSnapshotSource {
  return {
    rootDirectory: '/example/example-storefront', initOptions: null, constitution: null, features, unreadable: []
  };
}
