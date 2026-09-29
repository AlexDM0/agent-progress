/**
 * The Kanban tab: the board of the visible cards, its overflow marks, the capped lanes' paging, the Abandoned toggle, the waiting-on links
 * and the summary's jumps to a lane.
 */

import type { KanbanCard }        from '../@types/KanbanCard.ts';
import type { ViewerPreferences } from '../@types/ViewerChoices.ts';
import {
  KANBAN_BOARD_ELEMENT_ID,
  KANBAN_FRAME_ELEMENT_ID,
  KANBAN_TAB_NAME,
  PANEL_COVER_PROPERTY,
  PANEL_ROOM_PROPERTY,
  SUMMARY_ELEMENT_ID,
} from '../constants/TemplateIds.ts';
import { DomUtil }                             from '../utils/DomUtil.ts';
import { TemplateIdUtil }                      from '../utils/TemplateIdUtil.ts';
import type { DurationUnits, TimestampSlices } from '../utils/TimeUtil.ts';
import type { KanbanLane }                     from './@types/KanbanLane.ts';
import { kanbanBoardMarkup }                   from './KanbanMarkup.ts';
import type { ClosedKanbanLane }               from './constants/KanbanBoardLayout.ts';
import { CAPPED_LANE_FIRST_PAGE_CARDS }        from './constants/KanbanBoardLayout.ts';
import { CLOSED_KANBAN_LANES, KANBAN_LANES }   from './constants/KanbanBoardLayout.ts';
import { CountTweenUtil }                      from './utils/CountTweenUtil.ts';
import { KanbanLaneUtil }                      from './utils/KanbanLaneUtil.ts';
import { LanePagingUtil }                      from './utils/LanePagingUtil.ts';

const LANE_HIGHLIGHT_MILLISECONDS = 1200;
const MOTION_DURATION_PROPERTY    = '--motion-base';
const MOTION_EASING_PROPERTY      = '--ease-out';
/** A lane whose width or card area changed by less than this is left still: sub-pixel rounding is no change. */
const LANE_SIZE_TOLERANCE_PIXELS  = 0.5;

interface LaneLayout {
  width:       number;
  cardsHeight: number;
  count:       number;
}

interface LaneMotion {
  durationMilliseconds: number;
  easing:               string;
}

/** The template's motion tokens, or null while they are 0ms: before the page is ready and under reduced motion, a change shows at once. */
function laneMotionOf(): LaneMotion | null {
  const rootStyle            = getComputedStyle(document.documentElement);
  const durationMilliseconds = CountTweenUtil.durationMillisecondsOf(rootStyle.getPropertyValue(MOTION_DURATION_PROPERTY));
  if (durationMilliseconds <= 0) {
    return null;
  }
  return { durationMilliseconds, easing: rootStyle.getPropertyValue(MOTION_EASING_PROPERTY).trim() || 'ease-out' };
}

function lanesOf(board: HTMLElement): HTMLElement[] {
  return [...board.querySelectorAll<HTMLElement>(':scope > .ap-lane[data-lane]')];
}

function laneLayoutsOf(board: HTMLElement): Map<string, LaneLayout> {
  return new Map(lanesOf(board).map((lane) => [lane.dataset['lane'] ?? '', {
    width:       lane.getBoundingClientRect().width,
    cardsHeight: lane.querySelector('.ap-lane-cards')?.getBoundingClientRect().height ?? 0,
    count:       Number.parseInt(lane.querySelector('.ap-lane-count')?.textContent ?? '', 10),
  }]));
}

function sizeChanged(previousPixels: number, nextPixels: number): boolean {
  return previousPixels > 0 && nextPixels > 0 && Math.abs(nextPixels - previousPixels) > LANE_SIZE_TOLERANCE_PIXELS;
}

function laneWidthKeyframeOf(widthPixels: number): Keyframe {
  const pixels = `${widthPixels}px`;
  return {
    flexGrow: '0', flexShrink: '0', flexBasis: pixels, minWidth: pixels
  };
}

function tweenCount(countElement: Element, fromCount: number, toCount: number, motion: LaneMotion): void {
  const startedAt = performance.now();
  const showFrame = (frameTime: number): void => {
    const easedProgress = CountTweenUtil.easedProgressOf(frameTime - startedAt, motion.durationMilliseconds);
    countElement.textContent = String(CountTweenUtil.countAt(fromCount, toCount, easedProgress));
    if (easedProgress < 1) {
      requestAnimationFrame(showFrame);
    }
  };
  countElement.textContent = String(fromCount);
  requestAnimationFrame(showFrame);
}

/**
 * Eases each lane from the layout it had before the board was redrawn to the one it has now: its width (the Abandoned strip
 * opening or closing), its card area's height (paging a closed lane) and its count. Every animation ends on the new layout,
 * so nothing jumps when it is removed. Every lane is measured before any animation starts, since each one moves its siblings.
 */
