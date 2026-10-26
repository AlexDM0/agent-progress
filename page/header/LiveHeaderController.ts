/**
 * The page's parts that tick: the status line's freshness, re-judged every minute so a page flips to Snapshot without a reload and marked on
 * `<html>` for what pulses only while live, and the elapsed times of the activity banner and of every `[data-elapsed-since]` stamp, which tick
 * every second while Live and freeze at generation time once a snapshot. Every interval stops while the tab is hidden. The ticks dispatch no
 * input event, so the template's idle reload never mistakes them for the viewer's activity.
 */

import type { PagePayload, PageTicket }            from '../../src/shared/@types/PagePayload.ts';
import { DomUtil }                                 from '../utils/DomUtil.ts';
import { ElapsedTimeUtil }                         from '../utils/ElapsedTimeUtil.ts';
import { TimeUtil }                                from '../utils/TimeUtil.ts';
import { activityBannerMarkup, staleNoticeMarkup } from './ActivityBannerMarkup.ts';
import { showStatusLine }                          from './StatusLine.ts';
import { ActivityBannerUtil }                      from './utils/ActivityBannerUtil.ts';
import type { PageFreshness }                      from './utils/HeaderFigureUtil.ts';
import { HeaderFigureUtil }                        from './utils/HeaderFigureUtil.ts';

const ACTIVITY_ELEMENT_ID = 'ap-activity';

/** Shown by the template's rules alone, only on an embedded page whose root reads snapshot. */
const STALE_NOTICE_ELEMENT_ID = 'ap-stale-notice';

const ELAPSED_TICK_INTERVAL_MILLISECONDS    = 1000;
const FRESHNESS_CHECK_INTERVAL_MILLISECONDS = 60_000;

/** A ticking stamp anywhere on the page names its label and start in these, as the Kanban's working cards do. */
const ELAPSED_SINCE_ATTRIBUTE = 'data-elapsed-since';
const ELAPSED_LABEL_ATTRIBUTE = 'data-elapsed-label';

export interface LiveHeaderController {
  start(): void;
  /** The moment an elapsed time is measured to: now while the page is live, its generation once it is a snapshot. */
  readElapsedReferenceEpochMilliseconds(): number;
}

export function createLiveHeaderController(payload: PagePayload, tickets: readonly PageTicket[]): LiveHeaderController {
  const generatedAt = payload.generatedAtEpochMilliseconds;
  const entries     = ActivityBannerUtil.activityEntriesOf(payload.progress.tasks, tickets);
  let elapsedTimer: ReturnType<typeof setInterval> | null   = null;
  let freshnessTimer: ReturnType<typeof setInterval> | null = null;
  let latestFreshness: PageFreshness | null                 = null;

  // A snapshot's agents are measured up to the moment it was made, so nothing appears to be still running.
  const elapsedReferenceOf = (freshness: PageFreshness, nowEpochMilliseconds: number): number => (freshness.isLive ? nowEpochMilliseconds : generatedAt);

  const showFreshness = (nowEpochMilliseconds: number): PageFreshness => {
    const freshness = HeaderFigureUtil.freshnessOf(generatedAt, nowEpochMilliseconds, payload.limits);
    showStatusLine(generatedAt, freshness, TimeUtil.calendarDateOf(nowEpochMilliseconds));
    document.getElementById(ACTIVITY_ELEMENT_ID)?.setAttribute('data-freshness', freshness.isLive ? 'live' : 'snapshot');
    document.documentElement.setAttribute('data-freshness', freshness.isLive ? 'live' : 'snapshot');
    latestFreshness = freshness;
    return freshness;
  };

  const showText = (element: Element | undefined, text: string): void => {
    if (element !== undefined && element.textContent !== text) {
      element.textContent = text;
    }
  };

  const showElapsed = (referenceEpochMilliseconds: number): void => {
    const elapsedElements = document.querySelectorAll(`#${ACTIVITY_ELEMENT_ID} .ap-activity-elapsed`);
    entries.forEach((entry, index) => showText(elapsedElements[index], ActivityBannerUtil.elapsedTextOf(entry, referenceEpochMilliseconds, payload.limits)));
    document.querySelectorAll<HTMLElement>(`[${ELAPSED_SINCE_ATTRIBUTE}]`).forEach((element) => {
      const startEpochMilliseconds = Number(element.getAttribute(ELAPSED_SINCE_ATTRIBUTE));
      const label                  = element.getAttribute(ELAPSED_LABEL_ATTRIBUTE) ?? '';
      if (Number.isFinite(startEpochMilliseconds)) {
        showText(element, ElapsedTimeUtil.labelledElapsedTextOf(label, startEpochMilliseconds, referenceEpochMilliseconds, payload.limits));
      }
    });
  };

  const anythingTicks = (): boolean => entries.length > 0 || document.querySelector(`[${ELAPSED_SINCE_ATTRIBUTE}]`) !== null;

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
    if (!freshness.isLive || !anythingTicks()) {
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
    DomUtil.setMarkup(STALE_NOTICE_ELEMENT_ID, staleNoticeMarkup());
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

  const readElapsedReferenceEpochMilliseconds = (): number => {
    const nowEpochMilliseconds = Date.now();
    return elapsedReferenceOf(latestFreshness ?? HeaderFigureUtil.freshnessOf(generatedAt, nowEpochMilliseconds, payload.limits), nowEpochMilliseconds);
  };

  return { start, readElapsedReferenceEpochMilliseconds };
}
