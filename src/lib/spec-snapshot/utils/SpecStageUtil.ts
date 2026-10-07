import type { SpecStepper, StageSpan } from '../@types/SpecSnapshot.ts';
import type { SourceFeature }          from '../@types/SpecSnapshotSource.ts';
import type { SpecLane }               from '../constants/SpecLanes.ts';
import { SPEC_LANES }                  from '../constants/SpecLanes.ts';
import { SpecArtefactUtil }            from './SpecArtefactUtil.ts';
import { SpecDateUtil }                from './SpecDateUtil.ts';

/** The first lane whose rule holds, read from `done` down to `specify`; no date takes part. */
function laneOf(feature: SourceFeature): SpecLane {
  const tasks = SpecArtefactUtil.countedTasksOf(feature);
  if (tasks === null) return SpecArtefactUtil.countedPlanOf(feature) === null ? 'specify' : 'plan';
  const everyTask = tasks.document.phases.flatMap((phase) => phase.tasks);
  const tickedCount = everyTask.filter((task) => task.isDone).length;
  if (everyTask.length > 0 && tickedCount === everyTask.length) return 'done';
  if (tickedCount === 0) return 'tasks';
  const outsideConvergenceAllTicked = tasks.document.phases
    .filter((phase) => phase.kind !== 'convergence')
    .every((phase) => phase.tasks.every((task) => task.isDone));
  return outsideConvergenceAllTicked ? 'converge' : 'implement';
}

function stepperOf(lane: SpecLane): SpecStepper {
  return {
    doneLanes:   SPEC_LANES.slice(0, SPEC_LANES.indexOf(lane)),
    currentLane: lane === 'done' ? null : lane,
  };
}

function stageSpansOf(feature: SourceFeature): readonly StageSpan[] {
  const plan = SpecArtefactUtil.countedPlanOf(feature);
  const tasks = SpecArtefactUtil.countedTasksOf(feature);
  const planStart = plan === null ? null : { artefact: 'plan', date: SpecDateUtil.snapshotDateOf(plan.dates.created) } as const;
  const tasksStart = tasks === null ? null : { artefact: 'tasks', date: SpecDateUtil.snapshotDateOf(tasks.dates.created) } as const;
  const specifyEnd = planStart ?? tasksStart;
  const spans: StageSpan[] = [{
    stage:  'specify',
    start:  { artefact: 'spec', date: SpecDateUtil.snapshotDateOf(feature.spec.dates.created) },
    end:    specifyEnd,
    isOpen: specifyEnd === null,
  }];
  if (planStart !== null) spans.push({
    stage: 'plan', start: planStart, end: tasksStart, isOpen: tasksStart === null
  });
  if (tasks !== null && tasksStart !== null) {
    const everyTask = tasks.document.phases.flatMap((phase) => phase.tasks);
    const everyTaskTicked = everyTask.length > 0 && everyTask.every((task) => task.isDone);
    const implementEnd = everyTaskTicked ? { artefact: 'tasks', date: SpecDateUtil.snapshotDateOf(tasks.dates.modified) } as const : null;
    spans.push({
      stage: 'implement', start: tasksStart, end: implementEnd, isOpen: implementEnd === null
    });
  }
  return spans;
}

export const SpecStageUtil = { laneOf, stageSpansOf, stepperOf } as const;
