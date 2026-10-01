/** The Tickets tab: the table narrowed by the search and the chips and ordered by the sorted column, its chips, sort marks and count. */

import { TICKET_TYPES }                                      from '../../src/lib/tracker-model/constants/TicketFields.ts';
import type { PageLimits }                                   from '../../src/shared/@types/PagePayload.ts';
import type { BoardEpic, BoardTicket }                       from '../@types/PageBoard.ts';
import type { TicketSortKey, TicketView, ViewerPreferences } from '../@types/ViewerChoices.ts';
import { NO_EPIC_CHIP }                                      from '../constants/EpicChips.ts';
import { TICKET_COUNT_ELEMENT_ID, TICKET_ROWS_ELEMENT_ID }   from '../constants/TemplateIds.ts';
import type { EpicMarkupFormat }                             from '../epics/EpicMarkup.ts';
import { EpicMarkup }                                        from '../epics/EpicMarkup.ts';
import { DomUtil }                                           from '../utils/DomUtil.ts';
import type { TicketTableRowsOptions }                       from './TicketsMarkup.ts';
import {
  emptyTicketTableMarkup,
  statusChipsMarkup,
  ticketCountText,
  ticketTableColumnCountOf,
  ticketTableRowsMarkup,
  typeChipsMarkup,
} from './TicketsMarkup.ts';
import {
  DEFAULT_TICKET_VIEW,
  TICKET_SORT_KEYS,
  TICKET_STATUS_CHIPS,
  TicketViewUtil,
} from './utils/TicketViewUtil.ts';

const TICKETS_PANEL_ELEMENT_ID       = 'ap-panel-tickets';
const TICKET_SEARCH_ELEMENT_ID       = 'ap-ticket-search';
const TICKET_STATUS_CHIPS_ELEMENT_ID = 'ap-ticket-status';
const TICKET_TYPE_CHIPS_ELEMENT_ID   = 'ap-ticket-type';
const TICKET_CLEAR_ELEMENT_ID        = 'ap-ticket-clear';
const TICKET_TABLE_ELEMENT_ID        = 'ap-ticket-table';
const TICKET_EPIC_CHIPS_ELEMENT_ID   = 'ap-ticket-epic';
const TICKET_EPIC_FILTER_ELEMENT_ID  = 'ap-ticket-epic-filter';
const TICKET_GROUPING_ELEMENT_ID     = 'ap-ticket-group-by-epic';

const TICKET_SEARCH_DEBOUNCE_MILLISECONDS = 150;

interface TicketsControllerSources {
  allTickets:            readonly BoardTicket[];
  epics:                 readonly BoardEpic[];
  limits:                PageLimits;
  preferences:           ViewerPreferences;
  readTodayCalendarDate: () => string;
}

export interface TicketsController {
  wire(): void;
  /** The tickets the visibility filter keeps, which the table shows while no search or chip narrows it. */
  show(visibleTickets: readonly BoardTicket[]): void;
  readView(): TicketView;
  applyView(view: TicketView): void;
}

interface ChipGroup {
  containerId:   string;
  attributeName: string;
  datasetKey:    string;
}

const STATUS_CHIP_GROUP: ChipGroup = { containerId: TICKET_STATUS_CHIPS_ELEMENT_ID, attributeName: 'status', datasetKey: 'status' };
const TYPE_CHIP_GROUP: ChipGroup   = { containerId: TICKET_TYPE_CHIPS_ELEMENT_ID, attributeName: 'type', datasetKey: 'type' };
const EPIC_CHIP_GROUP: ChipGroup   = { containerId: TICKET_EPIC_CHIPS_ELEMENT_ID, attributeName: 'epic-chip', datasetKey: 'epicChip' };

function reflectChipGroup(chipGroup: ChipGroup, pressedValues: readonly string[], counts: ReadonlyMap<string, number>): void {
  const container = document.getElementById(chipGroup.containerId);
  for (const button of container?.querySelectorAll(`[data-${chipGroup.attributeName}]`) ?? []) {
    if (!(button instanceof HTMLElement)) {
      continue;
    }
    const value = button.dataset[chipGroup.datasetKey] ?? '';
    const count = counts.get(value) ?? 0;
    button.setAttribute('aria-pressed', String(pressedValues.includes(value)));
    button.toggleAttribute('data-empty', count === 0);
    const countElement = button.querySelector('.ap-chip-count');
    if (countElement !== null) {
      countElement.textContent = String(count);
    }
  }
}

