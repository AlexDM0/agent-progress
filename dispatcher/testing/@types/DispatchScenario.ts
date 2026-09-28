import type { DispatcherState }                                from '../../../src/lib/tracker-model/@types/TrackerProgress.ts';
import type { BuilderOutcome, ReviewFinding, ReviewerVerdict } from '../../@types/AgentReadings.ts';
import type { AgentModelAndEffort }                            from '../../@types/DispatchSettings.ts';
import type { RecordedAgentCall }                              from './RecordedDispatchRun.ts';

export interface BuilderReply {
  outcome:    BuilderOutcome;
  detail?:    string;
  claimNote?: string;
}

export interface ReviewerReply {
  verdict:         ReviewerVerdict;
  releaseReason?:  string;
  blockingFiles?:  string[];
  reworkedLines?:  number;
  findings?:       ReviewFinding[];
  filedTicketIds?: string[];
}

export interface FakeBoard {
  limit:                 number;
  otherAgentsInFlight:   number;
  readyTicketIds:        string[];
  /** Which tickets are low priority, ready or not; the status block names those among the ready ones. */
  lowPriorityTicketIds:  string[];
  highPriorityTicketIds: string[];
  dispatcherState:       DispatcherState;
  /** The tickets `ticket hold` holds; `afterAgent` may hold or unhold one mid-run. */
  heldTicketIds:         string[];
}

/**
 * How one agent departs from the fake board's answer. `nothing` and `throws` leave the board as a dead agent does; `replacesFields` is merged
 * over the document the agent returns, its status block included.
 */
export type AgentMisbehaviour = { returns: 'nothing' } | { throws: string } | { replacesFields: Record<string, unknown> };

export interface DispatchScenario {
  limit:                          number;
  readyTicketIds:                 string[];
  lowPriorityTicketIds?:          string[];
  highPriorityTicketIds?:         string[];
  /** Passed to the script as `args.ticketIds`, with `args.readyTickets` copied from the board's entries for them, as the orchestrator launches one. */
  ticketIds?:                     string[];
  /** A single-ticket run of the script for these tickets, started `racingRunStartsAfterTurns` turns after the main run, against the same board. */
  racingTicketIds?:               string[];
  racingRunStartsAfterTurns?:     number;
  /** A claim from elsewhere takes a free slot the moment a builder of the script's returns, after its status block was taken. */
  elsewhereClaimsAFreedSlot?:     boolean;
  /** The tickets that name their own model and effort; every other ticket runs on the tool's default pair. */
  agentSettingsByTicketId?:       Record<string, AgentModelAndEffort>;
  /** Passed to the script as `args.includeLowPriority`; left out of the arguments when absent. */
  includeLowPriority?:            boolean;
  otherAgentsInFlight?:           number;
  reviewWaitingTicketIds?:        string[];
  /** Held from the start, as `status --json` lists them in `heldTicketIds`. */
  heldTicketIds?:                 string[];
  /** Defaults to `running`; `afterAgent` may change it mid-run. */
  dispatcherState?:               DispatcherState;
  /** Defaults to `in-review`; `null` is an agent that died. */
  builderReply?:                  (ticketId: string, pass: number) => BuilderReply | null;
  /** Defaults to `released`; `null` is an agent that died. */
  reviewerReply?:                 (ticketId: string, round: number) => ReviewerReply | null;
  /** Runs as an agent finishes and before its status block is taken, so a scenario can file a ticket mid-run. */
  afterAgent?:                    (call: RecordedAgentCall, board: FakeBoard) => void;
  /** How many turns a builder or reviewer runs before its first command puts it on the board; defaults to `DEFAULT_TURNS_BEFORE_FIRST_COMMAND`. */
  turnsBeforeFirstCommand?:       number;
  /** Every status block leaves out `inProgressTicketIds` and `inProgressReviewOfIds`, as an agent that did not copy them would. */
  statusOmitsInProgressRows?:     boolean;
  /** Every status block leaves out `readyTickets`, as an agent that did not copy it would. */
  statusOmitsReadyTickets?:       boolean;
  /**
   * The runtime restarts the first builder of each of these tickets with the same prompt, inside the same `agent()` call: its first attempt
   * claimed the ticket and made its worktree, and its claimed row stays running for the restarted attempt to carry on in.
   */
  restartedBuilderTicketIds?:     string[];
  /**
   * The same for the reviewer of each of these tickets on `restartedReviewerRound` (the first by default): its first attempt ran its prompt's
   * `ticket rereview`, if any, and added or took its bar, which stays running.
   */
  restartedReviewerTicketIds?:    string[];
  restartedReviewerRound?:        number;
  /**
   * The run is killed the moment this agent (`build 001`, `review 001`) has put its row on the board: every own agent dies with its row left
   * running, and the script is resumed from the journal, the longest prefix of completed calls with unchanged prompts answered from it.
   */
  killedAtFirstCommandOf?:        string;
  /**
   * Tickets in progress whose build row is paused from the start, each with its claim's note, as an earlier dispatcher run's parking agent leaves
   * one a hold or a stop kept from its next builder; their worktree exists unless `pausedBuildIdsWithoutWorktree` names them. They are not
   * ready: a whole-board survey returns them as `pausedBuilds`.
   */
  pausedBuildNotesByTicketId?:    Record<string, string>;
  /** The main checkout's uncommitted tracked files, as the survey's `git status` lists them; none by default. */
  dirtyMainCheckoutFiles?:        string[];
  /** Paused builds among those whose worktree is gone, as the survey's `test -d` finds it. */
  pausedBuildIdsWithoutWorktree?: string[];
  /** Once the run returns, the user's go sets the board running and a fresh whole-board run starts on the board it left; its calls are `relaunch`. */
  relaunchedAfterTheRun?:         boolean;
  /** Spread last over the main run's arguments only; a value of `undefined` leaves that argument missing. */
  argumentOverrides?:             Record<string, unknown>;
  agentMisbehaviour?:             (call: RecordedAgentCall) => AgentMisbehaviour | undefined;
  /**
   * A group run of the script: `args.group` names it, and the board's group holds these tickets, each depending on the one before, the last its
   * release ticket. A reviewer answers `integrated` by default, which moves the group branch and the ticket to `reviewed`.
   */
  group?:                         GroupScenario;
  /** These agents (`build 102`, `review 101`) run `SLOW_AGENT_EXTRA_TURNS` turns longer from their first command to their return. */
  slowAgentNames?:                string[];
}

export interface GroupScenario {
  name:      string;
  ticketIds: string[];
}
