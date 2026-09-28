/** Keeps the viewer's place across the template's idle reload: stores it just before the reload and puts it back after the first layout. */

import type { DetailTarget, ReloadSnapshot, ReloadSnapshotStore } from '../@types/ViewerChoices.ts';
import {
  CHART_ELEMENT_ID,
  DETAIL_BODY_ELEMENT_ID,
  KANBAN_BOARD_ELEMENT_ID,
  RANGE_FROM_ELEMENT_ID,
  RANGE_TO_ELEMENT_ID,
} from '../constants/TemplateIds.ts';
import { DomUtil } from '../utils/DomUtil.ts';

export interface ReloadSnapshotSources {
  trackerId:        string;
  store:            ReloadSnapshotStore;
  readDetailTarget: () => DetailTarget | null;
  reopenDetail:     (target: DetailTarget) => boolean;
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

function setInputValue(elementId: string, value: string): void {
  const input = document.getElementById(elementId);
  if (input instanceof HTMLInputElement) {
    input.value = value;
  }
}

export function createReloadSnapshotController(sources: ReloadSnapshotSources): ReloadSnapshotController {
  const {
    trackerId,
    store,
    readDetailTarget,
    reopenDetail,
  } = sources;

  const snapshotOfPlace = (): ReloadSnapshot => {
    const chart        = document.getElementById(CHART_ELEMENT_ID);
    const kanban       = document.getElementById(KANBAN_BOARD_ELEMENT_ID);
    const detailBody   = document.getElementById(DETAIL_BODY_ELEMENT_ID);
    const detailTarget = readDetailTarget();
    return {
      trackerId,
      windowScrollTop:  window.scrollY,
      chartScrollLeft:  chart?.scrollLeft ?? 0,
      chartScrollTop:   chart?.scrollTop ?? 0,
      kanbanScrollLeft: kanban?.scrollLeft ?? 0,
      fromText:         inputValueOf(RANGE_FROM_ELEMENT_ID),
      toText:           inputValueOf(RANGE_TO_ELEMENT_ID),
      detailTarget,
      detailScrollTop:  detailTarget === null ? 0 : detailBody?.scrollTop ?? 0,
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
      // Only the text goes back, never a change event: a bound typed and not yet applied stays unapplied.
      setInputValue(RANGE_FROM_ELEMENT_ID, snapshot.fromText);
      setInputValue(RANGE_TO_ELEMENT_ID, snapshot.toText);
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
    },
  };
}
