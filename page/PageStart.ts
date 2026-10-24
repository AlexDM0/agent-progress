/**
 * The browser entry: it fills the containers of `resources/template.html` from the two JSON islands and does nothing else. Theme, tab
 * selection and the idle reload stay with the template's own bootstrap, reached through `window.agentProgressTemplate`.
 */

import type { PagePayload, PageTicket } from '../src/shared/@types/PagePayload.ts';
import type { BoardTicket }             from './@types/PageBoard.ts';
import {
  AXIS_TICKS_ELEMENT_ID,
  CHART_OVERLAY_ELEMENT_ID,
  DETAIL_BODY_ELEMENT_ID,
  GENERATED_STAMP_ELEMENT_ID,
  HIDDEN_WORK_NOTE_ELEMENT_ID,
  KANBAN_BOARD_ELEMENT_ID,
  KANBAN_TAB_NAME,
  PROJECT_NAME_ELEMENT_ID,
  RANGE_NOTE_ELEMENT_ID,
  STATUS_LABEL_ELEMENT_ID,
  SUMMARY_ELEMENT_ID,
  TASK_ROWS_ELEMENT_ID,
  TICKET_COUNT_ELEMENT_ID,
  TICKET_ROWS_ELEMENT_ID,
  TODAY_FIGURES_ELEMENT_ID,
} from './constants/TemplateIds.ts';
import { createDependencyLineageController }                  from './dependencies/DependencyLineageController.ts';
import { DependencyMarkup }                                   from './dependencies/DependencyMarkup.ts';
import { createDetailDialogController }                       from './detail-dialog/DetailDialogController.ts';
import { EpicGroupMarks }                                     from './epics/EpicGroupMarks.ts';
import { EpicMarkup }                                         from './epics/EpicMarkup.ts';
import { createFinishedWorkSwitchController }                 from './finished-work/FinishedWorkSwitchController.ts';
import { createHeaderController }                             from './header/HeaderController.ts';
import { createLiveHeaderController }                         from './header/LiveHeaderController.ts';
import { createKanbanController }                             from './kanban/KanbanController.ts';
import { createKanbanEpicFilterController }                   from './kanban/KanbanEpicFilterController.ts';
import { wireTabOverflow }                                    from './kanban/LaneBoardController.ts';
import { KanbanLaneUtil }                                     from './kanban/utils/KanbanLaneUtil.ts';
import { BROWSER_STORAGE_AREAS }                              from './preferences/PreferenceStore.ts';
import { createReloadSnapshotStore, createViewerPreferences } from './preferences/ViewerPreferences.ts';
import { rowGroupingOfEpics }                                 from './progress/EpicRowGrouping.ts';
import { createGanttChartController }                         from './progress/GanttChartController.ts';
import { hiddenWorkNoteText }                                 from './progress/GanttChartMarkup.ts';
import { highlightChangesSince }                              from './reload/ChangeHighlight.ts';
import { createReloadSnapshotController }                     from './reload/ReloadSnapshotController.ts';
import { ScreenSignatureUtil }                                from './reload/utils/ScreenSignatureUtil.ts';
import { createFragmentRouter }                               from './shell/FragmentRouter.ts';
import { PageShell }                                          from './shell/PageShell.ts';
import { createTicketsController }                            from './tickets/TicketsController.ts';
import { DependencyGraphUtil }                                from './utils/DependencyGraphUtil.ts';
import { DomUtil }                                            from './utils/DomUtil.ts';
import { FinishedWorkUtil }                                   from './utils/FinishedWorkUtil.ts';
import { IslandUtil }                                         from './utils/IslandUtil.ts';
import { TemplateIdUtil }                                     from './utils/TemplateIdUtil.ts';
import { TimeUtil }                                           from './utils/TimeUtil.ts';

const PROGRESS_ISLAND_ELEMENT_ID = 'ap-progress-data';
const TICKETS_ISLAND_ELEMENT_ID  = 'ap-tickets-data';

const TICKETS_TAB_NAME      = 'tickets';
const EPICS_TAB_NAME        = 'epics';
const DEPENDENCIES_TAB_NAME = 'dependencies';
const TAB_NAMES             = ['progress', KANBAN_TAB_NAME, TICKETS_TAB_NAME, EPICS_TAB_NAME, DEPENDENCIES_TAB_NAME];

