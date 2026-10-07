import type { SpecLane } from '../../../src/lib/spec-snapshot/constants/SpecSnapshotVocabulary.ts';

export const SPEC_LANE_TITLES: Readonly<Record<SpecLane, string>> = Object.freeze({
  specify:   'Specify',
  plan:      'Plan',
  tasks:     'Tasks',
  implement: 'Implement',
  converge:  'Converge',
  done:      'Done',
});
