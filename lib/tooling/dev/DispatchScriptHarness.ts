/**
 * Runs `templates/workflows/AgentProgressDispatch.js` as the Workflow tool would, against a fake `agent()` and a fake board, so a spec can pin
 * the script's decisions without spawning a model. An agent's kind is read from its prompt's token marker, the way the hook reads it. A builder
 * or reviewer is on the board from its first command, as a real one is from its claim or its `task add --start`, until it finishes — except that
 * a builder that stops short of review and a reviewer that returns nothing leave their row running, until a fresh agent's first command takes it over,
 * or a parking agent pauses the ticket's row (`task pause`: a paused row is not running) and closes its review bar. The fake agents follow their
 * prompt where a real one's first command depends on it: a builder whose ticket an earlier attempt claimed is refused as in-progress unless its
 * prompt says that claim is its run's own, and a reviewer finding an earlier attempt's bar adds a second unless its prompt says to take that one.
 */
import { readFileSync } from 'node:fs';
import { join }         from 'node:path';

import { DEFAULT_AGENT_EFFORT, DEFAULT_AGENT_MODEL } from '../../constants/AgentSettings.ts';

export type AgentKind = 'survey' | 'build' | 'review' | 'park';

export interface ReviewFinding {
  class:   string;
  file:    string;
  summary: string;
}

export interface BuilderReply {
  outcome:    'in-review' | 'claim-refused' | 'failed';
  detail?:    string;
  claimNote?: string;
}

export interface ReviewerReply {
  verdict:         'released' | 'round-requested' | 'does-not-hold' | 'not-released';
  releaseReason?:  string;
  reworkedLines?:  number;
  findings?:       ReviewFinding[];
  filedTicketIds?: string[];
}

export type DispatcherStateOnBoard = 'running' | 'stopped' | 'finished';

export interface TicketAgentSettings {
  model:  string;
  effort: string;
}

export interface FakeBoard {
  limit:                number;
  otherAgentsInFlight:  number;
  readyTicketIds:       string[];
  /** Which tickets are low priority, ready or not; the status block names those among the ready ones. */
  lowPriorityTicketIds:  string[];
  highPriorityTicketIds: string[];
  dispatcherState:       DispatcherStateOnBoard;
}

/** `main` is the scenario's run of the script; `racing` the single-ticket run started beside it on the same board. */
export type DispatchRunName = 'main' | 'racing';

export interface RecordedAgentCall {
  run:      DispatchRunName;
  kind:     AgentKind;
  ticketId: string | null;
  /** The builder's pass, the reviewer's round or the parking agent's call for this ticket, counted by the harness from 1; `null` for the survey. */
  ordinal:  number | null;
  model:    unknown;
  effort:   unknown;
  label:    unknown;
  prompt:   string;
}

export interface DispatchScenario {
  limit:                       number;
  readyTicketIds:              string[];
  lowPriorityTicketIds?:       string[];
  highPriorityTicketIds?:      string[];
  /** Passed to the script as `args.ticketIds`, with `args.readyTickets` copied from the board's entries for them, as the orchestrator launches one. */
  ticketIds?:                  string[];
  /** A single-ticket run of the script for these tickets, started `racingRunStartsAfterTurns` turns after the main run, against the same board. */
  racingTicketIds?:            string[];
  racingRunStartsAfterTurns?:  number;
  /** A claim from elsewhere takes a free slot the moment a builder of the script's returns, after its status block was taken. */
  elsewhereClaimsAFreedSlot?:  boolean;
  /** The tickets that name their own model and effort; every other ticket runs on the tool's default pair. */
  agentSettingsByTicketId?:    Record<string, TicketAgentSettings>;
  /** Passed to the script as `args.includeLowPriority`; left out of the arguments when absent. */
  includeLowPriority?:         boolean;
  otherAgentsInFlight?:        number;
  reviewWaitingTicketIds?:     string[];
  /** Defaults to `running`; `afterAgent` may change it mid-run. */
  dispatcherState?:            DispatcherStateOnBoard;
  /** Defaults to `in-review`; `null` is an agent that died. */
  builderReply?:               (ticketId: string, pass: number) => BuilderReply | null;
  /** Defaults to `released`; `null` is an agent that died. */
  reviewerReply?:              (ticketId: string, round: number) => ReviewerReply | null;
  /** Runs as an agent finishes and before its status block is taken, so a scenario can file a ticket mid-run. */
  afterAgent?:                 (call: RecordedAgentCall, board: FakeBoard) => void;
  /** How many turns a builder or reviewer runs before its first command puts it on the board; defaults to `DEFAULT_TURNS_BEFORE_FIRST_COMMAND`. */
  turnsBeforeFirstCommand?:    number;
  /** Every status block leaves out `runningTicketIds` and `runningReviewOfIds`, as an agent that did not derive them would. */
  statusOmitsRunningRows?:     boolean;
  /** Every status block leaves out `readyTickets`, as an agent that did not copy it would. */
  statusOmitsReadyTickets?:    boolean;
  /**
   * The runtime restarts the first builder of each of these tickets with the same prompt, inside the same `agent()` call: its first attempt
   * claimed the ticket and made its worktree, and its claimed row stays running for the restarted attempt to carry on in.
   */
  restartedBuilderTicketIds?:  string[];
  /** The same for the first reviewer of each of these tickets: its first attempt added its bar, which stays running. */
  restartedReviewerTicketIds?: string[];
  /**
   * The run is killed the moment this agent (`build 001`, `review 001`) has put its row on the board: every own agent dies with its row left
   * running, and the script is resumed from the journal, the longest prefix of completed calls with unchanged prompts answered from it.
   */
  killedAtFirstCommandOf?:     string;
}

