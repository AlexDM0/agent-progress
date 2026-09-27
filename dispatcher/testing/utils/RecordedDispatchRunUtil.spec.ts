/**
 * The claims' readers of a recorded run. What the claims rely on is that a run without a summary reads as `null` rather than an empty
 * summary, that the main run's summary is the one read, and that a call is written as its kind with its ticket id only when it has one.
 */
import { describe, expect, test } from 'bun:test';

import type { DispatchSummary }                        from '../../@types/DispatchOutcome.ts';
import type { RecordedAgentCall, RecordedDispatchRun } from '../@types/RecordedDispatchRun.ts';
import { RecordedDispatchRunUtil }                     from './RecordedDispatchRunUtil.ts';

const { summaryFrom, mainSummaryOf, kindsAndTicketsOf } = RecordedDispatchRunUtil;

const EXAMPLE_SUMMARY: DispatchSummary = {
  delivered:     ['001'],
  parked:        [],
  findingsFiled: [],
  agentsRun:     3,
};

function recordedCall(kind: RecordedAgentCall['kind'], ticketId: string | null): RecordedAgentCall {
  return {
    run:                        'main',
    kind,
    ticketId,
    ordinal:                    ticketId === null ? null : 1,
    model:                      'example-model',
    effort:                     'medium',
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
    ranAway:                  false,
    resumed:                  false,
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
