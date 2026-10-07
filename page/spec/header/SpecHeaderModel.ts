/** The spec page's header model: the project, how many specs there are and how many are implementing, the tasks ticked, open clarifications. */

import type { SpecSnapshot } from '../../../src/lib/spec-snapshot/@types/SpecSnapshot.ts';
import type { SpecLane }     from '../../../src/lib/spec-snapshot/constants/SpecSnapshotVocabulary.ts';
import type { HeaderModel }  from '../../header/@types/HeaderModel.ts';

/** The Specs band's lane the `implementing` statistic opens. */
const IMPLEMENTING_LANE: SpecLane = 'implement';

export type SpecHeaderSource = Pick<SpecSnapshot, 'project' | 'specs' | 'laneCounts' | 'tasks' | 'openMarkers'>;

export function specHeaderModelOf(snapshot: SpecHeaderSource): HeaderModel {
  return {
    projectTitle: snapshot.project,
    statistics:   [
      {
        figure: String(snapshot.specs.length), label: 'specs', opensLane: null, state: null
      },
      {
        figure: String(snapshot.laneCounts.implement), label: 'implementing', opensLane: IMPLEMENTING_LANE, state: null
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