export interface DispatchRun {
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
  /** Every builder that returned `in-review` without leaving its reviewer's bar running, as `build <ticket>`: a moment its ticket held no slot. */
  slotGaps:                 string[];
  /** The summary the racing run returned, `null` without one, and what it logged. */
  racingSummary:            unknown;
  racingLogs:               string[];
  /** The rows left running when the script returned, as `build <ticket>` or `review <ticket>`; a paused row is not among them. */
  rowsRunningAtEnd:         string[];
  /** The rows a parking agent paused, as `build <ticket>`. */
  rowsPaused:               string[];
  /** Every review bar added, as `review <ticket>`, a restarted or killed attempt's included; a bar taken over is not added again. */
  reviewBarsAdded:          string[];
  logs:                     string[];
  summary:                  unknown;
  /** Whether the script passed `MOST_AGENT_CALLS_PER_RUN`, after which every agent answered `null` so the run could end. */
  ranAway:                  boolean;
  /** Whether `killedAtFirstCommandOf` was reached, so that `summary` is the resumed run's. */
  resumed:                  boolean;
}

/** The sentence a builder's prompt carries on past a claim refused as in-progress by, and the one a reviewer's takes a bar left running by. */
export const BUILDER_CARRIES_ON_PAST_ITS_OWN_CLAIM = 'the claim is this run\'s own';
export const REVIEWER_TAKES_OVER_A_RUNNING_BAR     = 'take it as your bar and add none';

interface RunningRow {
  kind:     AgentKind;
  ticketId: string;
  /** A builder's claim note, which is what tells one run's claim on a ticket from another's; empty on a review bar. */
  note:     string;
}

interface JournalEntry {
  prompt:    string;
  reply:     unknown;
  completed: boolean;
}

const MOST_AGENT_CALLS_PER_RUN           = 200;
const DEFAULT_TURNS_BEFORE_FIRST_COMMAND = 1;
const TURNS_FROM_FIRST_COMMAND_TO_RETURN = 1;
const ARGUMENTS_FOR_SCRIPT               = {
  mainCheckout: '/scratch/example-repository',
  mainLine:     'main',
  checkCommand: 'example-check',
};

type ScriptBody = (...values: unknown[]) => Promise<unknown>;

type FakeAgent = (prompt: string, options?: Record<string, unknown>) => Promise<unknown>;

/** What an agent of a killed run answers: nothing, ever, as the killed process never returns. */
const NEVER_SETTLES = new Promise<never>(() => {});

const KILLED = Symbol('killed');

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...parameterNames: string[]) => ScriptBody;

const SCRIPT_GLOBAL_NAMES = ['agent', 'parallel', 'pipeline', 'phase', 'log', 'args', 'budget', 'workflow', 'Date', 'Math'];

export function dispatchScriptPath(): string {
  return join(import.meta.dir, '..', '..', '..', 'templates', 'workflows', 'AgentProgressDispatch.js');
}

