import type { SnapshotArtefact, SpecArtefactKind } from '../@types/SpecSnapshot.ts';
import type {
  SourceArtefact,
  SourceFeature,
  SourceFileDates,
  SourcePlanDocument,
  SourceTasksDocument
} from '../@types/SpecSnapshotSource.ts';
import { SpecDateUtil } from './SpecDateUtil.ts';

/** A template copy is no progress, so it counts as absent for the lane, the work items and the stage spans alike. */
function countedPlanOf(feature: SourceFeature): SourceArtefact<SourcePlanDocument> | null {
  return feature.plan?.fillState === 'filled' ? feature.plan : null;
}

function countedTasksOf(feature: SourceFeature): SourceArtefact<SourceTasksDocument> | null {
  return feature.tasks?.fillState === 'filled' ? feature.tasks : null;
}

function artefactOf(
  kind: SpecArtefactKind,
  found: { readonly relativePath: string; readonly dates: SourceFileDates; readonly fillState?: 'template' | 'filled' } | null
): SnapshotArtefact[] {
  return found === null ? [] : [{
    kind, relativePath: found.relativePath, state: found.fillState ?? 'filled', ...SpecDateUtil.snapshotDatesOf(found.dates)
  }];
}

/** Every artefact present, template copies included with their state, in the order spec-kit writes them. */
function artefactsOf(feature: SourceFeature): readonly SnapshotArtefact[] {
  return [
    ...artefactOf('spec', feature.spec),
    ...artefactOf('plan', feature.plan),
    ...artefactOf('research', feature.research),
    ...artefactOf('data-model', feature.dataModel),
    ...artefactOf('quickstart', feature.quickstart),
    ...artefactOf('contracts', feature.contracts),
    ...artefactOf('tasks', feature.tasks),
    ...feature.checklists.flatMap((checklist) => artefactOf('checklist', checklist)),
  ];
}

export const SpecArtefactUtil = { artefactsOf, countedPlanOf, countedTasksOf } as const;
