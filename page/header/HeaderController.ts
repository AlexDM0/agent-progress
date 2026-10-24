/** The header's parts that stay put: the project title, the summary statistics and the embedded page's summary line, filled once at load. */

import type { PagePayload }                                                     from '../../src/shared/@types/PagePayload.ts';
import type { BoardTicket }                                                     from '../@types/PageBoard.ts';
import { PROJECT_NAME_ELEMENT_ID, SUMMARY_ELEMENT_ID, SUMMARY_LINE_ELEMENT_ID } from '../constants/TemplateIds.ts';
import { DomUtil }                                                              from '../utils/DomUtil.ts';
import { TimeUtil }                                                             from '../utils/TimeUtil.ts';
import { headerStatisticsMarkup, summaryLineMarkup }                            from './HeaderMarkup.ts';
import { trackerHeaderModelOf, trackerSummaryLineOf }                           from './TrackerHeaderModel.ts';
import { HeaderFigureUtil }                                                     from './utils/HeaderFigureUtil.ts';

export interface HeaderController {
  show(nowEpochMilliseconds: number): void;
}

export function createHeaderController(payload: PagePayload, tickets: readonly BoardTicket[]): HeaderController {
  const show = (nowEpochMilliseconds: number): void => {
    const statistics = HeaderFigureUtil.statisticsOf({
      tasks:             payload.progress.tasks,
      tickets,
      agentLimit:        payload.concurrency.limit,
      todayCalendarDate: TimeUtil.calendarDateOf(nowEpochMilliseconds),
      slices:            payload.limits,
    });
    const headerModel = trackerHeaderModelOf(payload.progress.project, statistics);
    DomUtil.setText(PROJECT_NAME_ELEMENT_ID, headerModel.projectTitle);
    DomUtil.setMarkup(SUMMARY_ELEMENT_ID, headerStatisticsMarkup(headerModel.statistics));
    DomUtil.setMarkup(SUMMARY_LINE_ELEMENT_ID, summaryLineMarkup(trackerSummaryLineOf(statistics)));
  };

  return { show };
}
