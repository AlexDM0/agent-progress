/** The header's words: the statistics of a header model, each one opening a lane a button to it, and the status line's freshness text. */

import { HtmlEscapeUtil }            from '../../src/lib/html-escape/HtmlEscapeUtil.ts';
import type { ShortenedText }        from '../utils/MarkupUtil.ts';
import { MarkupUtil }                from '../utils/MarkupUtil.ts';
import { TimeUtil }                  from '../utils/TimeUtil.ts';
import type { HeaderStatisticModel } from './@types/HeaderModel.ts';
import type { PageFreshness }        from './utils/HeaderFigureUtil.ts';

function statisticContentMarkup(figure: string, label: string): string {
  return `<span class="ap-stat-n">${HtmlEscapeUtil.escapeHtml(figure)}</span><span class="ap-stat-label">${HtmlEscapeUtil.escapeHtml(label)}</span>`;
}

function statisticMarkup(statistic: HeaderStatisticModel): string {
  const {
    figure, label, opensLane, state
  } = statistic;
  const stateAttribute = state === null ? '' : ` ${MarkupUtil.attribute('data-state', state)}`;
  if (opensLane === null) {
    return `<span class="ap-stat"${stateAttribute}>${statisticContentMarkup(figure, label)}</span>`;
  }
  const attributes = `${stateAttribute} ${MarkupUtil.attribute('data-kanban-lane', opensLane)} ${MarkupUtil.attribute('aria-label', `Show ${figure} ${label} on Kanban`)}`;
  return `<button type="button" class="ap-stat"${attributes}>${statisticContentMarkup(figure, label)}</button>`;
}

/** A statistic that opens a lane is a button to it; one that opens none is plain text. */
export function headerStatisticsMarkup(statistics: readonly HeaderStatisticModel[]): string {
  return statistics.map(statisticMarkup).join('');
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
