export const KANBAN_LANES = ['todo', 'progress', 'review', 'merge', 'done', 'abandoned'] as const;

export type ClosedKanbanLane = 'done' | 'abandoned';

export const CLOSED_KANBAN_LANES: readonly ClosedKanbanLane[] = ['done', 'abandoned'];

export const CAPPED_LANE_FIRST_PAGE_CARDS = 15;

export const CAPPED_LANE_PAGE_STEP_CARDS = 25;
