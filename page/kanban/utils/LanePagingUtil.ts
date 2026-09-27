import { CAPPED_LANE_FIRST_PAGE_CARDS } from '../../constants/CappedLanePaging.ts';
import { CAPPED_LANE_PAGE_STEP_CARDS }  from '../constants/KanbanBoardLayout.ts';

/** A stored count is clamped to the first page … the lane's count, so a lane that shrank under Hide never shows an empty page. */
function cappedLaneShownCount(requested: number, laneCount: number): number {
  const wholeRequest = Number.isSafeInteger(requested) ? requested : CAPPED_LANE_FIRST_PAGE_CARDS;
  return Math.max(CAPPED_LANE_FIRST_PAGE_CARDS, Math.min(wholeRequest, laneCount));
}

function nextPageSizeFor(shownCount: number, laneCount: number): number {
  return Math.min(CAPPED_LANE_PAGE_STEP_CARDS, laneCount - shownCount);
}

function shownCountAfterMore(shownCount: number, laneCount: number): number {
  return cappedLaneShownCount(shownCount + CAPPED_LANE_PAGE_STEP_CARDS, laneCount);
}

export const LanePagingUtil = { cappedLaneShownCount, nextPageSizeFor, shownCountAfterMore } as const;
