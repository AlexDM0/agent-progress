/**
 * The header's parts that tick: the status line's freshness, re-judged every minute so a page flips to Snapshot without a reload, and the
 * activity banner, whose elapsed times tick every second while Live and freeze at generation time once a snapshot. Every interval stops while
 * the tab is hidden. The ticks dispatch no input event, so the template's idle reload never mistakes them for the viewer's activity.
 */

import type { PagePayload, PageTicket }                        from '../../src/shared/@types/PagePayload.ts';
import { GENERATED_STAMP_ELEMENT_ID, STATUS_LABEL_ELEMENT_ID } from '../constants/TemplateIds.ts';
import { DomUtil }                                             from '../utils/DomUtil.ts';
import { TimeUtil }                                            from '../utils/TimeUtil.ts';
import { activityBannerMarkup }                                from './ActivityBannerMarkup.ts';
import { freshnessLabel, freshnessText }                       from './HeaderMarkup.ts';
import { ActivityBannerUtil }                                  from './utils/ActivityBannerUtil.ts';
import type { PageFreshness }                                  from './utils/HeaderFigureUtil.ts';
import { HeaderFigureUtil }                                    from './utils/HeaderFigureUtil.ts';

const STATUS_LINE_ELEMENT_ID = 'ap-status';
const ACTIVITY_ELEMENT_ID    = 'ap-activity';

const ELAPSED_TICK_INTERVAL_MILLISECONDS    = 1000;
const FRESHNESS_CHECK_INTERVAL_MILLISECONDS = 60_000;

export interface LiveHeaderController {
  start(): void;
}

export function createLiveHeaderController(payload: PagePayload, tickets: readonly PageTicket[]): LiveHeaderController {
  const generatedAt = payload.generatedAtEpochMilliseconds;
  const entries     = ActivityBannerUtil.activityEntriesOf(payload.progress.tasks, tickets);
  let elapsedTimer: ReturnType<typeof setInterval> | null   = null;
  let freshnessTimer: ReturnType<typeof setInterval> | null = null;

  // A snapshot's agents are measured up to the moment it was made, so nothing appears to be still running.
  const elapsedReferenceOf = (freshness: PageFreshness, nowEpochMilliseconds: number): number => (freshness.isLive ? nowEpochMilliseconds : generatedAt);

  const showFreshness = (nowEpochMilliseconds: number): PageFreshness => {
    const freshness      = HeaderFigureUtil.freshnessOf(generatedAt, nowEpochMilliseconds, payload.limits);
    const freshnessValue = freshness.isLive ? 'live' : 'snapshot';
    document.getElementById(STATUS_LINE_ELEMENT_ID)?.setAttribute('data-freshness', freshnessValue);
    document.getElementById(ACTIVITY_ELEMENT_ID)?.setAttribute('data-freshness', freshnessValue);
    DomUtil.setText(STATUS_LABEL_ELEMENT_ID, freshnessLabel(freshness));
    DomUtil.setShortenedText(GENERATED_STAMP_ELEMENT_ID, freshnessText(generatedAt, freshness, TimeUtil.calendarDateOf(nowEpochMilliseconds)));
    return freshness;
  };

  const showElapsed = (referenceEpochMilliseconds: number): void => {
    const elapsedElements = document.querySelectorAll(`#${ACTIVITY_ELEMENT_ID} .ap-activity-elapsed`);
    entries.forEach((entry, index) => {
      const element = elapsedElements[index];
      const text    = ActivityBannerUtil.elapsedTextOf(entry, referenceEpochMilliseconds, payload.limits);
      if (element !== undefined && element.textContent !== text) {
        element.textContent = text;
      }
    });
  };

  const stopElapsedTicks = (): void => {
    if (elapsedTimer !== null) {
      clearInterval(elapsedTimer);
      elapsedTimer = null;
    }
  };

  const checkFreshness = (): void => {
    const nowEpochMilliseconds = Date.now();
    const freshness            = showFreshness(nowEpochMilliseconds);
    showElapsed(elapsedReferenceOf(freshness, nowEpochMilliseconds));
    if (!freshness.isLive || entries.length === 0) {
      stopElapsedTicks();
    } else if (elapsedTimer === null) {
      elapsedTimer = setInterval(() => showElapsed(Date.now()), ELAPSED_TICK_INTERVAL_MILLISECONDS);
    }
  };

  const pause = (): void => {
    stopElapsedTicks();
    if (freshnessTimer !== null) {
      clearInterval(freshnessTimer);
      freshnessTimer = null;
    }
  };

  const resume = (): void => {
    checkFreshness();
    freshnessTimer ??= setInterval(checkFreshness, FRESHNESS_CHECK_INTERVAL_MILLISECONDS);
  };

  const start = (): void => {
    const nowEpochMilliseconds = Date.now();
    const freshness            = showFreshness(nowEpochMilliseconds);
    DomUtil.setMarkup(ACTIVITY_ELEMENT_ID, activityBannerMarkup(entries, elapsedReferenceOf(freshness, nowEpochMilliseconds), payload.limits));
    DomUtil.setHidden(ACTIVITY_ELEMENT_ID, false);
    if (!document.hidden) {
      resume();
    }
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        pause();
      } else {
        resume();
      }
    });
  };

  return { start };
}
