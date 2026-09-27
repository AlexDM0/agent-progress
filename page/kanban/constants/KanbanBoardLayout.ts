import type { ClosedKanbanLane } from '../../@types/KanbanLane.ts';

export const KANBAN_LANES = ['todo', 'progress', 'review', 'merge', 'done', 'abandoned'] as const;

export const CLOSED_KANBAN_LANES: readonly ClosedKanbanLane[] = ['done', 'abandoned'];

export const CAPPED_LANE_PAGE_STEP_CARDS = 25;
