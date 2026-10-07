/**
 * One lane board's live behaviour on either page: redrawing it with its lanes eased and its counts tweened, the fades at its overflow edges,
 * bringing a lane into view and following a card link to its card. What one board alone has, such as the tracker page's Abandoned toggle, stays
 * with that board's own controller.
 */

import { KANBAN_TAB_NAME, PANEL_COVER_PROPERTY, PANEL_ROOM_PROPERTY } from '../constants/TemplateIds.ts';
import { DomUtil }                                                    from '../utils/DomUtil.ts';
import { CountTweenUtil }                                             from './utils/CountTweenUtil.ts';
import { KanbanLaneUtil }                                             from './utils/KanbanLaneUtil.ts';

const LANE_HIGHLIGHT_MILLISECONDS = 1200;
const MOTION_DURATION_PROPERTY    = '--motion-base';
const MOTION_EASING_PROPERTY      = '--ease-out';
/** A lane whose width or card area changed by less than this is left still: sub-pixel rounding is no change. */
const LANE_SIZE_TOLERANCE_PIXELS  = 0.5;
const TABS_ELEMENT_ID             = 'ap-tabs';

interface LaneLayout {
  width:       number;
  cardsHeight: number;
  count:       number;
}

interface LaneMotion {
  durationMilliseconds: number;
  easing:               string;
}

export interface LaneBoardSettings {
  boardElementId:  string;
  frameElementId:  string;
  cardElementIdOf: (cardKey: string) => string;
  /** The attribute a card link carries its card's key on, a click on one bringing that card into view; null for a board of no card links. */
  linkAttribute:   string | null;
  /** Called before a followed link's card is brought into view, so a board can first open a lane that hides it. */
  revealCard?:     (card: HTMLElement) => void;
}

export interface LaneBoardController {
  /** Draws the board's new markup, easing each lane from the layout it had before. */
  showBoard(markup: string): void;
  updateOverflow(): void;
  /** Shows the Kanban tab, brings the lane into view and outlines it in its dot's state edge for `LANE_HIGHLIGHT_MILLISECONDS`. */
  showLane(laneKey: string): void;
  /** Shows the Kanban tab and brings the linked card into view with focus; a card the board does not hold is left alone. */
  followLink(cardKey: string): void;
  wire(): void;
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
 * Eases each lane from the layout it had before the board was redrawn to the one it has now: its width (a collapsed lane opening or closing),
 * its card area's height (paging a lane) and its count. Every animation ends on the new layout, so nothing jumps when it is removed. Every
 * lane is measured before any animation starts, since each one moves its siblings.
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

/** A header statistic carrying `data-kanban-lane` opens that lane on the page's board. */
export function wireStatisticLanes(summaryElementId: string, showLaneOf: (laneKey: string) => void): void {
  document.getElementById(summaryElementId)?.addEventListener('click', (event) => {
    const statistic = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-kanban-lane]') : null;
    const laneKey   = statistic?.dataset['kanbanLane'];
    if (laneKey !== undefined) {
      showLaneOf(laneKey);
    }
  });
}

/** A tab click updates every board's overflow; the template's own tab listener was added first, so the panel is already shown when this measures it. */
export function wireTabOverflow(boards: readonly LaneBoardController[]): void {
  document.getElementById(TABS_ELEMENT_ID)?.addEventListener('click', () => {
    for (const board of boards) {
      board.updateOverflow();
    }
  });
}

