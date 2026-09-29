/** The header above the tabs: the status line, the project title and the summary statistics, filled once at load. */

import type { PagePayload, PageTicket } from '../../src/shared/@types/PagePayload.ts';
import {
  GENERATED_STAMP_ELEMENT_ID,
  PROJECT_NAME_ELEMENT_ID,
  STATUS_LABEL_ELEMENT_ID,
  SUMMARY_ELEMENT_ID,
} from '../constants/TemplateIds.ts';
import { DomUtil }                                               from '../utils/DomUtil.ts';
import { TimeUtil }                                              from '../utils/TimeUtil.ts';
import { freshnessLabel, freshnessText, headerStatisticsMarkup } from './HeaderMarkup.ts';
import { HeaderFigureUtil }                                      from './utils/HeaderFigureUtil.ts';

const STATUS_LINE_ELEMENT_ID = 'ap-status';
const ACTIVITY_ELEMENT_ID    = 'ap-activity';

export interface HeaderController {
  show(nowEpochMilliseconds: number): void;
}

export function createHeaderController(payload: PagePayload, tickets: readonly PageTicket[]): HeaderController {
  const show = (nowEpochMilliseconds: number): void => {
    const todayCalendarDate = TimeUtil.calendarDateOf(nowEpochMilliseconds);
    const freshness         = HeaderFigureUtil.freshnessOf(payload.generatedAtEpochMilliseconds, nowEpochMilliseconds, payload.limits);

    DomUtil.setText(PROJECT_NAME_ELEMENT_ID, payload.progress.project);
    document.getElementById(STATUS_LINE_ELEMENT_ID)?.setAttribute('data-freshness', freshness.isLive ? 'live' : 'snapshot');
    DomUtil.setText(STATUS_LABEL_ELEMENT_ID, freshnessLabel(freshness));
    DomUtil.setShortenedText(GENERATED_STAMP_ELEMENT_ID, freshnessText(payload.generatedAtEpochMilliseconds, freshness, todayCalendarDate));
    DomUtil.setMarkup(SUMMARY_ELEMENT_ID, headerStatisticsMarkup(HeaderFigureUtil.statisticsOf({
      tasks:      payload.progress.tasks,
      tickets,
      agentLimit: payload.concurrency.limit,
      todayCalendarDate,
      slices:     payload.limits,
    })));
    // Nothing fills the activity banner yet, so its slot stays hidden rather than show the placeholder's made-up agents.
    const activity = document.getElementById(ACTIVITY_ELEMENT_ID);
    if (activity !== null) {
      activity.replaceChildren();
      activity.hidden = true;
    }
  };

  return { show };
}
