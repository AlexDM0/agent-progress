/** The snapshot's values: a spec's lanes in the order its work moves through them (the stepper's stages are every lane but the last), its
 * work item states, its stage span stages, and the colour slots it cycles through. */
export const SPEC_LANES = ['specify', 'plan', 'tasks', 'implement', 'converge', 'done'] as const;

export type SpecLane = typeof SPEC_LANES[number];

export const WORK_ITEM_STATES = ['to-do', 'in-progress', 'done'] as const;

export type WorkItemState = typeof WORK_ITEM_STATES[number];

export type SpecStage = 'specify' | 'plan' | 'implement';

export const SPEC_COLOUR_SLOT_COUNT = 6;