function easeLaneChanges(board: HTMLElement, previousLayouts: ReadonlyMap<string, LaneLayout>, motion: LaneMotion): void {
  const timing      = { duration: motion.durationMilliseconds, easing: motion.easing };
  const nextLayouts = laneLayoutsOf(board);
  for (const lane of lanesOf(board)) {
    const laneName = lane.dataset['lane'] ?? '';
    const previous = previousLayouts.get(laneName);
    const next     = nextLayouts.get(laneName);
    if (previous === undefined || next === undefined) {
      continue;
    }
    if (sizeChanged(previous.width, next.width)) {
      lane.animate([laneWidthKeyframeOf(previous.width), laneWidthKeyframeOf(next.width)], timing);
    }
    const cards = lane.querySelector<HTMLElement>('.ap-lane-cards');
    if (cards !== null && sizeChanged(previous.cardsHeight, next.cardsHeight)) {
      cards.animate([
        { flexGrow: '0', height: `${previous.cardsHeight}px` },
        { flexGrow: '0', height: `${next.cardsHeight}px` },
      ], timing);
    }
    const countElement = lane.querySelector('.ap-lane-count');
    if (countElement !== null && Number.isFinite(previous.count) && Number.isFinite(next.count) && previous.count !== next.count) {
      tweenCount(countElement, previous.count, next.count, motion);
    }
  }
}

export interface KanbanControllerSources {
  slices:                TimestampSlices & DurationUnits;
  preferences:           ViewerPreferences;
  readTodayCalendarDate: () => string;
  readShowsAllWork:      () => boolean;
}

export interface KanbanController {
  showCards(cards: readonly KanbanCard[]): void;
  readVisibleCards(): readonly KanbanCard[];
  updateOverflow(): void;
  wire(): void;
}

function updateOverflow(): void {
  const board = document.getElementById(KANBAN_BOARD_ELEMENT_ID);
  const frame = document.getElementById(KANBAN_FRAME_ELEMENT_ID);
  if (board === null || frame === null) {
    return;
  }
  // While the detail panel is open the board ends at the panel's edge: its added room is not content, and what the panel covers is not in view.
  const panelRoom   = Number.parseFloat(board.style.getPropertyValue(PANEL_ROOM_PROPERTY)) || 0;
  const panelCover  = Number.parseFloat(frame.style.getPropertyValue(PANEL_COVER_PROPERTY)) || 0;
  const directions  = KanbanLaneUtil.overflowDirectionsOf(board.scrollLeft, board.scrollWidth - panelRoom + panelCover, board.clientWidth);
  if (directions === null) {
    frame.removeAttribute('data-overflow');
  } else {
    frame.setAttribute('data-overflow', directions);
  }
}

function closedLaneNamedBy(value: string | undefined): ClosedKanbanLane | null {
  return CLOSED_KANBAN_LANES.find((lane) => lane === value) ?? null;
}

