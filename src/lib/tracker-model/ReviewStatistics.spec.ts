/**
 * The joins `review-stats` stands on, each on a small Board: a ticket counts once however many passes it has, the change-size bucket
 * edges sit on the stated bounds, only free-standing review bars count as review tokens, a record naming no ticket on the board is left
 * out, and a ratio over nothing is null. The full hand-computed table over every split is `cli/measurement/review-stats/ReviewStatsCommand.spec.ts`.
 */
import { describe, expect, test } from 'bun:test';

import { boardFixture, taskFixture, ticketFixture } from '../../testing/BoardFixtures.ts';
import type { LogRecord }                           from './@types/LogRecord.ts';
import type { ReviewFinding }                       from './@types/ReviewRecord.ts';

const RECORDED_AT = '2026-10-26T12:00:00+01:00';

const SERIOUS_FINDING: ReviewFinding = {
  class:    'correctness',
  severity: 'would-ship-a-bug',
  file:     'lib/example.ts',
  summary:  'An example defect',
  evidence: 'watched-fail',
  outcome:  'fixed',
  commit:   'abc1234',
};

function reviewRecorded(ticketId: string, round: number, changedLines: { insertions: number; deletions: number }, findings: ReviewFinding[] = []): LogRecord {
  return {
    at:     RECORDED_AT,
    kind:   'review-recorded',
    taskId: 1,
    ticketId,
    fields: {
      round,
      verdict:                 'released',
      reviewStartCommit:       'def5678',
      fixReworkedCodeLines:    0,
      rebaseReworkedCodeLines: 0,
      totalReworkedCodeLines:  0,
      builderChangedFiles:     1,
      builderInsertions:       changedLines.insertions,
      builderDeletions:        changedLines.deletions,
      claims:                  [],
      findings,
    },
  };
}

describe('a recorded ticket', () => {
  test('with two passes counts both passes and one ticket, its rounds as the distinct rounds', () => {
    const { board } = boardFixture({ tickets: [ticketFixture({ id: '001' })] });

    const report = board.reviewStatisticsOf([
      reviewRecorded('001', 1, { insertions: 10, deletions: 0 }),
      reviewRecorded('001', 2, { insertions: 10, deletions: 0 }),
    ]);

    expect(report.recordedTicketCount).toBe(1);
    expect(report.all.ticketCount).toBe(1);
    expect(report.all.reviewPassCount).toBe(2);
    expect(report.all.roundsPerTicket).toBe(2);
  });

  test('recorded twice in one round, after a main-moved rebase say, counts one pass, the latest record', () => {
    const { board } = boardFixture({ tickets: [ticketFixture({ id: '001' })] });

    const report = board.reviewStatisticsOf([
      reviewRecorded('001', 1, { insertions: 10, deletions: 0 }, [SERIOUS_FINDING]),
      reviewRecorded('001', 1, { insertions: 10, deletions: 0 }),
    ]);

    expect(report.all.reviewPassCount).toBe(1);
    expect(report.all.roundsPerTicket).toBe(1);
    expect(report.all.seriousFindingCount).toBe(0);
  });

  test('with no record is counted apart and in no group, and a record naming a ticket the board lacks is left out', () => {
    const { board } = boardFixture({ tickets: [ticketFixture({ id: '001' }), ticketFixture({ id: '002' })] });

    const report = board.reviewStatisticsOf([reviewRecorded('001', 1, { insertions: 1, deletions: 0 }), reviewRecorded('009', 1, { insertions: 1, deletions: 0 })]);

    expect(report.recordedTicketCount).toBe(1);
    expect(report.unrecordedTicketCount).toBe(1);
    expect(report.byType.map((group) => group.statistics.ticketCount)).toEqual([1]);
  });
});

describe('the change-size buckets', () => {
  test('take insertions plus deletions of the first pass, each bound inclusive', () => {
    const { board } = boardFixture({ tickets: ['001', '002', '003', '004', '005'].map((id) => ticketFixture({ id })) });

    const report = board.reviewStatisticsOf([
      reviewRecorded('001', 1, { insertions: 30, deletions: 20 }),
      reviewRecorded('001', 2, { insertions: 900, deletions: 0 }),
      reviewRecorded('002', 1, { insertions: 51, deletions: 0 }),
      reviewRecorded('003', 1, { insertions: 100, deletions: 100 }),
      reviewRecorded('004', 1, { insertions: 750, deletions: 0 }),
      reviewRecorded('005', 1, { insertions: 750, deletions: 1 }),
    ]);

    expect(report.byChangeSize.map(({ changeSize, statistics }) => [changeSize, statistics.ticketCount])).toEqual([
      ['small', 1],
      ['medium', 2],
      ['large', 1],
      ['oversized', 1],
    ]);
  });
});

describe('the tokens', () => {
  test('of the review are the free-standing bars reviewing the ticket, a ticket-owned row naming it excepted, a bar without tokens as 0', () => {
    const { board } = boardFixture({
      tasks: [
        taskFixture({ id: 1, ticket: '001', tokens: 1000 }),
        taskFixture({ id: 2, reviewOf: '001', tokens: 300 }),
        taskFixture({ id: 3, reviewOf: '001', tokens: null }),
        taskFixture({
          id: 4, ticket: '002', reviewOf: '001', tokens: 5000
        }),
      ],
      tickets: [ticketFixture({ id: '001', task: 1 }), ticketFixture({ id: '002', task: 4 })],
    });

    const report = board.reviewStatisticsOf([reviewRecorded('001', 1, { insertions: 1, deletions: 0 }, [SERIOUS_FINDING])]);

    expect(report.all.reviewTokens).toBe(300);
    expect(report.all.builderTokens).toBe(1000);
    expect(report.all.reviewTokensPerSeriousFinding).toBe(300);
  });

  test('per serious finding, escaped bugs per delivered ticket and the contradicted share are null over nothing', () => {
    const { board } = boardFixture({ tickets: [ticketFixture({ id: '001' })] });

    const report = board.reviewStatisticsOf([reviewRecorded('001', 1, { insertions: 1, deletions: 0 })]);

    expect(report.all.reviewTokensPerSeriousFinding).toBeNull();
    expect(report.all.afterCleanLastReview.escapedBugsPerDeliveredTicket).toBeNull();
    expect(report.all.handoffContradictedShare).toBeNull();
  });
});
