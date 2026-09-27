import type { DispatchTrace }                          from '../@types/DispatchTrace.ts';
import type { RecordedAgentCall, RecordedDispatchRun } from '../@types/RecordedDispatchRun.ts';
import { DIGEST_LENGTH_CHARACTERS }                    from '../constants/DispatchTraceFormat.ts';

function digestOf(text: string): string {
  return new Bun.CryptoHasher('sha256').update(text).digest('hex').slice(0, DIGEST_LENGTH_CHARACTERS);
}

function fieldTextOf(value: unknown): string {
  if (typeof value === 'string') return value;
  return value === undefined ? 'undefined' : JSON.stringify(value);
}

function schemaDigestOf(schema: unknown): string {
  return schema === undefined ? 'undefined' : digestOf(JSON.stringify(schema));
}

const CALL_TEXT_FIELD_SEPARATOR = '|';
// The position of `digestOf(call.prompt)` in the array below.
const PROMPT_DIGEST_FIELD_INDEX = 9;

function callTextOf(call: RecordedAgentCall): string {
  return [
    call.run,
    call.kind,
    fieldTextOf(call.ticketId),
    fieldTextOf(call.ordinal),
    fieldTextOf(call.model),
    fieldTextOf(call.effort),
    fieldTextOf(call.label),
    fieldTextOf(call.phase),
    schemaDigestOf(call.schema),
    digestOf(call.prompt),
    String(call.statusBlocksReturnedBefore),
    String(call.logsBefore),
  ].join(CALL_TEXT_FIELD_SEPARATOR);
}

function promptDigestOfCallText(callText: string): string | undefined {
  return callText.split(CALL_TEXT_FIELD_SEPARATOR)[PROMPT_DIGEST_FIELD_INDEX];
}

function traceOf(run: RecordedDispatchRun): DispatchTrace {
  return {
    calls:               run.calls.map(callTextOf),
    phasesEntered:       run.phasesEntered.map((phaseEntered) => `${phaseEntered.run}|${fieldTextOf(phaseEntered.title)}`),
    logs:                run.logs,
    racingLogs:          run.racingLogs,
    relaunchLogs:        run.relaunchLogs,
    summaryJson:         run.threw === null ? JSON.stringify(run.summary) : null,
    racingSummaryJson:   JSON.stringify(run.racingSummary ?? null),
    relaunchSummaryJson: JSON.stringify(run.relaunchSummary ?? null),
    threw:               run.threw,
    counts:              {
      mostAgentsAtOnce:         run.mostAgentsAtOnce,
      mostAgentsInFlightAtOnce: run.mostAgentsInFlightAtOnce,
      mostLiveAgentsAtOnce:     run.mostLiveAgentsAtOnce,
      mostAgentsOnBoardAtOnce:  run.mostAgentsOnBoardAtOnce,
    },
    statusSide: {
      buildersOnBoard:       run.buildersOnBoard,
      slotGaps:              run.slotGaps,
      rowsRunningAtEnd:      run.rowsRunningAtEnd,
      rowsPaused:            run.rowsPaused,
      reviewBarsAdded:       run.reviewBarsAdded,
      rereviewsRun:          run.rereviewsRun,
      heldTicketIdsReturned: run.heldTicketIdsReturned,
    },
    ranAway: run.runRanAway,
    resumed: run.runWasResumed,
  };
}

export const DispatchTraceUtil = { digestOf, promptDigestOfCallText, traceOf } as const;
