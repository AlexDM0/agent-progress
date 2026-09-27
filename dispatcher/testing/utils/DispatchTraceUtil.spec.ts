/**
 * The reduction of a recorded run to its frozen-table trace. What the table relies on is that a digest is short, stable and hex, that a call is
 * one separated line whose prompt digest can be read back out of it, that an absent value is written as `undefined` rather than dropped, and
 * that a main run which threw has no summary.
 */
import { describe, expect, test } from 'bun:test';

import type { RecordedAgentCall, RecordedDispatchRun } from '../@types/RecordedDispatchRun.ts';
import { DIGEST_LENGTH_CHARACTERS }                    from '../constants/DispatchTraceFormat.ts';
import { DispatchTraceUtil }                           from './DispatchTraceUtil.ts';

const EXAMPLE_PROMPT = 'agent-progress ticket: 001\nBuild the example ticket.';

const BUILDER_CALL: RecordedAgentCall = {
  run:                        'main',
  kind:                       'build',
  ticketId:                   '001',
  ordinal:                    1,
  model:                      'opus',
  effort:                     undefined,
  label:                      'build 001',
  phase:                      'Build',
  schema:                     undefined,
  prompt:                     EXAMPLE_PROMPT,
  statusBlocksReturnedBefore: 1,
  logsBefore:                 2,
};

function recordedRunWith(changes: Partial<RecordedDispatchRun>): RecordedDispatchRun {
  return {
    calls:                    [BUILDER_CALL],
    mostAgentsAtOnce:         1,
    mostAgentsInFlightAtOnce: 1,
    mostLiveAgentsAtOnce:     2,
    mostAgentsOnBoardAtOnce:  1,
    buildersOnBoard:          ['main build 001'],
    slotGaps:                 [],
    racingSummary:            null,
    racingLogs:               [],
    relaunchSummary:          null,
    relaunchLogs:             [],
    rowsRunningAtEnd:         [],
    rowsPaused:               [],
    reviewBarsAdded:          ['review 001'],
    rereviewsRun:             [],
    logs:                     ['Example log line'],
    heldTicketIdsReturned:    [[]],
    summary:                  { delivered: ['001'] },
    ranAway:                  false,
    resumed:                  false,
    phasesEntered:            [{ run: 'main', title: 'Build' }],
    threw:                    null,
    ...changes,
  };
}

describe('digestOf', () => {
  test('is a fixed-length lowercase hex digest that repeats for the same text and differs for another', () => {
    const digest = DispatchTraceUtil.digestOf('example');
    expect(digest).toMatch(new RegExp(`^[0-9a-f]{${DIGEST_LENGTH_CHARACTERS}}$`));
    expect(DispatchTraceUtil.digestOf('example')).toBe(digest);
    expect(DispatchTraceUtil.digestOf('another example')).not.toBe(digest);
  });
});

describe('traceOf', () => {
  test('writes each call as one separated line, an absent value as undefined and the prompt as its digest', () => {
    const [callText] = DispatchTraceUtil.traceOf(recordedRunWith({})).calls;
    expect(callText).toBe(`main|build|001|1|opus|undefined|build 001|Build|undefined|${DispatchTraceUtil.digestOf(EXAMPLE_PROMPT)}|1|2`);
  });

  test('writes each phase entered as its run and title', () => {
    expect(DispatchTraceUtil.traceOf(recordedRunWith({})).phasesEntered).toEqual(['main|Build']);
  });

  test('keeps the summary as JSON, and none when the main run threw', () => {
    expect(DispatchTraceUtil.traceOf(recordedRunWith({})).summaryJson).toBe('{"delivered":["001"]}');
    expect(DispatchTraceUtil.traceOf(recordedRunWith({ threw: 'TypeError' })).summaryJson).toBeNull();
  });

  test('writes a racing or relaunch run that returned nothing as a JSON null', () => {
    const trace = DispatchTraceUtil.traceOf(recordedRunWith({ racingSummary: undefined }));
    expect(trace.racingSummaryJson).toBe('null');
    expect(trace.relaunchSummaryJson).toBe('null');
  });
});

describe('promptDigestOfCallText', () => {
  test('reads back the prompt digest a traced call carries', () => {
    const [callText = ''] = DispatchTraceUtil.traceOf(recordedRunWith({})).calls;
    expect(DispatchTraceUtil.promptDigestOfCallText(callText)).toBe(DispatchTraceUtil.digestOf(EXAMPLE_PROMPT));
  });

  test('has no digest to read from a line too short to carry one', () => {
    expect(DispatchTraceUtil.promptDigestOfCallText('main|survey')).toBeUndefined();
  });
});