export function readDispatchScript(): string {
  return readFileSync(dispatchScriptPath(), 'utf8');
}

/** The clock and randomness a Workflow script is refused at runtime, refused here too so a run cannot lean on them. */
function guardedDate(): DateConstructor {
  return new Proxy(Date, {
    construct(target, constructorArguments: unknown[]) {
      if (constructorArguments.length === 0) throw new Error('A Workflow script may not call new Date() without an argument.');
      return Reflect.construct(target, constructorArguments) as object;
    },
    apply() {
      throw new Error('A Workflow script may not call Date().');
    },
    get(target, property) {
      if (property === 'now') throw new Error('A Workflow script may not call Date.now().');
      return Reflect.get(target, property) as unknown;
    },
  });
}

function guardedMath(): Math {
  return Object.freeze({
    ...Object.fromEntries(Object.getOwnPropertyNames(Math).map((name) => [name, Reflect.get(Math, name) as unknown])),
    random: () => { throw new Error('A Workflow script may not call Math.random().'); },
  }) as unknown as Math;
}

function compileScript(source: string): ScriptBody {
  return new AsyncFunction(...SCRIPT_GLOBAL_NAMES, source.replace(/^export const meta\b/m, 'const meta'));
}

function markerIdentifierIn(prompt: string, marker: string): string | null {
  const match = new RegExp(`^agent-progress ${marker}: (\\S+)$`, 'm').exec(prompt);
  return match?.[1] ?? null;
}

function kindOf(builtTicketId: string | null, reviewedTicketId: string | null, parkedTicketId: string | null): AgentKind {
  if (builtTicketId !== null) return 'build';
  if (reviewedTicketId !== null) return 'review';
  return parkedTicketId !== null ? 'park' : 'survey';
}

function rowNameOf(rowKey: string): string {
  return rowKey.replace(':', ' ');
}

function claimNoteIn(prompt: string): string {
  return /ticket claim \S+ --owner \S+ --note "([^"]*)"/.exec(prompt)?.[1] ?? '';
}

async function nextTurn(): Promise<void> {
  await new Promise((resolve) => { setImmediate(resolve); });
}

async function turnsPass(count: number): Promise<void> {
  for (let i = 0; i < count; i++) await nextTurn();
}

// A builder's claimed row stays running until `ticket review`, a reviewer's bar until it closes it or a release does.
function rowIsLeftRunning(kind: AgentKind, reply: Record<string, unknown> | null): boolean {
  if (kind === 'build') return reply === null || reply['outcome'] === 'failed';
  return kind === 'review' && reply === null;
}

function reviewerDocumentOf(reply: ReviewerReply, round: number): Record<string, unknown> {
  return {
    round,
    verdict:        reply.verdict,
    releaseReason:  reply.releaseReason ?? '',
    reworkedLines:  reply.reworkedLines ?? 0,
    findings:       reply.findings ?? [],
    filedTicketIds: reply.filedTicketIds ?? [],
  };
}

