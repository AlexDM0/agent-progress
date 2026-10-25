/** The tracker page's Kanban tab: its board model drawn by the shared lane board and card renderers. */

import type { KanbanCard }                         from '../@types/KanbanCard.ts';
import type { KanbanBoardInput, KanbanCardFormat } from './@types/KanbanBoardInput.ts';
import type { KanbanLane }                         from './@types/KanbanLane.ts';
import { kanbanCardModelOf }                       from './KanbanBoardModel.ts';
import { kanbanLaneFooterOf }                      from './KanbanBoardModel.ts';
import { kanbanLaneModelOf }                       from './KanbanBoardModel.ts';
import { kanbanLaneModelsOf }                      from './KanbanBoardModel.ts';
import { laneBoardMarkup }                         from './LaneBoardMarkup.ts';
import { laneFooterMarkup }                        from './LaneBoardMarkup.ts';
import { laneMarkup }                              from './LaneBoardMarkup.ts';
import { laneCardMarkup }                          from './LaneCardMarkup.ts';
import type { ClosedKanbanLane }                   from './constants/KanbanBoardLayout.ts';

export function kanbanCardMarkup(card: KanbanCard, lane: KanbanLane, format: KanbanCardFormat): string {
  return laneCardMarkup(kanbanCardModelOf(card, lane, format));
}

/** The paging while the lane holds more than a page, then what the finished-work choice leaves out of it, with a way to show it all. */
export function cappedLaneFooterMarkup(lane: ClosedKanbanLane, shownCount: number, laneCount: number, hiddenCount = 0): string {
  return laneFooterMarkup(lane, kanbanLaneFooterOf(shownCount, laneCount, hiddenCount));
}

export function kanbanLaneMarkup(lane: KanbanLane, input: KanbanBoardInput): string {
  return laneMarkup(kanbanLaneModelOf(lane, input));
}

export function kanbanBoardMarkup(input: KanbanBoardInput): string {
  return laneBoardMarkup(kanbanLaneModelsOf(input));
}
