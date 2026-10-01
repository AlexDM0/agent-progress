/**
 * The header's words: the four summary statistics and a paused count when builds are paused, each state one a button to its Kanban lane,
 * and the status line's freshness text.
 */

import { HtmlEscapeUtil }                       from '../../src/lib/html-escape/HtmlEscapeUtil.ts';
import { TokenCountUtil }                       from '../../src/lib/token-count/TokenCountUtil.ts';
import type { KanbanLane }                      from '../kanban/@types/KanbanLane.ts';
import type { ShortenedText }                   from '../utils/MarkupUtil.ts';
import { MarkupUtil }                           from '../utils/MarkupUtil.ts';
import { TimeUtil }                             from '../utils/TimeUtil.ts';
import type { HeaderStatistics, PageFreshness } from './utils/HeaderFigureUtil.ts';

function statisticContentMarkup(figure: string, label: string): string {
  return `<span class="ap-stat-n">${HtmlEscapeUtil.escapeHtml(figure)}</span><span class="ap-stat-label">${HtmlEscapeUtil.escapeHtml(label)}</span>`;
}

function laneStatisticMarkup(lane: KanbanLane, figure: string, label: string, state: 'paused' | null = null): string {
  const stateAttribute = state === null ? '' : `${MarkupUtil.attribute('data-state', state)} `;
  const attributes     = `${stateAttribute}${MarkupUtil.attribute('data-kanban-lane', lane)} ${MarkupUtil.attribute('aria-label', `Show ${figure} ${label} on Kanban`)}`;
  return `<button type="button" class="ap-stat" ${attributes}>${statisticContentMarkup(figure, label)}</button>`;
}

/** Paused builds wait in the In progress lane, so the figure opens it; with none paused there is no figure at all. */
function pausedStatisticMarkup(pausedBuildCount: number): string {
  return pausedBuildCount > 0 ? laneStatisticMarkup('progress', String(pausedBuildCount), 'paused', 'paused') : '';
}

export function headerStatisticsMarkup(statistics: HeaderStatistics): string {
  const agentsFigure = statistics.agentLimit === null
    ? String(statistics.runningTaskCount)
    : `${statistics.runningTaskCount} / ${statistics.agentLimit}`;
  return [
    laneStatisticMarkup('progress', agentsFigure, 'agents working'),
    pausedStatisticMarkup(statistics.pausedBuildCount),
    laneStatisticMarkup('done', String(statistics.deliveredTodayCount), 'done today'),
    `<span class="ap-stat">${statisticContentMarkup(TokenCountUtil.formatTokenCount(statistics.tokensToday), 'tokens today')}</span>`,
    laneStatisticMarkup('todo', String(statistics.waitingInQueueCount), 'waiting in queue'),
  ].join('');
}

export function freshnessLabel(freshness: PageFreshness): string {
  return freshness.isLive ? 'Live' : 'Snapshot';
}

/** A live page leads with its age, a snapshot with when it was made; the stamp follows the page's one stamp rule, in full on hover. */
export function freshnessText(generatedAtEpochMilliseconds: number, freshness: PageFreshness, todayCalendarDate: string): ShortenedText {
  const stamp = TimeUtil.shortInstantText(generatedAtEpochMilliseconds, todayCalendarDate);
  const text  = freshness.isLive ? `generated ${freshness.ageText} · ${stamp}` : `generated ${stamp} · ${freshness.ageText}`;
  return MarkupUtil.shortenedText(text, `generated ${TimeUtil.fullInstantText(generatedAtEpochMilliseconds)}`);
}
