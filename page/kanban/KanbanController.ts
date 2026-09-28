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
import { KanbanLaneUtil }                      from './utils/KanbanLaneUtil.ts';
import { LanePagingUtil }                      from './utils/LanePagingUtil.ts';

const LANE_HIGHLIGHT_MILLISECONDS = 1200;

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
