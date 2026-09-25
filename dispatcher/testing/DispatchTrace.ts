/** A dispatch run reduced to what two implementations of the dispatcher must agree on, in a form a frozen table can hold and compare. */
import type { DispatchRun, RecordedAgentCall } from './DispatchScriptHarness';

const DIGEST_LENGTH_CHARACTERS = 16;

export interface DispatchTrace {
  /** One per agent call, across the main, racing and relaunch runs in the order the board saw them: run|kind|ticket|ordinal|model|effort|label|phase|
   * schema digest|prompt digest|status blocks before|logs before. */
  calls:               string[];
  /** run|title */
  phasesEntered:       string[];
  logs:                string[];
  racingLogs:          string[];
  relaunchLogs:        string[];
  /** `null` when the main run threw. */
  summaryJson:         string | null;
  racingSummaryJson:   string | null;
  relaunchSummaryJson: string | null;
  threw:               string | null;
  counts:              {
    mostAgentsAtOnce:         number;
    mostAgentsInFlightAtOnce: number;
    mostLiveAgentsAtOnce:     number;
    mostAgentsOnBoardAtOnce:  number;
  };
  statusSide:          {
    buildersOnBoard:       string[];
    slotGaps:              string[];
    rowsRunningAtEnd:      string[];
    rowsPaused:            string[];
    reviewBarsAdded:       string[];
    rereviewsRun:          string[];
    heldTicketIdsReturned: string[][];
  };
  ranAway: boolean;
  resumed: boolean;
}

export function digestOf(text: string): string {
  return new Bun.CryptoHasher('sha256').update(text).digest('hex').slice(0, DIGEST_LENGTH_CHARACTERS);
}

function fieldTextOf(value: unknown): string {
  if (typeof value === 'string') return value;
  return value === undefined ? 'undefined' : JSON.stringify(value);
}

function schemaDigestOf(schema: unknown): string {
  return schema === undefined ? 'undefined' : digestOf(JSON.stringify(schema));
}

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
  ].join('|');
}

export function traceOf(run: DispatchRun): DispatchTrace {
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
    ranAway: run.ranAway,
    resumed: run.resumed,
  };
}