const EPICS_TAB_ELEMENT_ID          = 'ap-tab-epics';
const EPICS_BOARD_ELEMENT_ID        = 'ap-epics';
const DEPENDENCIES_TAB_ELEMENT_ID   = 'ap-tab-dependencies';
const DEPENDENCIES_CARD_ELEMENT_ID  = 'ap-dependencies';

const OWNED_MARKUP_CONTAINER_IDS = [
  EPICS_BOARD_ELEMENT_ID,
  DEPENDENCIES_CARD_ELEMENT_ID,
  'ap-ticket-epic',
  'ap-kanban-epic',
  'ap-kanban-epic-rollups',
  SUMMARY_ELEMENT_ID,
  AXIS_TICKS_ELEMENT_ID,
  CHART_OVERLAY_ELEMENT_ID,
  TASK_ROWS_ELEMENT_ID,
  TICKET_ROWS_ELEMENT_ID,
  DETAIL_BODY_ELEMENT_ID,
  KANBAN_BOARD_ELEMENT_ID,
];
const OWNED_TEXT_CONTAINER_IDS = [
  PROJECT_NAME_ELEMENT_ID,
  STATUS_LABEL_ELEMENT_ID,
  GENERATED_STAMP_ELEMENT_ID,
  RANGE_NOTE_ELEMENT_ID,
  TICKET_COUNT_ELEMENT_ID,
  HIDDEN_WORK_NOTE_ELEMENT_ID,
  TODAY_FIGURES_ELEMENT_ID,
];

const { showLayoutFailure, islandContentsOf, showTabButton } = PageShell;

/** A ticket's fragment names no element: it selects the Tickets tab and opens that ticket's detail. */
function openTicketFragment(target: string, openTicketDetail: (ticketId: string) => boolean): boolean {
  const ticketId = TemplateIdUtil.ticketIdOfFragment(target);
  if (ticketId === null) {
    return false;
  }
  DomUtil.templateBehaviour()?.selectTab(TICKETS_TAB_NAME);
  openTicketDetail(ticketId);
  return true;
}

function waitingOnByTicketIdOf(tickets: readonly BoardTicket[]): Map<string, readonly string[]> {
  return new Map(tickets.flatMap((ticket) => (ticket.waitingOn.length === 0 ? [] : [[ticket.id, ticket.waitingOn] as const])));
}

