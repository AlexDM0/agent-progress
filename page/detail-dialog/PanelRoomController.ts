/**
 * Keeps the page usable beside the detail panel: the panel docks under the tab bar, and while it is open the chart and the Kanban board
 * gain trailing scroll room the width of what it covers, with their column widths frozen, so what the panel opened on scrolls clear of it.
 */

import {
  CHART_ELEMENT_ID,
  KANBAN_BOARD_ELEMENT_ID,
  KANBAN_FRAME_ELEMENT_ID,
  PANEL_COVER_PROPERTY,
  PANEL_ROOM_PROPERTY,
} from '../constants/TemplateIds.ts';

const PANEL_ROOM_ATTRIBUTE               = 'data-panel-room';
const FROZEN_LANE_WIDTH_PROPERTY         = '--frozen-lane-w';
const FROZEN_TIMELINE_WIDTH_PROPERTY     = '--frozen-timeline-w';
const DETAIL_WIDTH_PROPERTY              = '--detail-w';
const DETAIL_TOP_PROPERTY                = '--detail-top';
const PANEL_GUTTER_PIXELS                = 16;
const SCROLL_SETTLE_FALLBACK_MILLISECONDS = 1000;

export interface PanelRoomController {
  dockBelowTabBar(): void;
  makeRoom(): void;
  /** Measures again from the widths the page now has, after a resize. */
  remakeRoom(): void;
  /** The scroller glides back to its own end first, then the room goes, so nothing it shows jumps. */
  releaseRoom(panelIsOpen: () => boolean): void;
  scrollClearOfPanel(opener: HTMLElement): void;
}

function pixelsOfInlineProperty(element: HTMLElement, name: string): number {
  return Number.parseFloat(element.style.getPropertyValue(name)) || 0;
}

function pixelsOfComputedProperty(element: Element, name: string): number {
  return Number.parseFloat(getComputedStyle(element).getPropertyValue(name)) || 0;
}

function panelLeftEdge(): number {
  const viewportWidth = document.documentElement.clientWidth;
  return viewportWidth - Math.min(pixelsOfComputedProperty(document.documentElement, DETAIL_WIDTH_PROPERTY), viewportWidth);
}

function visibleRightEdgeOf(scroller: HTMLElement): number {
  return scroller.getBoundingClientRect().left + scroller.clientLeft + scroller.clientWidth;
}

function scrollBehaviour(): ScrollBehavior {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}

function pinnedColumnsRightEdgeOf(chart: HTMLElement): number {
  const pill = chart.querySelector('.ap-chart-head > .ap-cell-pill');
  return pill === null ? chart.getBoundingClientRect().left : pill.getBoundingClientRect().right;
}

function freezeWidths(scroller: HTMLElement): void {
  const measured = scroller.id === KANBAN_BOARD_ELEMENT_ID
    ? scroller.querySelector('.ap-lane:not([data-collapsed])')
    : scroller.querySelector('.ap-chart-head > .ap-cell-track');
  if (measured === null) {
    return;
  }
  const property = scroller.id === KANBAN_BOARD_ELEMENT_ID ? FROZEN_LANE_WIDTH_PROPERTY : FROZEN_TIMELINE_WIDTH_PROPERTY;
  scroller.style.setProperty(property, `${measured.getBoundingClientRect().width}px`);
}

function dropRoom(scroller: HTMLElement): void {
  scroller.removeAttribute(PANEL_ROOM_ATTRIBUTE);
  for (const name of [PANEL_ROOM_PROPERTY, FROZEN_LANE_WIDTH_PROPERTY, FROZEN_TIMELINE_WIDTH_PROPERTY]) {
    scroller.style.removeProperty(name);
  }
}

/** A bar longer than the track left of the panel keeps its end in view, the latest part of the work. */
function scrollBarClearOfPanel(chart: HTMLElement, row: HTMLElement): void {
  const bars = [...row.querySelectorAll('.ap-cell-track .ap-bar')].map((bar) => bar.getBoundingClientRect());
  if (bars.length === 0) {
    return;
  }
  const barLeft    = Math.min(...bars.map((box) => box.left));
  const barRight   = Math.max(...bars.map((box) => box.right));
  const trackLeft  = pinnedColumnsRightEdgeOf(chart) + PANEL_GUTTER_PIXELS;
  const trackRight = Math.min(visibleRightEdgeOf(chart), panelLeftEdge()) - PANEL_GUTTER_PIXELS;
  let offset = barRight > trackRight ? barRight - trackRight : 0;
  if (barLeft < trackLeft) {
    offset = Math.max(barLeft - trackLeft, barRight - trackRight);
  }
  if (offset !== 0) {
    chart.scrollBy({ left: offset, behavior: scrollBehaviour() });
  }
}