function reflectSortedColumn(view: TicketView): void {
  for (const header of document.querySelectorAll(`#${TICKET_TABLE_ELEMENT_ID} th[data-sort]`)) {
    if (!(header instanceof HTMLElement)) {
      continue;
    }
    if (header.dataset['sort'] === view.sortKey) {
      header.setAttribute('aria-sort', view.sortDirection);
    } else {
      header.removeAttribute('aria-sort');
    }
  }
}

function searchInput(): HTMLInputElement | null {
  const input = document.getElementById(TICKET_SEARCH_ELEMENT_ID);
  return input instanceof HTMLInputElement ? input : null;
}

export function createTicketsController(sources: TicketsControllerSources): TicketsController {
  const { allTickets, epics, limits } = sources;
  const searchableTextById   = new Map(allTickets.map((ticket) => [ticket.id, TicketViewUtil.searchableTextOf(ticket)]));
  const showsEpics           = epics.length > 0;
  const columnCount          = ticketTableColumnCountOf(showsEpics);
  const epicTitleByChip      = new Map(epics.map((epic) => [epic.key, epic.title]));
  const epicChipLabelOf      = (chip: string): string => epicTitleByChip.get(chip) ?? chip;
  const knownEpicChips       = new Set(showsEpics ? [...epicTitleByChip.keys(), NO_EPIC_CHIP] : []);
  let view                   = DEFAULT_TICKET_VIEW;
  let visibleTickets         = allTickets;
  let ticketsAreGrouped      = showsEpics && sources.preferences.readTicketsGroupedByEpic();
  let pendingSearch: ReturnType<typeof setTimeout> | null = null;

  /** Each epic's shown tickets under its head row, a ticket under its primary epic only, then the tickets in none. */
  const groupedRowsMarkup = (shown: readonly BoardTicket[], rowOptions: TicketTableRowsOptions, epicFormat: EpicMarkupFormat): string => (
    [...EpicMarkup.epicsInShownOrder(epics), null].map((epic) => {
      const members = shown.filter((ticket) => (ticket.memberOfEpics[0]?.key ?? null) === (epic?.key ?? null));
      return members.length === 0 ? '' : EpicMarkup.epicGroupRowMarkup(epic, columnCount, epicFormat) + ticketTableRowsMarkup(members, view.searchText, rowOptions);
    }).join('')
  );

  const rowsMarkupOf = (shown: readonly BoardTicket[]): string => {
    if (shown.length === 0) {
      return emptyTicketTableMarkup(view, columnCount, epicChipLabelOf);
    }
    const nowEpochMilliseconds = Date.now();
    const todayCalendarDate    = sources.readTodayCalendarDate();
    const rowOptions           = {
      format:          { nowEpochMilliseconds, todayCalendarDate, slices: limits },
      showsEpicColumn: showsEpics,
      allTickets,
    };
    return ticketsAreGrouped
      ? groupedRowsMarkup(shown, rowOptions, { limits, todayCalendarDate, nowEpochMilliseconds })
      : ticketTableRowsMarkup(shown, view.searchText, rowOptions);
  };

  const render = (): void => {
    const shown = TicketViewUtil.ticketsShownBy(view, allTickets, visibleTickets, searchableTextById);
    DomUtil.setMarkup(TICKET_ROWS_ELEMENT_ID, allTickets.length === 0 ? '' : rowsMarkupOf(shown));
    DomUtil.setText(TICKET_COUNT_ELEMENT_ID, ticketCountText(shown.length, allTickets));
    reflectChipGroup(STATUS_CHIP_GROUP, view.statusChips, TicketViewUtil.statusChipCountsOf(view, allTickets, searchableTextById));
    reflectChipGroup(TYPE_CHIP_GROUP, view.typeChips, TicketViewUtil.typeChipCountsOf(view, allTickets, searchableTextById));
    reflectChipGroup(EPIC_CHIP_GROUP, view.epicChips, TicketViewUtil.epicChipCountsOf(view, allTickets, searchableTextById));
    document.getElementById(TICKET_GROUPING_ELEMENT_ID)?.setAttribute('aria-pressed', String(ticketsAreGrouped));
    reflectSortedColumn(view);
    DomUtil.setHidden(TICKET_CLEAR_ELEMENT_ID, !TicketViewUtil.viewNarrows(view));
    const input = searchInput();
    if (input !== null && input.value !== view.searchText) {
      input.value = view.searchText;
    }
  };

  const changeView = (changedView: TicketView): void => {
    view = changedView;
    render();
  };

  const clearSearchAndFilters = (): void => {
    changeView({
      ...view, searchText: '', statusChips: [], typeChips: [], epicChips: []
    });
    searchInput()?.focus();
  };

  const wireSearch = (): void => {
    searchInput()?.addEventListener('input', (event) => {
      const input = event.currentTarget;
      if (pendingSearch !== null) {
        clearTimeout(pendingSearch);
      }
      pendingSearch = setTimeout(() => {
        pendingSearch = null;
        if (input instanceof HTMLInputElement) {
          changeView({ ...view, searchText: input.value });
        }
      }, TICKET_SEARCH_DEBOUNCE_MILLISECONDS);
    });
  };

  const wireChips = (): void => {
    DomUtil.setMarkup(TICKET_STATUS_CHIPS_ELEMENT_ID, statusChipsMarkup(TICKET_STATUS_CHIPS));
    DomUtil.setMarkup(TICKET_TYPE_CHIPS_ELEMENT_ID, typeChipsMarkup(TICKET_TYPES));
    document.getElementById(TICKET_STATUS_CHIPS_ELEMENT_ID)?.addEventListener('click', (event) => {
      const button = event.target instanceof Element ? event.target.closest('[data-status]') : null;
      const chip   = TICKET_STATUS_CHIPS.find((candidate) => button instanceof HTMLElement && candidate === button.dataset['status']);
      if (chip !== undefined) {
        changeView({ ...view, statusChips: TicketViewUtil.toggledValues(view.statusChips, chip) });
      }
    });
    document.getElementById(TICKET_TYPE_CHIPS_ELEMENT_ID)?.addEventListener('click', (event) => {
      const button = event.target instanceof Element ? event.target.closest('[data-type]') : null;
      const type   = TICKET_TYPES.find((candidate) => button instanceof HTMLElement && candidate === button.dataset['type']);
      if (type !== undefined) {
        changeView({ ...view, typeChips: TicketViewUtil.toggledValues(view.typeChips, type) });
      }
    });
  };

  /** A board without epics keeps the table, the toolbar and the card head as they were before epics. */
  const wireEpics = (): void => {
    DomUtil.setHidden(TICKET_EPIC_FILTER_ELEMENT_ID, !showsEpics);
    DomUtil.setHidden(TICKET_GROUPING_ELEMENT_ID, !showsEpics);
    const epicHeader = document.querySelector(`#${TICKET_TABLE_ELEMENT_ID} th[data-sort="epic"]`);
    if (epicHeader instanceof HTMLElement) {
      epicHeader.hidden = !showsEpics;
    }
    if (!showsEpics) {
      return;
    }
    DomUtil.setMarkup(TICKET_EPIC_CHIPS_ELEMENT_ID, EpicMarkup.epicFilterChipsMarkup(epics));
    document.getElementById(TICKET_EPIC_CHIPS_ELEMENT_ID)?.addEventListener('click', (event) => {
      const button = event.target instanceof Element ? event.target.closest('[data-epic-chip]') : null;
      if (button instanceof HTMLElement) {
        changeView({ ...view, epicChips: TicketViewUtil.toggledValues(view.epicChips, button.dataset['epicChip'] ?? '') });
      }
    });
    document.getElementById(TICKET_GROUPING_ELEMENT_ID)?.addEventListener('click', () => {
      ticketsAreGrouped = !ticketsAreGrouped;
      sources.preferences.writeTicketsGroupedByEpic(ticketsAreGrouped);
      render();
    });
  };

  const wireSort = (): void => {
    document.querySelector(`#${TICKET_TABLE_ELEMENT_ID} thead`)?.addEventListener('click', (event) => {
      const button  = event.target instanceof Element ? event.target.closest('.ap-sort') : null;
      const header  = button?.closest('th[data-sort]');
      const sortKey = TICKET_SORT_KEYS.find((candidate): candidate is TicketSortKey => header instanceof HTMLElement && candidate === header.dataset['sort']);
      if (sortKey !== undefined) {
        changeView(TicketViewUtil.viewSortedBy(view, sortKey));
      }
    });
  };

  return {
    wire: () => {
      wireSearch();
      wireChips();
      wireEpics();
      wireSort();
      document.getElementById(TICKET_CLEAR_ELEMENT_ID)?.addEventListener('click', clearSearchAndFilters);
      document.getElementById(TICKETS_PANEL_ELEMENT_ID)?.addEventListener('click', (event) => {
        if (event.target instanceof Element && event.target.closest('[data-clear-filters]') !== null) {
          clearSearchAndFilters();
        }
      });
    },
    show: (tickets) => {
      visibleTickets = tickets;
      render();
    },
    readView:  () => view,
    // A restored epic chip whose epic has since gone presses nothing, so it cannot narrow the table unseen.
    applyView: (restoredView) => changeView({ ...restoredView, epicChips: restoredView.epicChips.filter((chip) => knownEpicChips.has(chip)) }),
  };
}
