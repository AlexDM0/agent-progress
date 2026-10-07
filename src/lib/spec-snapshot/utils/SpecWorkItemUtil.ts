import type { TickCount, WorkItem } from '../@types/SpecSnapshot.ts';
import type {
  SourceFeature,
  SourcePhaseKind,
  SourceTask,
  SourceTaskPhase
} from '../@types/SpecSnapshotSource.ts';
import type { WorkItemState } from '../constants/SpecLanes.ts';
import { SpecArtefactUtil }   from './SpecArtefactUtil.ts';

const ORDINAL_DIGITS = 2;

function tickCountOf(tasks: readonly SourceTask[]): TickCount {
  return { ticked: tasks.filter((task) => task.isDone).length, total: tasks.length };
}

function stateOf({ ticked, total }: TickCount): WorkItemState {
  if (ticked === 0) return 'to-do';
  return ticked === total ? 'done' : 'in-progress';
}

function workItemIdOf(folderName: string, phase: SourceTaskPhase): string {
  return `${folderName}-p${String(phase.ordinal).padStart(ORDINAL_DIGITS, '0')}`;
}

function tagTextOf(phase: SourceTaskPhase): string | null {
  if (phase.storyNumber === null) return null;
  return phase.storyPriority === null ? `US${phase.storyNumber}` : `US${phase.storyNumber} · P${phase.storyPriority}`;
}

/** The phases a phase waits on, by kind and file order alone. */
function dependencyPhasesOf(phase: SourceTaskPhase, phases: readonly SourceTaskPhase[]): readonly SourceTaskPhase[] {
  const ofKind = (kind: SourcePhaseKind): readonly SourceTaskPhase[] => phases.filter((candidate) => candidate.kind === kind);
  const position = phases.indexOf(phase);
  switch (phase.kind) {
    case 'setup':
      return [];
    case 'foundational':
      return ofKind('setup');
    case 'user-story':
      return ofKind('foundational').length > 0 ? ofKind('foundational') : ofKind('setup');
    case 'polish':
      return ofKind('user-story');
    case 'convergence': {
      const earlierConvergence = phases.slice(0, position).filter((candidate) => candidate.kind === 'convergence').at(-1);
      if (earlierConvergence !== undefined) return [earlierConvergence];
      return ofKind('polish').length > 0 ? ofKind('polish') : ofKind('user-story').slice(-1);
    }
    case 'other':
      return phases.slice(Math.max(0, position - 1), position);
  }
}

/** One work item per phase of a filled `tasks.md`; a template copy yields none. */
function workItemsOf(feature: SourceFeature): readonly WorkItem[] {
  const phases = SpecArtefactUtil.countedTasksOf(feature)?.document.phases ?? [];
  const stateByPhase = new Map(phases.map((phase) => [phase, stateOf(tickCountOf(phase.tasks))]));
  return phases.map((phase) => {
    const { ticked, total } = tickCountOf(phase.tasks);
    const dependencies = dependencyPhasesOf(phase, phases);
    return {
      id:                     workItemIdOf(feature.folderName, phase),
      ordinal:                phase.ordinal,
      kind:                   phase.kind,
      storyNumber:            phase.storyNumber,
      priority:               phase.storyPriority,
      isMinimumViableProduct: phase.isMinimumViableProduct,
      title:                  phase.name,
      tagText:                tagTextOf(phase),
      state:                  stateOf({ ticked, total }),
      taskCount:              total,
      tickedCount:            ticked,
      tasks:                  phase.tasks.map(({
        id, isDone, isParallel, storyNumber, description
      }) => ({
        id, isDone, isParallel, storyNumber, description
      })),
      dependsOn: dependencies.map((dependency) => workItemIdOf(feature.folderName, dependency)),
      waitingOn: dependencies.filter((dependency) => stateByPhase.get(dependency) !== 'done').map((dependency) => workItemIdOf(feature.folderName, dependency)),
    };
  });
}

export const SpecWorkItemUtil = { tickCountOf, workItemsOf } as const;
