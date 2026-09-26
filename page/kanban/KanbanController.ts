/** The Kanban tab: the board of the visible cards, its overflow marks, the capped lanes' paging, the Abandoned toggle and the waiting-on links. */

import type { Task }                                from '../../src/lib/tracker-model/@types/Task.ts';
import type { KanbanCard }                          from '../@types/KanbanCard.ts';
import type { ClosedKanbanLane }                    from '../constants/KanbanLane.ts';
import { CAPPED_LANE_FIRST_PAGE }                   from '../constants/KanbanLane.ts';
import { KANBAN_BOARD_ELEMENT_ID, KANBAN_TAB_NAME } from '../constants/TemplateIds.ts';
import type { ViewerPreferences }                   from '../preferences/ViewerPreferences.ts';
import { DomUtil }                                  from '../utils/DomUtil.ts';
import type { TimestampSlices }                     from '../utils/TimeUtil.ts';
import { cardsInLane }                              from './KanbanLanes.ts';
import { kanbanBoardMarkup }                        from './KanbanMarkup.ts';
import { KanbanOverflowUtil }                       from './utils/KanbanOverflowUtil.ts';
import { LanePagingUtil }                           from './utils/LanePagingUtil.ts';

const KANBAN_FRAME_ELEMENT_ID = 'ap-kanban-frame';

export interface KanbanControllerSources {
  tasks:                 readonly Task[];
  slices:                TimestampSlices;
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
  const directions = KanbanOverflowUtil.overflowDirectionsOf(board.scrollLeft, board.scrollWidth, board.clientWidth);
  if (directions === null) {
    frame.removeAttribute('data-overflow');
  } else {
    frame.setAttribute('data-overflow', directions);
  }
}

function closedLaneNamedBy(value: string | undefined): ClosedKanbanLane | null {
  return value === 'done' || value === 'abandoned' ? value : null;
}

export function createKanbanController(sources: KanbanControllerSources): KanbanController {
  const {
    tasks,
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
      tasks,
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
    const cardId = `ap-kanban-${ticketId}`;
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
      const laneCount    = cardsInLane(visibleCards, lane).length;
      const currentCount = LanePagingUtil.cappedLaneShownCount(preferences.readCappedLaneShownCount(lane), laneCount);
      preferences.writeCappedLaneShownCount(lane, moreLane === null ? CAPPED_LANE_FIRST_PAGE : LanePagingUtil.shownCountAfterMore(currentCount, laneCount));
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
