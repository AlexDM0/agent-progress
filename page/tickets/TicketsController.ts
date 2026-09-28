/** The Tickets tab: the table narrowed by the search and the chips and ordered by the sorted column, its chips, sort marks and count. */

import { TICKET_TYPES }                                    from '../../src/lib/tracker-model/constants/TicketFields.ts';
import type { BoardTicket }                                from '../@types/PageBoard.ts';
import type { TicketSortKey, TicketView }                  from '../@types/ViewerChoices.ts';
import { TICKET_COUNT_ELEMENT_ID, TICKET_ROWS_ELEMENT_ID } from '../constants/TemplateIds.ts';
import { DomUtil }                                         from '../utils/DomUtil.ts';
import {
  emptyTicketTableMarkup,
  statusChipsMarkup,
  ticketCountText,
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

const TICKET_SEARCH_DEBOUNCE_MILLISECONDS = 150;

interface TicketsControllerSources {
  allTickets: readonly BoardTicket[];
}

export interface TicketsController {
  wire(): void;
  /** The tickets the visibility filter keeps, which the table shows while no search or chip narrows it. */
  show(visibleTickets: readonly BoardTicket[]): void;
  readView(): TicketView;
  applyView(view: TicketView): void;
}

function reflectChipGroup(containerId: string, attributeName: string, pressedValues: readonly string[], counts: ReadonlyMap<string, number>): void {
  const container = document.getElementById(containerId);
  for (const button of container?.querySelectorAll(`[data-${attributeName}]`) ?? []) {
    if (!(button instanceof HTMLElement)) {
      continue;
    }
    const value = button.dataset[attributeName] ?? '';
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
  const { allTickets }       = sources;
  const searchableTextById   = new Map(allTickets.map((ticket) => [ticket.id, TicketViewUtil.searchableTextOf(ticket)]));
  let view                   = DEFAULT_TICKET_VIEW;
  let visibleTickets         = allTickets;
  let pendingSearch: ReturnType<typeof setTimeout> | null = null;

  const render = (): void => {
    const shown = TicketViewUtil.ticketsShownBy(view, allTickets, visibleTickets, searchableTextById);
    const rows  = shown.length > 0 ? ticketTableRowsMarkup(shown, view.searchText) : emptyTicketTableMarkup(view);
    DomUtil.setMarkup(TICKET_ROWS_ELEMENT_ID, allTickets.length === 0 ? '' : rows);
    DomUtil.setText(TICKET_COUNT_ELEMENT_ID, ticketCountText(shown.length, allTickets));
    reflectChipGroup(TICKET_STATUS_CHIPS_ELEMENT_ID, 'status', view.statusChips, TicketViewUtil.statusChipCountsOf(view, allTickets, searchableTextById));
    reflectChipGroup(TICKET_TYPE_CHIPS_ELEMENT_ID, 'type', view.typeChips, TicketViewUtil.typeChipCountsOf(view, allTickets, searchableTextById));
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
      ...view, searchText: '', statusChips: [], typeChips: []
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
    applyView: changeView,
  };
}
