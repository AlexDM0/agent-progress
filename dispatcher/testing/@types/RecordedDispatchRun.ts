/** `settings` is a single-ticket run's lookup of the model and effort its arguments did not state; its `ticketId` is the ids it names, comma-joined. */
export type AgentKind = 'survey' | 'settings' | 'build' | 'review' | 'park';

/** `main` is the scenario's run of the script; `racing` the single-ticket run started beside it on the same board; `relaunch` the run after it. */
export type DispatchRunName = 'main' | 'racing' | 'relaunch';

export interface RecordedAgentCall {
  run:                        DispatchRunName;
  kind:                       AgentKind;
  ticketId:                   string | null;
  /** The builder's pass, the reviewer's round or the parking agent's call for this ticket, counted by the harness from 1; `null` for the survey. */
  ordinal:                    number | null;
  model:                      unknown;
  effort:                     unknown;
  agentType:                  unknown;
  label:                      unknown;
  phase:                      unknown;
  schema:                     unknown;
  prompt:                     string;
  /** How many status blocks this run had been handed when the call was made: an index into `heldTicketIdsReturned`. */
  statusBlocksReturnedBefore: number;
  /** How many lines this call's own run had logged when the call was made, which pins how its logs interleave with its agent calls. */
  logsBefore:                 number;
}

export interface RecordedDispatchRun {
  calls:                    RecordedAgentCall[];
  /** The most of the script's own builders and reviewers that were running at one moment. */
  mostAgentsAtOnce:         number;
  /** The most agents in flight at one moment: the board's others, every builder and reviewer of the script's own on the board yet or not, and every
   * row left running that no own agent of the same kind and ticket is running to take over. A parking agent adds none. */
  mostAgentsInFlightAtOnce: number;
  /** The most agents alive at one moment, which is what the limit bounds: the board's others and every own agent of any kind, the survey and each
   * parking agent included; a row left running is no agent. */
  mostLiveAgentsAtOnce:     number;
  /** The most agents `status --json` counted at one moment: the board's others and every running row, whichever run's. */
  mostAgentsOnBoardAtOnce:  number;
  /** Every builder that reached the board, by its claim or by carrying on past its own, as `<run> build <ticket>`. */
  buildersOnBoard:          string[];
  /** Every builder that returned `in-review`, or reviewer that asked for another round, without leaving the next reviewer's bar running, as
   * `build <ticket>` or `review <ticket>`: a moment its ticket held no slot. */
  slotGaps:                 string[];
  /** The summary the racing run returned, `null` without one, and what it logged. */
  racingSummary:            unknown;
  racingLogs:               string[];
  /** The summary the whole-board relaunch returned, `null` without one, and what it logged. */
  relaunchSummary:          unknown;
  relaunchLogs:             string[];
  /** The rows left running when the script returned, as `build <ticket>` or `review <ticket>`; a paused row is not among them. */
  rowsRunningAtEnd:         string[];
  /** The rows a parking agent paused, as `build <ticket>`. */
  rowsPaused:               string[];
  /** Every review bar added, as `review <ticket>`, a restarted or killed attempt's included; a bar taken over is not added again. */
  reviewBarsAdded:          string[];
  /** Every `ticket rereview` run, a restarted attempt's included, as `rereview <ticket> round <the ticket's round>`: each counts a round on the row. */
  rereviewsRun:             string[];
  logs:                     string[];
  /** The `heldTicketIds` of every status block the main run was handed, in order. */
  heldTicketIdsReturned:    string[][];
  summary:                  unknown;
  /** Whether the script passed `MOST_AGENT_CALLS_PER_RUN`, after which every agent answered `null` so the run could end. */
  runRanAway:               boolean;
  /** Whether `killedAtFirstCommandOf` was reached, so that `summary` is the resumed run's. */
  runWasResumed:            boolean;
  phasesEntered:            { run: DispatchRunName; title: unknown }[];
  /** What the main run threw, `null` when it returned: `TypeError` for a type error, otherwise the error's message. */
  threw:                    string | null;
}
