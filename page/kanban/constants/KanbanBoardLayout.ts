import type { KanbanLane } from '../../constants/KanbanLane.ts';

export const KANBAN_LANES: readonly KanbanLane[] = ['todo', 'progress', 'review', 'merge', 'done', 'abandoned'];

export const CAPPED_LANE_PAGE_STEP = 25;
