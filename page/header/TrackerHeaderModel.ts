/** The tracker page's header model: its four summary statistics in the design's order, and a paused figure while a build is paused. */

import { TokenCountUtil }                                           from '../../src/lib/token-count/TokenCountUtil.ts';
import type { KanbanLane }                                          from '../kanban/@types/KanbanLane.ts';
import type { HeaderModel, HeaderStatisticModel, SummaryLineModel } from './@types/HeaderModel.ts';
import type { HeaderStatistics }                                    from './utils/HeaderFigureUtil.ts';

function laneStatistic(lane: KanbanLane, figure: string, label: string, state: 'paused' | null = null): HeaderStatisticModel {
  return {
    figure, label, opensLane: lane, state
  };
}

/** Paused builds wait in the In progress lane, so the figure opens it; with none paused there is no figure at all. */
export function trackerHeaderStatisticsOf(statistics: HeaderStatistics): HeaderStatisticModel[] {
  const agentsFigure = statistics.agentLimit === null
    ? String(statistics.runningTaskCount)
    : `${statistics.runningTaskCount} / ${statistics.agentLimit}`;
  return [
    laneStatistic('progress', agentsFigure, 'agents working'),
    ...(statistics.pausedBuildCount > 0 ? [laneStatistic('progress', String(statistics.pausedBuildCount), 'paused', 'paused')] : []),
    laneStatistic('done', String(statistics.deliveredTodayCount), 'done today'),
    {
      figure: TokenCountUtil.formatTokenCount(statistics.tokensToday), label: 'tokens today', opensLane: null, state: null
    },
    laneStatistic('todo', String(statistics.waitingInQueueCount), 'waiting in queue'),
  ];
}

/** The embedded page's summary line: the board's states on the left, today's figures on the right, formatted as the statistics format them. */
export function trackerSummaryLineOf(statistics: HeaderStatistics): SummaryLineModel {
  return {
    states: [
      { figure: String(statistics.runningTaskCount - statistics.runningReviewCount), label: 'building', state: 'in-progress' },
      { figure: String(statistics.runningReviewCount), label: 'reviewing', state: 'reviewing' },
      { figure: String(statistics.waitingInQueueCount), label: 'waiting in queue', state: 'pending' },
      { figure: String(statistics.pausedBuildCount), label: 'paused', state: 'paused' },
    ],
    today: [
      { figure: String(statistics.deliveredTodayCount), label: 'done today', state: 'delivered' },
      { figure: TokenCountUtil.formatTokenCount(statistics.tokensToday), label: 'tokens today', state: null },
    ],
  };
}

export function trackerHeaderModelOf(projectTitle: string, statistics: HeaderStatistics): HeaderModel {
  return { projectTitle, statistics: trackerHeaderStatisticsOf(statistics) };
}
