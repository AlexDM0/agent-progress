/** The spec page's header model: the project, how many specs there are and how many are implementing, the tasks ticked, open clarifications. */

import type { SpecSnapshot } from '../../../src/lib/spec-snapshot/@types/SpecSnapshot.ts';
import type { HeaderModel }  from '../../header/@types/HeaderModel.ts';

export type SpecHeaderSource = Pick<SpecSnapshot, 'project' | 'specs' | 'laneCounts' | 'tasks' | 'openMarkers'>;

export function specHeaderModelOf(snapshot: SpecHeaderSource): HeaderModel {
  return {
    projectTitle: snapshot.project,
    statistics:   [
      {
        figure: String(snapshot.specs.length), label: 'specs', opensLane: null, state: null
      },
      {
        figure: String(snapshot.laneCounts.implement), label: 'implementing', opensLane: null, state: null
      },
      {
        figure: `${snapshot.tasks.ticked} / ${snapshot.tasks.total}`, label: 'tasks', opensLane: null, state: null
      },
      {
        figure: String(snapshot.openMarkers.length), label: 'open clarifications', opensLane: null, state: null
      },
    ],
  };
}