export function createLaneBoardController(settings: LaneBoardSettings): LaneBoardController {
  const { boardElementId, frameElementId, linkAttribute } = settings;
  let laneHighlightTimer = 0;

  const updateOverflow = (): void => {
    const board = document.getElementById(boardElementId);
    const frame = document.getElementById(frameElementId);
    if (board === null || frame === null) {
      return;
    }
    // While the detail panel is open the board ends at the panel's edge: its added room is not content, and what the panel covers is not in view.
    const panelRoom  = Number.parseFloat(board.style.getPropertyValue(PANEL_ROOM_PROPERTY)) || 0;
    const panelCover = Number.parseFloat(frame.style.getPropertyValue(PANEL_COVER_PROPERTY)) || 0;
    const directions = KanbanLaneUtil.overflowDirectionsOf(board.scrollLeft, board.scrollWidth - panelRoom + panelCover, board.clientWidth);
    if (directions === null) {
      frame.removeAttribute('data-overflow');
    } else {
      frame.setAttribute('data-overflow', directions);
    }
  };

  const showBoard = (markup: string): void => {
    const board           = document.getElementById(boardElementId);
    const motion          = laneMotionOf();
    const previousLayouts = board !== null && motion !== null ? laneLayoutsOf(board) : null;
    DomUtil.setMarkup(boardElementId, markup);
    updateOverflow();
    if (board !== null && motion !== null && previousLayouts !== null) {
      easeLaneChanges(board, previousLayouts, motion);
    }
  };

  const followLink = (cardKey: string): void => {
    DomUtil.templateBehaviour()?.selectTab(KANBAN_TAB_NAME);
    const cardId     = settings.cardElementIdOf(cardKey);
    const linkedCard = document.getElementById(cardId);
    if (linkedCard !== null) {
      settings.revealCard?.(linkedCard);
    }
    updateOverflow();
    const card = document.getElementById(cardId);
    if (card !== null) {
      card.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      card.focus();
    }
  };

  const showLane = (laneKey: string): void => {
    DomUtil.templateBehaviour()?.selectTab(KANBAN_TAB_NAME);
    updateOverflow();
    const board       = document.getElementById(boardElementId);
    const laneElement = board?.querySelector<HTMLElement>(`:scope > .ap-lane[data-lane="${CSS.escape(laneKey)}"]`) ?? null;
    if (board === null || laneElement === null) {
      return;
    }
    const motionIsReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Only the board scrolls sideways: a lane taller than the window would otherwise scroll the page past the summary and the tabs.
    const laneBox       = laneElement.getBoundingClientRect();
    const boardBox      = board.getBoundingClientRect();
    const overflowLeft  = laneBox.left - boardBox.left;
    const overflowRight = laneBox.right - boardBox.right;
    const scrollDelta   = overflowLeft < 0 ? overflowLeft : Math.max(0, overflowRight);
    board.scrollBy({ left: scrollDelta, behavior: motionIsReduced ? 'auto' : 'smooth' });
    const dot = laneElement.querySelector('.ap-lane-dot');
    if (dot !== null) {
      laneElement.style.setProperty('--lane-highlight-edge', getComputedStyle(dot).getPropertyValue('--s-edge'));
    }
    board.querySelectorAll(':scope > .ap-lane[data-highlighted]').forEach((highlightedLane) => highlightedLane.removeAttribute('data-highlighted'));
    // Reading the layout between the removal and the setting restarts the animation when the same lane is asked for twice.
    void laneElement.offsetWidth;
    laneElement.setAttribute('data-highlighted', '');
    window.clearTimeout(laneHighlightTimer);
    laneHighlightTimer = window.setTimeout(() => laneElement.removeAttribute('data-highlighted'), LANE_HIGHLIGHT_MILLISECONDS);
  };

  const wire = (): void => {
    const board = document.getElementById(boardElementId);
    board?.addEventListener('scroll', updateOverflow, { passive: true });
    if (linkAttribute === null) {
      return;
    }
    board?.addEventListener('click', (event) => {
      const link    = event.target instanceof Element ? event.target.closest(`[${linkAttribute}]`) : null;
      const cardKey = link?.getAttribute(linkAttribute) ?? null;
      if (cardKey !== null) {
        event.preventDefault();
        followLink(cardKey);
      }
    });
  };

  return {
    showBoard,
    updateOverflow,
    showLane,
    followLink,
    wire,
  };
}
