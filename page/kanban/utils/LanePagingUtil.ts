import { CAPPED_LANE_FIRST_PAGE } from '../../constants/KanbanLane.ts';
import { CAPPED_LANE_PAGE_STEP }  from '../constants/KanbanBoardLayout.ts';

/** A stored count is clamped to the first page … the lane's count, so a lane that shrank under Hide never shows an empty page. */
function cappedLaneShownCount(requested: number, laneCount: number): number {
  const wholeRequest = Number.isSafeInteger(requested) ? requested : CAPPED_LANE_FIRST_PAGE;
  return Math.max(CAPPED_LANE_FIRST_PAGE, Math.min(wholeRequest, laneCount));
}

function nextPageSizeFor(shownCount: number, laneCount: number): number {
  return Math.min(CAPPED_LANE_PAGE_STEP, laneCount - shownCount);
}

function shownCountAfterMore(shownCount: number, laneCount: number): number {
  return cappedLaneShownCount(shownCount + CAPPED_LANE_PAGE_STEP, laneCount);
}

export const LanePagingUtil = { cappedLaneShownCount, nextPageSizeFor, shownCountAfterMore } as const;