export async function runDispatchScript(scenario: DispatchScenario, source: string = readDispatchScript()): Promise<DispatchRun> {
  const board: FakeBoard = {
    limit:                 scenario.limit,
    otherAgentsInFlight:   scenario.otherAgentsInFlight ?? 0,
    readyTicketIds:        [...scenario.readyTicketIds],
    lowPriorityTicketIds:  [...scenario.lowPriorityTicketIds ?? []],
    highPriorityTicketIds: [...scenario.highPriorityTicketIds ?? []],
    dispatcherState:       scenario.dispatcherState ?? 'running',
  };
  const calls: RecordedAgentCall[] = [];
  const logs: string[] = [];
  const racingLogs: string[] = [];
  const passesByTicket = new Map<string, number>();
  const ownAgentsOnBoard = new Map<number, RunningRow>();
  const rowsLeftRunning = new Map<string, RunningRow>();
  const rowKeysOfOwnAgentsRunning = new Map<number, string>();
  const pausedRowKeys = new Set<string>();
  const turnsBeforeFirstCommand = scenario.turnsBeforeFirstCommand ?? DEFAULT_TURNS_BEFORE_FIRST_COMMAND;
  let mostAgentsAtOnce = 0;
  let mostAgentsInFlightAtOnce = 0;
  let liveOwnAgents = 0;
  let mostLiveAgentsAtOnce = 0;
  let mostAgentsOnBoardAtOnce = 0;
  let ranAway = false;
  const reviewBarsAdded: string[] = [];
  const buildersOnBoard: string[] = [];
  const slotGaps: string[] = [];
  const deliveredTicketIds = new Set<string>();
  const journal: JournalEntry[] = [];
  let generation = 1;
  let announceKill: () => void = () => {};
  const runIsKilled = new Promise<void>((resolve) => { announceKill = resolve; });

  const killTheRun = (): void => {
    generation++;
    for (const row of ownAgentsOnBoard.values()) rowsLeftRunning.set(`${row.kind}:${row.ticketId}`, row);
    ownAgentsOnBoard.clear();
    rowKeysOfOwnAgentsRunning.clear();
    liveOwnAgents = 0;
    announceKill();
  };

  // The first attempt's first command, before the runtime restarted it: its claim takes the ticket off the ready list, or its bar is added.
  const restartedAttemptActs = (kind: AgentKind, ticketId: string, rowKey: string, prompt: string): void => {
    rowsLeftRunning.set(rowKey, { kind, ticketId, note: kind === 'build' ? claimNoteIn(prompt) : '' });
    board.readyTicketIds = board.readyTicketIds.filter((readyTicketId) => readyTicketId !== ticketId);
    if (kind === 'review') reviewBarsAdded.push(rowNameOf(rowKey));
  };

  const restartedTicketIdsOf = (kind: AgentKind): string[] => {
    if (kind === 'build') return scenario.restartedBuilderTicketIds ?? [];
    return kind === 'review' ? scenario.restartedReviewerTicketIds ?? [] : [];
  };

  const ticketIdsOfRunningRows = (kind: AgentKind): string[] => [...ownAgentsOnBoard.values(), ...rowsLeftRunning.values()]
    .filter((row) => row.kind === kind)
    .map((row) => row.ticketId);

  const rowsLeftRunningWithoutTakeover = (): number => {
    const rowKeysBeingTakenOver = new Set(rowKeysOfOwnAgentsRunning.values());
    return [...rowsLeftRunning.keys()].filter((rowKey) => !rowKeysBeingTakenOver.has(rowKey)).length;
  };

  const statedAgentSettingsOf = (ticketId: string): TicketAgentSettings | null => {
    const settingsByTicketId = scenario.agentSettingsByTicketId ?? {};
    return Object.hasOwn(settingsByTicketId, ticketId) ? settingsByTicketId[ticketId] ?? null : null;
  };

  const priorityOf = (ticketId: string): string => {
    if (board.lowPriorityTicketIds.includes(ticketId)) return 'low';
    return board.highPriorityTicketIds.includes(ticketId) ? 'high' : 'normal';
  };

  // As `status --json` resolves them: every ready ticket with its priority, and its model and effort, the defaults filled in.
  const readyTicketsOnBoard = (): Record<string, string>[] => board.readyTicketIds.map((readyTicketId) => ({
    id:       readyTicketId,
    priority: priorityOf(readyTicketId),
    model:    statedAgentSettingsOf(readyTicketId)?.model ?? DEFAULT_AGENT_MODEL,
    effort:   statedAgentSettingsOf(readyTicketId)?.effort ?? DEFAULT_AGENT_EFFORT,
  }));

  const agentsOnBoard = (): number => board.otherAgentsInFlight + ownAgentsOnBoard.size + rowsLeftRunning.size;

  const noteTheBoard = (): void => {
    mostAgentsOnBoardAtOnce = Math.max(mostAgentsOnBoardAtOnce, agentsOnBoard());
  };

  const runningRowOf = (rowKey: string): RunningRow | undefined => [...ownAgentsOnBoard.values(), ...rowsLeftRunning.values()]
    .find((row) => `${row.kind}:${row.ticketId}` === rowKey);

  // As `ticket claim` answers: a running row of the ticket refuses it unless the prompt carries on past a claim bearing its own note, and a full board
  // refuses a new agent. A builder refused as in-progress returns that row's note, as its prompt asks.
  const claimOutcomeFor = (ticketId: string, prompt: string, earlierRow: RunningRow | undefined, reply: Record<string, unknown>): Record<string, unknown> => {
    if (reply['outcome'] === 'claim-refused') return { ...reply, claimNote: earlierRow?.note ?? '' };
    if (earlierRow !== undefined) {
      if (prompt.includes(BUILDER_CARRIES_ON_PAST_ITS_OWN_CLAIM) && earlierRow.note === claimNoteIn(prompt)) return reply;
      return { ...reply, outcome: 'claim-refused', detail: `#${ticketId} is in-progress`, claimNote: earlierRow.note };
    }
    if (runningRowOf(`review:${ticketId}`) !== undefined) return { ...reply, outcome: 'claim-refused', detail: `#${ticketId} is under review` };
    if (deliveredTicketIds.has(ticketId)) return { ...reply, outcome: 'claim-refused', detail: `#${ticketId} is delivered` };
    if (agentsOnBoard() >= board.limit) return { ...reply, outcome: 'claim-refused', detail: `no slot free: ${agentsOnBoard()} of ${board.limit} agents in flight` };
    return reply;
  };

  // A builder's `--start-review` leaves its reviewer's bar running in the same lock hold; a plain `ticket review` frees the slot for a moment.
  const builderHandsItsSlotOn = (ticketId: string, prompt: string): void => {
    if (prompt.includes(`ticket review ${ticketId} --start-review`)) {
      rowsLeftRunning.set(`review:${ticketId}`, { kind: 'review', ticketId, note: '' });
      reviewBarsAdded.push(`review ${ticketId}`);
      return;
    }
    slotGaps.push(`build ${ticketId}`);
    if (scenario.elsewhereClaimsAFreedSlot === true && agentsOnBoard() < board.limit) board.otherAgentsInFlight++;
  };

  // As the `tickets` list states them: a ticket's model and effort only where it names them.
  const reviewWaitingTicketsOnBoard = (): Record<string, string>[] => (scenario.reviewWaitingTicketIds ?? []).map((reviewWaitingTicketId) => ({
    id: reviewWaitingTicketId,
    ...statedAgentSettingsOf(reviewWaitingTicketId),
  }));

  const statusBlock = (): Record<string, unknown> => {
    const agentsInFlight = agentsOnBoard();
    const concurrency = {
      limit:           board.limit,
      agentsInFlight,
      freeSlots:       Math.max(0, board.limit - agentsInFlight),
      readyTicketIds:  [...board.readyTicketIds],
      ...(scenario.statusOmitsReadyTickets === true ? {} : { readyTickets: readyTicketsOnBoard() }),
      dispatcherState: board.dispatcherState,
    };
    if (scenario.statusOmitsRunningRows === true) return concurrency;
    return { ...concurrency, runningTicketIds: ticketIdsOfRunningRows('build'), runningReviewOfIds: ticketIdsOfRunningRows('review') };
  };

  const replyFor = (call: RecordedAgentCall): Record<string, unknown> | null => {
    if (call.kind === 'survey') return { status: statusBlock(), reviewWaitingTickets: reviewWaitingTicketsOnBoard() };
    if (call.kind === 'park') return { status: statusBlock() };
    const ticketId = call.ticketId ?? '';
    const ordinal  = call.ordinal ?? 1;
    if (call.kind === 'build') {
      const reply = scenario.builderReply === undefined ? { outcome: 'in-review' as const } : scenario.builderReply(ticketId, ordinal);
      return reply === null ? null : {
        outcome:   reply.outcome,
        detail:    reply.detail ?? '',
        claimNote: reply.claimNote ?? '',
        status:    statusBlock(),
      };
    }
    const reply = scenario.reviewerReply === undefined ? { verdict: 'released' as const } : scenario.reviewerReply(ticketId, ordinal);
    return reply === null ? null : { ...reviewerDocumentOf(reply, ordinal), status: statusBlock() };
  };

  const fakeAgent = async (prompt: string, options: Record<string, unknown>, run: DispatchRunName): Promise<unknown> => {
    const callGeneration   = generation;
    const builtTicketId    = markerIdentifierIn(prompt, 'ticket');
    const reviewedTicketId = markerIdentifierIn(prompt, 'review');
    const parkedTicketId   = markerIdentifierIn(prompt, 'park');
    const kind             = kindOf(builtTicketId, reviewedTicketId, parkedTicketId);
    const ticketId         = builtTicketId ?? reviewedTicketId ?? parkedTicketId;
    const passKey          = `${kind}:${ticketId ?? ''}`;
    const ordinal          = kind === 'survey' ? null : (passesByTicket.get(`${run} ${passKey}`) ?? 0) + 1;
    passesByTicket.set(`${run} ${passKey}`, ordinal ?? 0);
    const call: RecordedAgentCall = {
      run,
      kind,
      ticketId,
      ordinal,
      model:  options['model'],
      effort: options['effort'],
      label:  options['label'],
      prompt,
    };
    calls.push(call);
    if (calls.length > MOST_AGENT_CALLS_PER_RUN) {
      ranAway = true;
      return null;
    }
    let reply = replyFor(call);
    if (ticketId !== null && ordinal === 1 && restartedTicketIdsOf(kind).includes(ticketId)) restartedAttemptActs(kind, ticketId, passKey, prompt);
    liveOwnAgents++;
    mostLiveAgentsAtOnce = Math.max(mostLiveAgentsAtOnce, board.otherAgentsInFlight + liveOwnAgents);
    if (kind === 'park' && ticketId !== null) {
      await turnsPass(turnsBeforeFirstCommand);
      if (generation !== callGeneration) return NEVER_SETTLES;
      const ticketRowKey = `build:${ticketId}`;
      if (rowsLeftRunning.delete(ticketRowKey)) pausedRowKeys.add(ticketRowKey);
      rowsLeftRunning.delete(`review:${ticketId}`);
      noteTheBoard();
      await turnsPass(TURNS_FROM_FIRST_COMMAND_TO_RETURN);
      if (generation !== callGeneration) return NEVER_SETTLES;
      liveOwnAgents--;
      scenario.afterAgent?.(call, board);
      return reply === null ? null : { ...reply, status: statusBlock() };
    }
    const callIndex = calls.length - 1;
    rowKeysOfOwnAgentsRunning.set(callIndex, passKey);
    mostAgentsAtOnce = Math.max(mostAgentsAtOnce, rowKeysOfOwnAgentsRunning.size);
    mostAgentsInFlightAtOnce = Math.max(mostAgentsInFlightAtOnce, board.otherAgentsInFlight + rowKeysOfOwnAgentsRunning.size + rowsLeftRunningWithoutTakeover());
    if (kind === 'survey' || ticketId === null) {
      await nextTurn();
      if (generation !== callGeneration) return NEVER_SETTLES;
    } else {
      await turnsPass(turnsBeforeFirstCommand);
      if (generation !== callGeneration) return NEVER_SETTLES;
      const earlierRow = runningRowOf(passKey);
      const earlierRowIsRunning = earlierRow !== undefined;
      if (kind === 'build' && reply !== null) reply = claimOutcomeFor(ticketId, prompt, earlierRow, reply);
      const reachesTheBoard = reply?.['outcome'] !== 'claim-refused';
      const ownRow: RunningRow = { kind, ticketId, note: kind === 'build' ? claimNoteIn(prompt) : '' };
      if (reachesTheBoard) {
        const takesTheEarlierRowOver = kind === 'build' || (earlierRowIsRunning && prompt.includes(REVIEWER_TAKES_OVER_A_RUNNING_BAR));
        if (takesTheEarlierRowOver) {
          rowsLeftRunning.delete(passKey);
          pausedRowKeys.delete(passKey);
        } else {
          reviewBarsAdded.push(rowNameOf(passKey));
        }
        if (kind === 'build') {
          board.readyTicketIds = board.readyTicketIds.filter((readyTicketId) => readyTicketId !== ticketId);
          buildersOnBoard.push(`${run} build ${ticketId}`);
        }
        ownAgentsOnBoard.set(callIndex, ownRow);
        noteTheBoard();
        if (generation === 1 && scenario.killedAtFirstCommandOf === rowNameOf(passKey)) {
          killTheRun();
          return NEVER_SETTLES;
        }
      }
      await turnsPass(TURNS_FROM_FIRST_COMMAND_TO_RETURN);
      if (generation !== callGeneration) return NEVER_SETTLES;
      ownAgentsOnBoard.delete(callIndex);
      if (reachesTheBoard && rowIsLeftRunning(kind, reply)) rowsLeftRunning.set(passKey, ownRow);
      if (kind === 'build' && reply?.['outcome'] === 'in-review') builderHandsItsSlotOn(ticketId, prompt);
      // A release delivers every running bar that reviews the ticket, a second one included.
      if (kind === 'review' && reply?.['verdict'] === 'released') {
        rowsLeftRunning.delete(passKey);
        deliveredTicketIds.add(ticketId);
      }
      noteTheBoard();
    }
    rowKeysOfOwnAgentsRunning.delete(callIndex);
    liveOwnAgents--;
    scenario.afterAgent?.(call, board);
    return reply === null ? null : { ...reply, ...('status' in reply ? { status: statusBlock() } : {}) };
  };

  const journaledAgent: FakeAgent = async (prompt, options = {}) => {
    if (generation !== 1) return NEVER_SETTLES;
    const entry: JournalEntry = { prompt, reply: null, completed: false };
    journal.push(entry);
    entry.reply = await fakeAgent(prompt, options, 'main');
    entry.completed = true;
    return entry.reply;
  };

  const racingAgent: FakeAgent = async (prompt, options = {}) => fakeAgent(prompt, options, 'racing');

  let resumedCallCount = 0;
  let replayIsOver = false;
  const replayingAgent: FakeAgent = async (prompt, options = {}) => {
    const entry = journal[resumedCallCount++];
    if (!replayIsOver && entry?.completed === true && entry.prompt === prompt) {
      await nextTurn();
      return entry.reply;
    }
    replayIsOver = true;
    return fakeAgent(prompt, options, 'main');
  };

  // As the orchestrator launches a single-ticket run: the ids, and their `readyTickets` entries copied from the status document of that moment.
  const argumentsFor = (ticketIds: string[] | undefined): Record<string, unknown> => {
    const withPriority = scenario.includeLowPriority === undefined ? ARGUMENTS_FOR_SCRIPT : { ...ARGUMENTS_FOR_SCRIPT, includeLowPriority: scenario.includeLowPriority };
    if (ticketIds === undefined) return withPriority;
    return { ...withPriority, ticketIds, readyTickets: readyTicketsOnBoard().filter((entry) => ticketIds.includes(entry['id'] ?? '')) };
  };

  const scriptBody = compileScript(source);
  const runScript = async (agentOfThisRun: FakeAgent, runGeneration: number, scriptArguments: Record<string, unknown>, logsOfThisRun: string[]): Promise<unknown> => scriptBody(
    agentOfThisRun,
    async (thunks: (() => Promise<unknown>)[]) => Promise.all(thunks.map(async (thunk) => thunk().catch(() => null))),
    () => { throw new Error('The harness offers no pipeline(): the dispatcher runs its own pool.'); },
    () => {},
    (message: string) => { if (generation === runGeneration) logsOfThisRun.push(message); },
    scriptArguments,
    { total: null, spent: () => 0, remaining: () => Number.POSITIVE_INFINITY },
    () => { throw new Error('The harness offers no workflow().'); },
    guardedDate(),
    guardedMath(),
  );
  const mainArguments   = argumentsFor(scenario.ticketIds);
  const racingRun       = (async () => {
    if (scenario.racingTicketIds === undefined) return null;
    await turnsPass(scenario.racingRunStartsAfterTurns ?? 0);
    return runScript(racingAgent, 1, argumentsFor(scenario.racingTicketIds), racingLogs);
  })();
  const firstRunOutcome = await Promise.race([runScript(journaledAgent, 1, mainArguments, logs), runIsKilled.then(() => KILLED)]);
  const resumed         = firstRunOutcome === KILLED;
  const summary         = resumed ? await runScript(replayingAgent, generation, mainArguments, logs) : firstRunOutcome;
  const racingSummary   = await racingRun;
  return {
    calls,
    mostAgentsAtOnce,
    mostAgentsInFlightAtOnce,
    mostLiveAgentsAtOnce,
    mostAgentsOnBoardAtOnce,
    buildersOnBoard,
    slotGaps,
    racingSummary,
    racingLogs,
    rowsRunningAtEnd: [...rowsLeftRunning.keys()].map(rowNameOf),
    rowsPaused:       [...pausedRowKeys].map(rowNameOf),
    reviewBarsAdded,
    logs,
    summary,
    ranAway,
    resumed,
  };
}
