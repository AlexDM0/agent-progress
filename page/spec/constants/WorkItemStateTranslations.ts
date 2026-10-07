/**
 * Every translation of a work-item state into tracker vocabulary lives in this file, so the badges, stripes and roll-ups share one table; a
 * spec lane reads as the state of the work it holds.
 */

import type { SpecLane, WorkItemState } from '../../../src/lib/spec-snapshot/constants/SpecSnapshotVocabulary.ts';
import type { DisplayState }            from '../../../src/lib/tracker-model/@types/Task.ts';

export const DISPLAY_STATE_FOR_WORK_ITEM_STATE: Readonly<Record<WorkItemState, DisplayState>> = Object.freeze({
  'to-do':       'pending',
  'in-progress': 'in-progress',
  'done':        'delivered',
});

const SPEC_LANE_AT_WORK_DISPLAY_STATE = DISPLAY_STATE_FOR_WORK_ITEM_STATE['in-progress'];

export const DISPLAY_STATE_FOR_SPEC_LANE: Readonly<Record<SpecLane, DisplayState>> = Object.freeze({
  specify:   SPEC_LANE_AT_WORK_DISPLAY_STATE,
  plan:      SPEC_LANE_AT_WORK_DISPLAY_STATE,
  tasks:     SPEC_LANE_AT_WORK_DISPLAY_STATE,
  implement: SPEC_LANE_AT_WORK_DISPLAY_STATE,
  converge:  SPEC_LANE_AT_WORK_DISPLAY_STATE,
  done:      DISPLAY_STATE_FOR_WORK_ITEM_STATE.done,
});
