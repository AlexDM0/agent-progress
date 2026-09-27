/** The Kanban tab: the board of the visible cards, its overflow marks, the capped lanes' paging, the Abandoned toggle and the waiting-on links. */

import type { ClosedKanbanLane }                    from '../@types/ClosedKanbanLane.ts';
import type { KanbanCard }                          from '../@types/KanbanCard.ts';
import type { ViewerPreferences }                   from '../@types/ViewerChoices.ts';
import { CAPPED_LANE_FIRST_PAGE_CARDS }             from '../constants/CappedLanePaging.ts';
import { KANBAN_BOARD_ELEMENT_ID, KANBAN_TAB_NAME } from '../constants/TemplateIds.ts';
import { DomUtil }                                  from '../utils/DomUtil.ts';
import { TemplateIdUtil }                           from '../utils/TemplateIdUtil.ts';
import type { DurationUnits, TimestampSlices }      from '../utils/TimeUtil.ts';
import { kanbanBoardMarkup }                        from './KanbanMarkup.ts';
import { CLOSED_KANBAN_LANES }                      from './constants/KanbanBoardLayout.ts';
import { KanbanLaneUtil }                           from './utils/KanbanLaneUtil.ts';
import { LanePagingUtil }                           from './utils/LanePagingUtil.ts';

const KANBAN_FRAME_ELEMENT_ID = 'ap-kanban-frame';

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
  const directions = KanbanLaneUtil.overflowDirectionsOf(board.scrollLeft, board.scrollWidth, board.clientWidth);
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

  const wire = (): void => {
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
