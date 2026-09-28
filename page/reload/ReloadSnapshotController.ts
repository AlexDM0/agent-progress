/** Keeps the viewer's place across the template's idle reload: stores it just before the reload and puts it back after the first layout. */

import type {
  DetailTarget,
  ReloadSnapshot,
  ReloadSnapshotStore,
  TicketView,
} from '../@types/ViewerChoices.ts';
import {
  CHART_ELEMENT_ID,
  DETAIL_BODY_ELEMENT_ID,
  KANBAN_BOARD_ELEMENT_ID,
  LOG_FILTER_ELEMENT_ID,
  RANGE_FROM_ELEMENT_ID,
  RANGE_TO_ELEMENT_ID,
  TABS_ELEMENT_ID,
} from '../constants/TemplateIds.ts';
import { DomUtil } from '../utils/DomUtil.ts';

export interface ReloadSnapshotSources {
  trackerId:          string;
  tabNames:           readonly string[];
  store:              ReloadSnapshotStore;
  readDetailTarget:   () => DetailTarget | null;
  reopenDetail:       (target: DetailTarget) => boolean;
  applyLogFilter:     (filterText: string) => void;
  readTicketView:     () => TicketView;
  applyTicketView:    (ticketView: TicketView) => void;
  rangePopoverIsOpen: () => boolean;
  reopenRangePopover: (fromText: string, toText: string) => void;
}

export interface ReloadSnapshotController {
  keepPlaceOnReload(): void;
  /** Called once, after the first layout, since that layout scrolls the chart to now. */
  restorePlace(): void;
}

function inputValueOf(elementId: string): string {
  const input = document.getElementById(elementId);
  return input instanceof HTMLInputElement ? input.value : '';
}

function shownTabName(): string {
  const selectedTab = document.querySelector(`#${TABS_ELEMENT_ID} [data-tab][aria-selected="true"]`);
  return selectedTab instanceof HTMLElement ? selectedTab.dataset['tab'] ?? '' : '';
}

function setInputValue(elementId: string, value: string): void {
  const input = document.getElementById(elementId);
  if (input instanceof HTMLInputElement) {
    input.value = value;
  }
}

export function createReloadSnapshotController(sources: ReloadSnapshotSources): ReloadSnapshotController {
  const {
    trackerId,
    tabNames,
    store,
    readDetailTarget,
    reopenDetail,
    applyLogFilter,
    readTicketView,
    applyTicketView,
    rangePopoverIsOpen,
    reopenRangePopover,
  } = sources;

  const snapshotOfPlace = (): ReloadSnapshot => {
    const chart        = document.getElementById(CHART_ELEMENT_ID);
    const kanban       = document.getElementById(KANBAN_BOARD_ELEMENT_ID);
    const detailBody   = document.getElementById(DETAIL_BODY_ELEMENT_ID);
    const detailTarget = readDetailTarget();
    return {
      trackerId,
      tabName:            shownTabName(),
      windowScrollTop:    window.scrollY,
      chartScrollLeft:    chart?.scrollLeft ?? 0,
      chartScrollTop:     chart?.scrollTop ?? 0,
      kanbanScrollLeft:   kanban?.scrollLeft ?? 0,
      fromText:           inputValueOf(RANGE_FROM_ELEMENT_ID),
      toText:             inputValueOf(RANGE_TO_ELEMENT_ID),
      rangePopoverIsOpen: rangePopoverIsOpen(),
      logFilterText:      inputValueOf(LOG_FILTER_ELEMENT_ID),
      ticketView:         readTicketView(),
      detailTarget,
      detailScrollTop:    detailTarget === null ? 0 : detailBody?.scrollTop ?? 0,
    };
  };

  return {
    keepPlaceOnReload: () => {
      DomUtil.templateBehaviour()?.onBeforeReload(() => store.write(snapshotOfPlace()));
    },
    restorePlace: () => {
      const snapshot = store.take();
      if (snapshot === null) {
        return;
      }
      // A fragment in the address reselects its own tab on every load, so the tab shown before the reload is put back over it.
      if (tabNames.includes(snapshot.tabName)) {
        DomUtil.templateBehaviour()?.selectTab(snapshot.tabName);
      }
      // Only the text goes back, never an apply: a bound typed and not yet applied stays unapplied, in its reopened popover.
      setInputValue(RANGE_FROM_ELEMENT_ID, snapshot.fromText);
      setInputValue(RANGE_TO_ELEMENT_ID, snapshot.toText);
      // Applied before the scroll goes back, since the filters change how tall the log card and the ticket table are.
      if (snapshot.logFilterText !== '') {
        applyLogFilter(snapshot.logFilterText);
      }
      applyTicketView(snapshot.ticketView);
      const chart = document.getElementById(CHART_ELEMENT_ID);
      if (chart !== null) {
        chart.scrollLeft = snapshot.chartScrollLeft;
        chart.scrollTop  = snapshot.chartScrollTop;
      }
      const kanban = document.getElementById(KANBAN_BOARD_ELEMENT_ID);
      if (kanban !== null) {
        kanban.scrollLeft = snapshot.kanbanScrollLeft;
      }
      window.scrollTo(0, snapshot.windowScrollTop);
      if (snapshot.detailTarget !== null && reopenDetail(snapshot.detailTarget)) {
        const detailBody = document.getElementById(DETAIL_BODY_ELEMENT_ID);
        if (detailBody !== null) {
          detailBody.scrollTop = snapshot.detailScrollTop;
        }
      }
      // Last, since opening focuses its first field and the focus must not undo the scroll put back above.
      if (snapshot.rangePopoverIsOpen) {
        reopenRangePopover(snapshot.fromText, snapshot.toText);
      }
    },
  };
}