function renderPage(payload: PagePayload, tickets: PageTicket[]): void {
  const { progress, limits } = payload;
  const board                = IslandUtil.pageBoardFrom(progress.tasks, payload.boardFacts, tickets, payload.epicDescriptions);
  const waitingOnById        = waitingOnByTicketIdOf(board.tickets);
  const preferences          = createViewerPreferences(progress.trackerId, BROWSER_STORAGE_AREAS.local);
  const progressController   = createGanttChartController({
    progress,
    limits,
    rows:        board.rows,
    rowGrouping: board.epics.length === 0
      ? null
      : rowGroupingOfEpics(EpicGroupMarks.epicsInShownOrder(board.epics), new Map(board.tickets.map((ticket) => [ticket.id, ticket.memberOfEpics]))),
    waitingOnOf:          (row) => (row.ticket === null ? [] : waitingOnById.get(row.ticket) ?? []),
    nowEpochMilliseconds: Date.now,
    preferences,
    reviewRows:           preferences,
  });

  if (payload.pageScriptFailure !== null) {
    showLayoutFailure(payload.pageScriptFailure);
  }

  createHeaderController(payload, board.tickets).show(Date.now());
  const liveHeaderController = createLiveHeaderController(payload, tickets);
  liveHeaderController.start();

  // Set from the visibility filter's now before anything prints a stamp; the page reloads every few minutes when idle, so the day is rarely stale.
  let todayCalendarDate = '';

  // Applied before the first layout, which measures the pinned columns this width sets.
  progressController.applyNameColumnWidth();

  let finishedWork                = preferences.readFinishedWorkChoice();
  let hiddenCountByClosedLane     = { done: 0, abandoned: 0 };
  const {
    tasks:   taskFinishedMoments,
    tickets: ticketFinishedMoments,
    epics:   epicFinishedMoments,
    ticketFinishedMomentById,
  } = FinishedWorkUtil.boardFinishedMomentsOf(board);
  // Declared before its controller, since the Kanban's show-all link and the switch each change the other's view.
  let showAllFinishedWork = (): void => undefined;
  const ticketById = new Map(board.tickets.map((ticket) => [ticket.id, ticket]));
  // The graph spans every ticket, finished ones included, so the finished-work switch never reshapes the waves.
  const dependencyGraph      = DependencyGraphUtil.dependencyGraphOf(board.tickets, payload.concurrency.limit);
  const boardHasDependencies = DependencyMarkup.boardHasDependencies(board.tickets);
  const kanbanController = createKanbanController({
    dependencyGraph,
    readyTicketIds:              board.readyTicketIds,
    boardHasDependencies,
    slices:                      limits,
    preferences,
    readTodayCalendarDate:       () => todayCalendarDate,
    readNowEpochMilliseconds:    liveHeaderController.readElapsedReferenceEpochMilliseconds,
    readFinishedWork:            () => finishedWork,
    readHiddenCountByClosedLane: () => hiddenCountByClosedLane,
    showAllFinishedWork:         () => showAllFinishedWork(),
  });
  const ticketsController      = createTicketsController({
    allTickets:            board.tickets,
    epics:                 board.epics,
    limits,
    preferences,
    readTodayCalendarDate: () => todayCalendarDate,
  });
  const kanbanEpicFilter = createKanbanEpicFilterController({
    epics:       board.epics,
    allTickets:  board.tickets,
    preferences,
    applyFilter: () => {
      showVisibleWork();
      kanbanController.laneBoard.updateOverflow();
    },
  });
  const detailDialogController = createDetailDialogController({
    rows:                  board.rows,
    tickets:               board.tickets,
    epics:                 board.epics,
    log:                   progress.log,
    limits,
    readTodayCalendarDate: () => todayCalendarDate,
    readKanbanCards:       () => kanbanController.readVisibleCards(),
    updateKanbanOverflow:  () => kanbanController.laneBoard.updateOverflow(),
  });

  // The switch hides a finished epic's whole card, but a card it shows counts all its tickets, finished ones included.
  const showEpicsTab = (cutoff: number): void => {
    if (board.epics.length > 0) {
      const shownEpics = FinishedWorkUtil.shownEpicsOf(board.epics, ticketFinishedMomentById, cutoff);
      DomUtil.setMarkup(EPICS_BOARD_ELEMENT_ID, EpicMarkup.epicsTabMarkup(shownEpics, ticketById, dependencyGraph, {
        limits,
        todayCalendarDate,
        nowEpochMilliseconds: Date.now(),
      }, finishedWork));
    }
  };

  const showVisibleWork = (): void => {
    const nowEpochMilliseconds = Date.now();
    const cutoff               = FinishedWorkUtil.cutoffEpochMillisecondsOf(finishedWork, nowEpochMilliseconds, limits);
    const visibleRows          = board.rows.filter((_row, index) => FinishedWorkUtil.finishedMomentIsShown(taskFinishedMoments[index] ?? null, cutoff));
    const ticketIsShown        = board.tickets.map((_ticket, index) => FinishedWorkUtil.finishedMomentIsShown(ticketFinishedMoments[index] ?? null, cutoff));
    const visibleTickets       = board.tickets.filter((_ticket, index) => ticketIsShown[index] === true);
    const hiddenTickets        = board.tickets.filter((_ticket, index) => ticketIsShown[index] !== true);
    hiddenCountByClosedLane    = {
      done:      hiddenTickets.filter((ticket) => ticket.status === 'delivered').length,
      abandoned: hiddenTickets.filter((ticket) => ticket.status === 'abandoned').length,
    };
    progressController.setVisibleRows(visibleRows);
    todayCalendarDate = TimeUtil.calendarDateOf(nowEpochMilliseconds);

    ticketsController.show(visibleTickets);
    kanbanController.showCards(KanbanLaneUtil.kanbanCardsFor(visibleTickets.filter(kanbanEpicFilter.keeps), waitingOnById));
    showEpicsTab(cutoff);
  };

  const finishedWorkSwitch = createFinishedWorkSwitchController({
    initialChoice:       finishedWork,
    units:               limits,
    readFinishedMoments: () => ({ tasks: taskFinishedMoments, tickets: ticketFinishedMoments, epics: epicFinishedMoments }),
    hiddenNoteTextOf:    hiddenWorkNoteText,
    applyChoice:         (choice) => {
      finishedWork = choice;
      preferences.writeFinishedWorkChoice(choice);
      showVisibleWork();
      progressController.layOut(true);
    },
  });
  showAllFinishedWork = () => finishedWorkSwitch.choose('all');

  detailDialogController.wire();
  progressController.wireRangeBar();
  finishedWorkSwitch.wire();

  progressController.wireNameColumn();
  progressController.wireChartWidth();
  progressController.wireReviewRows();
  progressController.wireEpicGroups();
  kanbanController.wire();
  wireTabOverflow([kanbanController.laneBoard]);
  kanbanEpicFilter.wire();
  ticketsController.wire();
  showTabButton(EPICS_TAB_ELEMENT_ID, board.epics.length > 0, KANBAN_TAB_NAME);

  if (boardHasDependencies) {
    DomUtil.setMarkup(DEPENDENCIES_CARD_ELEMENT_ID, DependencyMarkup.dependencyGraphMarkup(dependencyGraph, ticketById, board.readyTicketIds));
  }
  createDependencyLineageController({ containerElementId: DEPENDENCIES_CARD_ELEMENT_ID, readGraph: () => dependencyGraph }).wire();
  showTabButton(DEPENDENCIES_TAB_ELEMENT_ID, boardHasDependencies, KANBAN_TAB_NAME);

  const openTicketDetail = (ticketId: string): boolean => detailDialogController.openTicketDetail(ticketId);
  const fragmentRouter   = createFragmentRouter({
    tabNames:         TAB_NAMES,
    openItemFragment: (target) => openTicketFragment(target, openTicketDetail),
  });
  window.addEventListener('resize', () => {
    kanbanController.laneBoard.updateOverflow();
  });
  window.addEventListener('hashchange', () => {
    fragmentRouter.applyFragment(window.location.hash);
    kanbanController.laneBoard.updateOverflow();
    finishedWorkSwitch.render();
  });
  fragmentRouter.wireSameFragmentReclick();

  const screenSignature          = ScreenSignatureUtil.screenSignatureOf(board);
  const reloadSnapshotController = createReloadSnapshotController({
    trackerId:          progress.trackerId,
    tabNames:           TAB_NAMES,
    store:              createReloadSnapshotStore(progress.trackerId, BROWSER_STORAGE_AREAS.session),
    readDetailTarget:   () => detailDialogController.readOpenTarget(),
    reopenDetail:       (target) => detailDialogController.reopen(target),
    readTicketView:     () => ticketsController.readView(),
    applyTicketView:    (ticketView) => ticketsController.applyView(ticketView),
    rangePopoverIsOpen: () => progressController.rangePopoverIsOpen(),
    reopenRangePopover: (fromText, toText) => progressController.reopenRangePopover(fromText, toText),
    screenSignature,
    showChangesSince:   (previousSignature) => highlightChangesSince(previousSignature, screenSignature),
  });
  reloadSnapshotController.keepPlaceOnReload();

  showVisibleWork();
  progressController.layOut(true);
  fragmentRouter.applyFragment(window.location.hash);
  reloadSnapshotController.restorePlace();
  // After the fragment and the snapshot chose the tab, whose items the pills count.
  finishedWorkSwitch.render();
  kanbanController.laneBoard.updateOverflow();
}

function startPage(): void {
  PageShell.clearOwnedContainers(OWNED_MARKUP_CONTAINER_IDS, OWNED_TEXT_CONTAINER_IDS);
  const payload = IslandUtil.pagePayloadFrom(islandContentsOf(PROGRESS_ISLAND_ELEMENT_ID));
  if (payload === null) {
    showLayoutFailure('The progress data island is missing or could not be read, so the chart could not be built.');
    return;
  }
  renderPage(payload, IslandUtil.pageTicketsFrom(islandContentsOf(TICKETS_ISLAND_ELEMENT_ID)));
}

// The one deliberate exception to "no work at module load": a browser entry has no caller.
PageShell.startWhenReady(startPage);