export function createKanbanController(sources: KanbanControllerSources): KanbanController {
  const {
    slices,
    preferences,
    readTodayCalendarDate,
    readShowsAllWork,
  } = sources;
  let visibleCards: readonly KanbanCard[] = [];
  let abandonedLaneIsOpen                 = preferences.readAbandonedLaneIsOpen();
  let laneHighlightTimer                  = 0;

  const showKanban = (): void => {
    const board           = document.getElementById(KANBAN_BOARD_ELEMENT_ID);
    const motion          = laneMotionOf();
    const previousLayouts = board !== null && motion !== null ? laneLayoutsOf(board) : null;
    DomUtil.setMarkup(KANBAN_BOARD_ELEMENT_ID, kanbanBoardMarkup({
      cards:                  visibleCards,
      nowEpochMilliseconds:   Date.now(),
      todayCalendarDate:      readTodayCalendarDate(),
      slices,
      showsAllWork:           readShowsAllWork(),
      shownCountByClosedLane: { done: preferences.readCappedLaneShownCount('done'), abandoned: preferences.readCappedLaneShownCount('abandoned') },
      abandonedLaneIsOpen,
    }));
    updateOverflow();
    if (board !== null && motion !== null && previousLayouts !== null) {
      easeLaneChanges(board, previousLayouts, motion);
    }
  };
  const toggleAbandonedLane = (laneIsOpen = !abandonedLaneIsOpen): void => {
    abandonedLaneIsOpen = laneIsOpen;
    preferences.writeAbandonedLaneIsOpen(laneIsOpen);
    showKanban();
  };

  /** Shows the Kanban tab and brings the dependency's card into view with focus; a card the board does not hold is left alone. */
  const followKanbanLink = (ticketId: string): void => {
    DomUtil.templateBehaviour()?.selectTab(KANBAN_TAB_NAME);
    const cardId = TemplateIdUtil.kanbanCardElementIdOf(ticketId);
    if ((document.getElementById(cardId)?.closest('[data-collapsed]') ?? null) !== null) {
      toggleAbandonedLane(true);
    }
    updateOverflow();
    const card = document.getElementById(cardId);
    if (card !== null) {
      card.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      card.focus();
    }
  };

  /** Shows the Kanban tab, brings the lane into view and outlines it in its dot's state edge for `LANE_HIGHLIGHT_MILLISECONDS`. */
  const showLane = (lane: KanbanLane): void => {
    DomUtil.templateBehaviour()?.selectTab(KANBAN_TAB_NAME);
    updateOverflow();
    const laneElement = document.querySelector<HTMLElement>(`#${KANBAN_BOARD_ELEMENT_ID} .ap-lane[data-lane="${lane}"]`);
    if (laneElement === null) {
      return;
    }
    const motionIsReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Only the board scrolls sideways: a lane taller than the window would otherwise scroll the page past the summary and the tabs.
    const board    = document.getElementById(KANBAN_BOARD_ELEMENT_ID);
    const laneBox  = laneElement.getBoundingClientRect();
    const boardBox = board?.getBoundingClientRect();
    if (board !== null && boardBox !== undefined) {
      const overflowLeft  = laneBox.left - boardBox.left;
      const overflowRight = laneBox.right - boardBox.right;
      const scrollDelta   = overflowLeft < 0 ? overflowLeft : Math.max(0, overflowRight);
      board.scrollBy({ left: scrollDelta, behavior: motionIsReduced ? 'auto' : 'smooth' });
    }
    const dot = laneElement.querySelector('.ap-lane-dot');
    if (dot !== null) {
      laneElement.style.setProperty('--lane-highlight-edge', getComputedStyle(dot).getPropertyValue('--s-edge'));
    }
    document.querySelectorAll(`#${KANBAN_BOARD_ELEMENT_ID} .ap-lane[data-highlighted]`).forEach((highlightedLane) => highlightedLane.removeAttribute('data-highlighted'));
    // Reading the layout between the removal and the setting restarts the animation when the same lane is asked for twice.
    void laneElement.offsetWidth;
    laneElement.setAttribute('data-highlighted', '');
    window.clearTimeout(laneHighlightTimer);
    laneHighlightTimer = window.setTimeout(() => laneElement.removeAttribute('data-highlighted'), LANE_HIGHLIGHT_MILLISECONDS);
  };

  const wire = (): void => {
    document.getElementById(SUMMARY_ELEMENT_ID)?.addEventListener('click', (event) => {
      const statistic = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-kanban-lane]') : null;
      const lane      = KANBAN_LANES.find((candidate) => candidate === statistic?.dataset['kanbanLane']);
      if (lane !== undefined) {
        showLane(lane);
      }
    });
    const board = document.getElementById(KANBAN_BOARD_ELEMENT_ID);
    board?.addEventListener('scroll', updateOverflow, { passive: true });
    // The template's own tab listener was added first, so the panel is already shown when this measures it.
    document.getElementById('ap-tabs')?.addEventListener('click', updateOverflow);
    board?.addEventListener('click', (event) => {
      const control = event.target instanceof Element ? event.target.closest('[data-lane-more], [data-lane-reset], .ap-lane-toggle, [data-ticket-link]') : null;
      if (!(control instanceof HTMLElement)) {
        return;
      }
      const linkedTicketId = control.dataset['ticketLink'];
      if (linkedTicketId !== undefined) {
        event.preventDefault();
        followKanbanLink(linkedTicketId);
        return;
      }
      if (control.classList.contains('ap-lane-toggle')) {
        toggleAbandonedLane();
        document.querySelector<HTMLElement>(`#${KANBAN_BOARD_ELEMENT_ID} .ap-lane-toggle`)?.focus();
        return;
      }
      const moreLane = closedLaneNamedBy(control.dataset['laneMore']);
      const lane     = moreLane ?? closedLaneNamedBy(control.dataset['laneReset']);
      if (lane === null) {
        return;
      }
      const laneCount    = KanbanLaneUtil.cardsInLane(visibleCards, lane).length;
      const currentCount = LanePagingUtil.cappedLaneShownCount(preferences.readCappedLaneShownCount(lane), laneCount);
      preferences.writeCappedLaneShownCount(lane, moreLane === null ? CAPPED_LANE_FIRST_PAGE_CARDS : LanePagingUtil.shownCountAfterMore(currentCount, laneCount));
      showKanban();
    });
  };

  return {
    showCards: (cards) => {
      visibleCards = cards;
      showKanban();
    },
    readVisibleCards: () => visibleCards,
    updateOverflow,
    wire,
  };
}
