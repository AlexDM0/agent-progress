/**
 * The finished-work rules, the static page's read from the Board facts. What matters: the stored key name and default stay the page's, the
 * retired `recent` and anything unreadable read as the default, a span or a since-day sets the cutoff, open work always shows, and the
 * filter line and window phrase read as the page's did.
 */
import { describe, expect, test } from 'bun:test';

import { FIXTURE_NOW, FIXTURE_TICKETS }                                               from '../../testing/BoardStateFixture.ts';
import { DEFAULT_FINISHED_WORK_CHOICE, FINISHED_WORK_CHOICE_NAME, FinishedWorkModel } from './FinishedWorkModel.ts';

const NOW = FIXTURE_NOW.getTime();

describe('the stored choice', () => {
  test('keeps the static page\'s key name and default', () => {
    expect([FINISHED_WORK_CHOICE_NAME, DEFAULT_FINISHED_WORK_CHOICE]).toEqual(['visibility', '1d']);
  });

  test('reads a span, a real since-day, and falls back to the default for recent, nothing, or a day that does not exist', () => {
    expect(['3d', 'since-2026-10-01', 'recent', null, 'since-2026-02-30', 'soon'].map((stored) => FinishedWorkModel.choiceFrom(stored)))
      .toEqual(['3d', 'since-2026-10-01', '1d', '1d', '1d', '1d']);
  });
});

describe('what a choice shows', () => {
  test('the last day shows this morning\'s delivery and yesterday\'s abandonment, latest first, and hides the older one', () => {
    const { shown, hiddenCount } = FinishedWorkModel.finishedTicketsOf(FIXTURE_TICKETS, FinishedWorkModel.cutoffEpochMillisecondsOf('1d', NOW));
    expect([shown.map((ticket) => ticket.id), hiddenCount]).toEqual([['2', '5'], 1]);
  });

  test('all shows every finished ticket and since a day shows from its local midnight', () => {
    expect(FinishedWorkModel.finishedTicketsOf(FIXTURE_TICKETS, FinishedWorkModel.cutoffEpochMillisecondsOf('all', NOW)).hiddenCount).toBe(0);
    expect(FinishedWorkModel.finishedTicketsOf(FIXTURE_TICKETS, FinishedWorkModel.cutoffEpochMillisecondsOf('since-2026-10-29', NOW)).shown.map((ticket) => ticket.id))
      .toEqual(['2']);
  });

  test('the filter line and window phrase read as the page\'s', () => {
    expect([
      FinishedWorkModel.filterLineTextOf('1d', 1),
      FinishedWorkModel.filterLineTextOf('since-2026-09-24', 2),
      FinishedWorkModel.filterLineTextOf('1h', 0),
      FinishedWorkModel.windowPhraseOf('6h'),
      FinishedWorkModel.windowPhraseOf('all'),
      FinishedWorkModel.labelOf('since-2026-09-24'),
    ]).toEqual(['Hiding closed > 1 day', 'Hiding closed before 09-24', 'Showing all closed', 'in the last 6 hours', 'ever', 'since 09-24']);
  });
});
