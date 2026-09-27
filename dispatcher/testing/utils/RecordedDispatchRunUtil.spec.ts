/**
 * The claims' readers of a recorded run. What the claims rely on is that a run without a summary reads as `null` rather than an empty
 * summary, that the main run's summary is the one read, that a call is written as its kind with its ticket id only when it has one, that
 * a call filter narrows only by the fields it states, and that a run with no builder or reviewer runs on no model at all.
 */
import { describe, expect, test } from 'bun:test';

import type { DispatchSummary }                        from '../../@types/DispatchOutcome.ts';
import type { RecordedAgentCall, RecordedDispatchRun } from '../@types/RecordedDispatchRun.ts';
import { RecordedDispatchRunUtil }                     from './RecordedDispatchRunUtil.ts';

const {
  summaryFrom,
  mainSummaryOf,
  callsOf,
  reviewCountOf,
  workersRunOn,
  kindsAndTicketsOf,
} = RecordedDispatchRunUtil;

const EXAMPLE_SUMMARY: DispatchSummary = {
  delivered:     ['001'],
  parked:        [],
  findingsFiled: [],
  agentsRun:     3,
};

function recordedCall(
  kind: RecordedAgentCall['kind'],
  ticketId: string | null,
  overrides: Partial<Pick<RecordedAgentCall, 'run' | 'model' | 'effort'>> = {},
): RecordedAgentCall {
  return {
    run:                        overrides.run ?? 'main',
    kind,
    ticketId,
    ordinal:                    ticketId === null ? null : 1,
    model:                      overrides.model ?? 'example-model',
    effort:                     overrides.effort ?? 'medium',
    label:                      kind,
    phase:                      kind,
    schema:                     null,
    prompt:                     `The ${kind} prompt.`,
    statusBlocksReturnedBefore: 0,
    logsBefore:                 0,
  };
}

function recordedRunWith(calls: RecordedAgentCall[], summary: unknown): RecordedDispatchRun {
  return {
    calls,
    mostAgentsAtOnce:         1,
    mostAgentsInFlightAtOnce: 1,
    mostLiveAgentsAtOnce:     1,
    mostAgentsOnBoardAtOnce:  1,
    buildersOnBoard:          [],
    slotGaps:                 [],
    racingSummary:            null,
    racingLogs:               [],
    relaunchSummary:          null,
    relaunchLogs:             [],
    rowsRunningAtEnd:         [],
    rowsPaused:               [],
    reviewBarsAdded:          [],
    rereviewsRun:             [],
    logs:                     [],
    heldTicketIdsReturned:    [],
    summary,
    runRanAway:               false,
    runWasResumed:            false,
    phasesEntered:            [],
    threw:                    null,
  };
}

describe('the summary readers', () => {
  test('a run that returned no summary reads as null', () => {
    expect(summaryFrom(null)).toBeNull();
  });

  test('the main summary is the run\'s own summary, as returned', () => {
    expect(mainSummaryOf(recordedRunWith([], EXAMPLE_SUMMARY))).toBe(EXAMPLE_SUMMARY);
  });
});

describe('the calls as kinds and tickets', () => {
  test('a call without a ticket is its kind alone, and one with a ticket is followed by its id', () => {
    const run = recordedRunWith([recordedCall('survey', null), recordedCall('build', '001')], EXAMPLE_SUMMARY);
    expect(kindsAndTicketsOf(run)).toEqual(['survey', 'build 001']);
  });
});

describe('the call filter', () => {
  const run = recordedRunWith([
    recordedCall('survey', null),
    recordedCall('build', '001'),
    recordedCall('review', '001'),
    recordedCall('review', '002'),
    recordedCall('build', '001', { run: 'relaunch' }),
  ], EXAMPLE_SUMMARY);

  test('an empty filter keeps every call', () => {
    expect(callsOf(run, {})).toHaveLength(5);
  });

  test('each stated field narrows the calls, and the fields combine', () => {
    expect(callsOf(run, { kind: 'build' })).toHaveLength(2);
    expect(callsOf(run, { ticketId: '001' })).toHaveLength(3);
    expect(callsOf(run, { run: 'relaunch', kind: 'build', ticketId: '001' })).toHaveLength(1);
    expect(callsOf(run, { run: 'racing' })).toEqual([]);
  });

  test('the review count is every reviewer, or one ticket\'s', () => {
    expect(reviewCountOf(run)).toBe(2);
    expect(reviewCountOf(run, '001')).toBe(1);
    expect(reviewCountOf(run, '003')).toBe(0);
  });

  test('the kinds and tickets can be read for one of the runs', () => {
    expect(kindsAndTicketsOf(run, 'relaunch')).toEqual(['build 001']);
    expect(kindsAndTicketsOf(run, 'racing')).toEqual([]);
  });
});

describe('the workers\' model and effort', () => {
  test('holds when every builder and reviewer ran on the pair, whatever the survey ran on', () => {
    const run = recordedRunWith([
      recordedCall('survey', null, { model: 'survey-model' }),
      recordedCall('build', '001', { model: 'sonnet', effort: 'high' }),
      recordedCall('review', '001', { model: 'sonnet', effort: 'high' }),
    ], EXAMPLE_SUMMARY);
    expect(workersRunOn(run, 'sonnet', 'high')).toBe(true);
    expect(workersRunOn(run, 'sonnet', 'medium')).toBe(false);
  });

  test('is narrowed to one ticket\'s workers when a ticket is given', () => {
    const run = recordedRunWith([
      recordedCall('build', '001', { model: 'sonnet', effort: 'high' }),
      recordedCall('build', '002', { model: 'opus', effort: 'medium' }),
    ], EXAMPLE_SUMMARY);
    expect(workersRunOn(run, 'sonnet', 'high')).toBe(false);
    expect(workersRunOn(run, 'sonnet', 'high', '001')).toBe(true);
    expect(workersRunOn(run, 'opus', 'medium', '002')).toBe(true);
  });

  test('fails when there is no builder or reviewer to have run on it', () => {
    expect(workersRunOn(recordedRunWith([recordedCall('survey', null)], EXAMPLE_SUMMARY), 'example-model', 'medium')).toBe(false);
    expect(workersRunOn(recordedRunWith([recordedCall('build', '001')], EXAMPLE_SUMMARY), 'example-model', 'medium', '002')).toBe(false);
  });
});