export function createPanelRoomController(updateKanbanOverflow: () => void): PanelRoomController {
  const scrollers = (): HTMLElement[] => [KANBAN_BOARD_ELEMENT_ID, CHART_ELEMENT_ID]
    .map((elementId) => document.getElementById(elementId))
    .filter((element): element is HTMLElement => element !== null);
  const kanbanFrame = (): HTMLElement | null => document.getElementById(KANBAN_FRAME_ELEMENT_ID);

  const dockBelowTabBar = (): void => {
    const tabBar = document.querySelector('.ap-tab-bar');
    if (tabBar === null) {
      return;
    }
    const tabBarEnd = tabBar.getBoundingClientRect().bottom + (Number.parseFloat(getComputedStyle(tabBar).marginBottom) || 0);
    document.documentElement.style.setProperty(DETAIL_TOP_PROPERTY, `${Math.max(0, Math.round(tabBarEnd))}px`);
  };

  // Shown scrollers only: a hidden tab's scroller gets its room when the panel next opens or the window resizes.
  const makeRoom = (): void => {
    for (const scroller of scrollers()) {
      if (scroller.clientWidth === 0) {
        continue;
      }
      if (!scroller.hasAttribute(PANEL_ROOM_ATTRIBUTE)) {
        freezeWidths(scroller);
      }
      const covered = Math.max(0, visibleRightEdgeOf(scroller) - panelLeftEdge());
      scroller.style.setProperty(PANEL_ROOM_PROPERTY, `${covered > 0 ? covered + PANEL_GUTTER_PIXELS : 0}px`);
      scroller.setAttribute(PANEL_ROOM_ATTRIBUTE, '');
      if (scroller.id === KANBAN_BOARD_ELEMENT_ID) {
        kanbanFrame()?.style.setProperty(PANEL_COVER_PROPERTY, `${covered}px`);
      }
    }
    updateKanbanOverflow();
  };

  const releaseRoom = (panelIsOpen: () => boolean): void => {
    kanbanFrame()?.style.removeProperty(PANEL_COVER_PROPERTY);
    for (const scroller of scrollers()) {
      if (!scroller.hasAttribute(PANEL_ROOM_ATTRIBUTE)) {
        continue;
      }
      const naturalEnd = Math.max(0, scroller.scrollWidth - pixelsOfInlineProperty(scroller, PANEL_ROOM_PROPERTY) - scroller.clientWidth);
      const finish = (): void => {
        if (panelIsOpen() || !scroller.hasAttribute(PANEL_ROOM_ATTRIBUTE)) {
          return;
        }
        dropRoom(scroller);
        updateKanbanOverflow();
      };
      if (scroller.clientWidth === 0 || scroller.scrollLeft <= naturalEnd + 1 || scrollBehaviour() === 'auto') {
        scroller.scrollLeft = Math.min(scroller.scrollLeft, naturalEnd);
        finish();
        continue;
      }
      // A scrollend left over from the opening scroll can arrive first, so only the one at the natural end counts.
      const finishAtNaturalEnd = (): void => {
        if (scroller.scrollLeft > naturalEnd + 1) {
          return;
        }
        scroller.removeEventListener('scrollend', finishAtNaturalEnd);
        finish();
      };
      scroller.addEventListener('scrollend', finishAtNaturalEnd);
      window.setTimeout(() => {
        scroller.removeEventListener('scrollend', finishAtNaturalEnd);
        finish();
      }, SCROLL_SETTLE_FALLBACK_MILLISECONDS);
      scroller.scrollTo({ left: naturalEnd, behavior: 'smooth' });
    }
    updateKanbanOverflow();
  };

  const scrollClearOfPanel = (opener: HTMLElement): void => {
    if (opener.matches('.ap-kanban-card')) {
      opener.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: scrollBehaviour() });
      return;
    }
    opener.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const chart = document.getElementById(CHART_ELEMENT_ID);
    if (chart !== null && opener.matches('.ap-row')) {
      scrollBarClearOfPanel(chart, opener);
    }
  };

  return {
    dockBelowTabBar,
    makeRoom,
    remakeRoom: () => {
      for (const scroller of scrollers()) {
        dropRoom(scroller);
      }
      makeRoom();
    },
    releaseRoom,
    scrollClearOfPanel,
  };
}
