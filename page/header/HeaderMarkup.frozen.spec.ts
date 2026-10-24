/**
 * The tracker page's header statistics, frozen before they moved onto the shared header model: the template's sample statistics
 * (`resources/template.html`'s `#ap-summary`) and a board with no limit and nothing paused must print exactly what they printed. Taken at
 * bb03e16 by printing `headerStatisticsMarkup` of each case's figures; retake only in a commit meant to change the header's markup, by
 * printing the same calls at that commit and pasting each statistic's markup below.
 */

import { describe, expect, test }    from 'bun:test';
import { headerStatisticsMarkup }    from './HeaderMarkup.ts';
import { trackerHeaderStatisticsOf } from './TrackerHeaderModel.ts';
import type { HeaderStatistics }     from './utils/HeaderFigureUtil.ts';

interface FrozenStatisticsCase {
  readonly name:       string;
  readonly statistics: HeaderStatistics;
  readonly markup:     readonly string[];
}

const FROZEN_STATISTICS_CASES: readonly FrozenStatisticsCase[] = [
  {
    name:       'the template sample, with a limit and a paused build',
    statistics: {
      runningTaskCount: 4, runningReviewCount: 2, agentLimit: 5, pausedBuildCount: 1, deliveredTodayCount: 12, tokensToday: 21_400_000, waitingInQueueCount: 6
    },
    markup: [
      '<button type="button" class="ap-stat" data-kanban-lane="progress" aria-label="Show 4 / 5 agents working on Kanban">'
        + '<span class="ap-stat-n">4 / 5</span><span class="ap-stat-label">agents working</span></button>',
      '<button type="button" class="ap-stat" data-state="paused" data-kanban-lane="progress" aria-label="Show 1 paused on Kanban">'
        + '<span class="ap-stat-n">1</span><span class="ap-stat-label">paused</span></button>',
      '<button type="button" class="ap-stat" data-kanban-lane="done" aria-label="Show 12 done today on Kanban">'
        + '<span class="ap-stat-n">12</span><span class="ap-stat-label">done today</span></button>',
      '<span class="ap-stat"><span class="ap-stat-n">21.4M</span><span class="ap-stat-label">tokens today</span></span>',
      '<button type="button" class="ap-stat" data-kanban-lane="todo" aria-label="Show 6 waiting in queue on Kanban">'
        + '<span class="ap-stat-n">6</span><span class="ap-stat-label">waiting in queue</span></button>',
    ],
  },
  {
    name:       'no limit and nothing paused',
    statistics: {
      runningTaskCount: 0, runningReviewCount: 0, agentLimit: null, pausedBuildCount: 0, deliveredTodayCount: 0, tokensToday: 0, waitingInQueueCount: 3
    },
    markup: [
      '<button type="button" class="ap-stat" data-kanban-lane="progress" aria-label="Show 0 agents working on Kanban">'
        + '<span class="ap-stat-n">0</span><span class="ap-stat-label">agents working</span></button>',
      '<button type="button" class="ap-stat" data-kanban-lane="done" aria-label="Show 0 done today on Kanban">'
        + '<span class="ap-stat-n">0</span><span class="ap-stat-label">done today</span></button>',
      '<span class="ap-stat"><span class="ap-stat-n">0</span><span class="ap-stat-label">tokens today</span></span>',
      '<button type="button" class="ap-stat" data-kanban-lane="todo" aria-label="Show 3 waiting in queue on Kanban">'
        + '<span class="ap-stat-n">3</span><span class="ap-stat-label">waiting in queue</span></button>',
    ],
  },
];

describe('the tracker header statistics, frozen', () => {
  for (const frozenCase of FROZEN_STATISTICS_CASES) {
    test(`${frozenCase.name} prints the frozen markup`, () => {
      expect(headerStatisticsMarkup(trackerHeaderStatisticsOf(frozenCase.statistics))).toBe(frozenCase.markup.join(''));
    });
  }
});
