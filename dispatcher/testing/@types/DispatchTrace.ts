/** A dispatch run reduced to what two implementations of the dispatcher must agree on, in a form a frozen table can hold and compare. */
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
