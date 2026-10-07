/** A spec's lanes in the order its work moves through them; the stepper's stages are every lane but the last. */
export const SPEC_LANES = ['specify', 'plan', 'tasks', 'implement', 'converge', 'done'] as const;

export type SpecLane = typeof SPEC_LANES[number];

export const WORK_ITEM_STATES = ['to-do', 'in-progress', 'done'] as const;

export type WorkItemState = typeof WORK_ITEM_STATES[number];

export type SpecStage = 'specify' | 'plan' | 'implement';

export const SPEC_COLOUR_SLOT_COUNT = 6;
