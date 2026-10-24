/**
 * The tracker page's Kanban tab: the board of the visible cards on the shared lane board, with what only this board has: the capped lanes'
 * paging, the Abandoned toggle, the To do order and the dependency arrows.
 */

import type { DependencyGraph }                                                 from '../@types/DependencyGraph.ts';
import type { KanbanCard }                                                      from '../@types/KanbanCard.ts';
import type { FinishedWorkChoice, ViewerPreferences }                           from '../@types/ViewerChoices.ts';
import { KANBAN_BOARD_ELEMENT_ID, KANBAN_FRAME_ELEMENT_ID, SUMMARY_ELEMENT_ID } from '../constants/TemplateIds.ts';
import { TemplateIdUtil }                                                       from '../utils/TemplateIdUtil.ts';
import type { DurationUnits, TimestampSlices }                                  from '../utils/TimeUtil.ts';
import { createKanbanDependencyArrowController }                                from './KanbanDependencyArrowController.ts';
import { kanbanBoardMarkup }                                                    from './KanbanMarkup.ts';
import { createKanbanTodoOrderController }                                      from './KanbanTodoOrderController.ts';
import type { LaneBoardController }                                             from './LaneBoardController.ts';
import { createLaneBoardController, wireStatisticLanes }                        from './LaneBoardController.ts';
import type { ClosedKanbanLane }                                                from './constants/KanbanBoardLayout.ts';
import { CAPPED_LANE_FIRST_PAGE_CARDS }                                         from './constants/KanbanBoardLayout.ts';
import { CLOSED_KANBAN_LANES, KANBAN_LANES }                                    from './constants/KanbanBoardLayout.ts';
import { KanbanLaneUtil }                                                       from './utils/KanbanLaneUtil.ts';
import { LanePagingUtil }                                                       from './utils/LanePagingUtil.ts';

export interface KanbanControllerSources {
  slices:                      TimestampSlices & DurationUnits;
  preferences:                 ViewerPreferences;
  readTodayCalendarDate:       () => string;
  /** What the cards' times run to: the clock while the page is live, its generation once it is a snapshot. */
  readNowEpochMilliseconds:    () => number;
  readFinishedWork:            () => FinishedWorkChoice;
  readHiddenCountByClosedLane: () => Readonly<Record<ClosedKanbanLane, number>>;
  showAllFinishedWork:         () => void;
  dependencyGraph:             DependencyGraph;
  readyTicketIds:              ReadonlySet<string>;
  boardHasDependencies:        boolean;
}

export interface KanbanController {
  showCards(cards: readonly KanbanCard[]): void;
  readVisibleCards(): readonly KanbanCard[];
  readonly laneBoard: LaneBoardController;
  wire(): void;
}

function closedLaneNamedBy(value: string | undefined): ClosedKanbanLane | null {
  return CLOSED_KANBAN_LANES.find((lane) => lane === value) ?? null;
}

export function createKanbanController(sources: KanbanControllerSources): KanbanController {
  const {
    slices,
    preferences,
    readTodayCalendarDate,
    readNowEpochMilliseconds,
    readFinishedWork,
    readHiddenCountByClosedLane,
    showAllFinishedWork,
    dependencyGraph,
    readyTicketIds,
  } = sources;
  let visibleCards: readonly KanbanCard[] = [];
  let abandonedLaneIsOpen                 = preferences.readAbandonedLaneIsOpen();
  const laneBoard = createLaneBoardController({
    boardElementId:  KANBAN_BOARD_ELEMENT_ID,
    frameElementId:  KANBAN_FRAME_ELEMENT_ID,
    cardElementIdOf: TemplateIdUtil.kanbanCardElementIdOf,
    linkAttribute:   'data-ticket-link',
    revealCard:      (card) => {
      if (card.closest('[data-collapsed]') !== null) {
        toggleAbandonedLane(true);
      }
    },
  });

  const dependenciesOf   = (ticketId: string): readonly string[] => visibleCards.find((card) => card.ticket.id === ticketId)?.ticket.dependsOn ?? [];
  const dependencyArrows = createKanbanDependencyArrowController({ dependenciesOf });
  const todoOrder = createKanbanTodoOrderController({
    preferences,
    boardHasDependencies: sources.boardHasDependencies,
    applyOrder:           () => showKanban(),
  });

  function showKanban(): void {
    laneBoard.showBoard(kanbanBoardMarkup({
      cards:                   visibleCards,
      nowEpochMilliseconds:    readNowEpochMilliseconds(),
      todayCalendarDate:       readTodayCalendarDate(),
      slices,
      finishedWork:            readFinishedWork(),
      hiddenCountByClosedLane: readHiddenCountByClosedLane(),
      shownCountByClosedLane:  { done: preferences.readCappedLaneShownCount('done'), abandoned: preferences.readCappedLaneShownCount('abandoned') },
      abandonedLaneIsOpen,
      todoOrder:               todoOrder.readOrder(),
      dependencyGraph,
      readyTicketIds,
    }));
    dependencyArrows.refresh();
  }
  const toggleAbandonedLane = (laneIsOpen = !abandonedLaneIsOpen): void => {
    abandonedLaneIsOpen = laneIsOpen;
    preferences.writeAbandonedLaneIsOpen(laneIsOpen);
    showKanban();
  };

  const wire = (): void => {
    todoOrder.wire();
    dependencyArrows.wire();
    laneBoard.wire();
    wireStatisticLanes(SUMMARY_ELEMENT_ID, (laneKey) => {
      const lane = KANBAN_LANES.find((candidate) => candidate === laneKey);
      if (lane !== undefined) {
        laneBoard.showLane(lane);
      }
    });
    document.getElementById(KANBAN_BOARD_ELEMENT_ID)?.addEventListener('click', (event) => {
      const controlSelector = '[data-lane-more], [data-lane-reset], [data-show-all-finished], .ap-lane-toggle';
      const control         = event.target instanceof Element ? event.target.closest(controlSelector) : null;
      if (!(control instanceof HTMLElement)) {
        return;
      }
      if (control.hasAttribute('data-show-all-finished')) {
        showAllFinishedWork();
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
    laneBoard,
    wire,
  };
}
