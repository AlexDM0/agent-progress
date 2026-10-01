/** The header's parts that stay put: the project title and the summary statistics, filled once at load. */

import type { PagePayload }                            from '../../src/shared/@types/PagePayload.ts';
import type { BoardTicket }                            from '../@types/PageBoard.ts';
import { PROJECT_NAME_ELEMENT_ID, SUMMARY_ELEMENT_ID } from '../constants/TemplateIds.ts';
import { DomUtil }                                     from '../utils/DomUtil.ts';
import { TimeUtil }                                    from '../utils/TimeUtil.ts';
import { headerStatisticsMarkup }                      from './HeaderMarkup.ts';
import { HeaderFigureUtil }                            from './utils/HeaderFigureUtil.ts';

export interface HeaderController {
  show(nowEpochMilliseconds: number): void;
}

export function createHeaderController(payload: PagePayload, tickets: readonly BoardTicket[]): HeaderController {
  const show = (nowEpochMilliseconds: number): void => {
    DomUtil.setText(PROJECT_NAME_ELEMENT_ID, payload.progress.project);
    DomUtil.setMarkup(SUMMARY_ELEMENT_ID, headerStatisticsMarkup(HeaderFigureUtil.statisticsOf({
      tasks:             payload.progress.tasks,
      tickets,
      agentLimit:        payload.concurrency.limit,
      todayCalendarDate: TimeUtil.calendarDateOf(nowEpochMilliseconds),
      slices:            payload.limits,
    })));
  };

  return { show };
}
