/**
 * Runs a dispatcher Workflow script's text as the Workflow tool would, against fake agents and a fake board, so a spec can pin its decisions
 * without spawning a model.
 */
import { DEFAULT_AGENT_EFFORT, DEFAULT_AGENT_MODEL }       from '../../src/lib/tracker-model/constants/AgentSettings.ts';
import { DispatcherClaimNoteUtil }                         from '../../src/shared/utils/DispatcherClaimNoteUtil.ts';
import type { AgentModelAndEffort }                        from '../@types/DispatchSettings.ts';
import type { DispatchScenario, FakeBoard, ReviewerReply } from './@types/DispatchScenario.ts';
import type {
  AgentKind,
  DispatchRunName,
  RecordedAgentCall,
  RecordedDispatchRun
} from './@types/RecordedDispatchRun.ts';
import { AGENT_PROMPT_SENTENCES } from './constants/AgentPromptSentences.ts';
import { WORKFLOW_GLOBAL_NAMES }  from './constants/WorkflowGlobalNames.ts';

const {
  BUILDER_CARRIES_ON_PAST_ITS_OWN_CLAIM,
  BUILDER_RESUMES_A_PAUSED_ROW,
  BUILDER_TAKES_OVER_A_PAUSED_DISPATCHER_BUILD,
  REVIEWER_TAKES_OVER_A_RUNNING_BAR,
  REVIEWER_LEAVES_ITS_BAR_FOR_THE_NEXT_ROUND,
  REVIEWER_SKIPS_A_REREVIEW_ALREADY_RUN,
} = AGENT_PROMPT_SENTENCES;

interface RunningRow {
  kind:        AgentKind;
  ticketId:    string;
  /** A builder's claim note, which is what tells one run's claim on a ticket from another's; empty on a review bar. */
  note:        string;
  /** The round a review bar is named for, the ticket's `## Review` count plus one when it was opened; `null` on a builder's row. */
  reviewRound: number | null;
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

const SCRIPT_GLOBAL_NAMES = [...WORKFLOW_GLOBAL_NAMES, 'Date', 'Math'];

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

// An agent's kind is read from its prompt's token marker, the way the hook reads it.
function markerIdentifierIn(prompt: string, marker: string): string | null {
  const match = new RegExp(`^agent-progress ${marker}: (\\S+)$`, 'm').exec(prompt);
  return match?.[1] ?? null;
}

function kindOf(builtTicketId: string | null, reviewedTicketId: string | null, parkedTicketId: string | null, lookedUpTicketIds: string | null): AgentKind {
  if (builtTicketId !== null) return 'build';
  if (reviewedTicketId !== null) return 'review';
  if (lookedUpTicketIds !== null) return 'settings';
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

function reviewAsksForAnotherRound(reply: Record<string, unknown> | null): boolean {
  return reply?.['verdict'] === 'round-requested' || (reply?.['verdict'] === 'not-released' && reply['releaseReason'] === 'main-moved');
}

// A builder's claimed row stays running until `ticket finish`, a reviewer's bar until it closes it, the next round's `rereview` does, or a release.
function rowIsLeftRunning(kind: AgentKind, reply: Record<string, unknown> | null, prompt: string): boolean {
  if (kind === 'build') return reply === null || reply['outcome'] === 'failed';
  if (kind !== 'review') return false;
  return reply === null || (reviewAsksForAnotherRound(reply) && prompt.includes(REVIEWER_LEAVES_ITS_BAR_FOR_THE_NEXT_ROUND));
}

function thrownTextOf(error: unknown): string {
  if (error instanceof TypeError) return 'TypeError';
  return error instanceof Error ? error.message : String(error);
}

function reviewerDocumentOf(reply: ReviewerReply, round: number): Record<string, unknown> {
  return {
    round,
    verdict:        reply.verdict,
    releaseReason:  reply.releaseReason ?? '',
    blockingFiles:  reply.blockingFiles ?? [],
    reworkedLines:  reply.reworkedLines ?? 0,
    findings:       reply.findings ?? [],
    filedTicketIds: reply.filedTicketIds ?? [],
  };
}

export async function runDispatchScript(scenario: DispatchScenario, source: string): Promise<RecordedDispatchRun> {
  const board: FakeBoard = {
    limit:                 scenario.limit,
    otherAgentsInFlight:   scenario.otherAgentsInFlight ?? 0,
    readyTicketIds:        [...scenario.readyTicketIds],
    lowPriorityTicketIds:  [...scenario.lowPriorityTicketIds ?? []],
    highPriorityTicketIds: [...scenario.highPriorityTicketIds ?? []],
    dispatcherState:       scenario.dispatcherState ?? 'running',
    heldTicketIds:         [...scenario.heldTicketIds ?? []],
  };
  const calls: RecordedAgentCall[] = [];
  const logs: string[] = [];
  const racingLogs: string[] = [];
  const relaunchLogs: string[] = [];
  const logsOf = (run: DispatchRunName): string[] => ({ main: logs, racing: racingLogs, relaunch: relaunchLogs })[run];
  const phasesEntered: { run: DispatchRunName; title: unknown }[] = [];
  const heldTicketIdsReturned: string[][] = [];
  const passesByTicket = new Map<string, number>();
  const ownAgentsOnBoard = new Map<number, RunningRow>();
  const rowsLeftRunning = new Map<string, RunningRow>();
  const rowKeysOfOwnAgentsRunning = new Map<number, string>();
  const pausedRows = new Map<string, RunningRow>(Object.entries(scenario.pausedBuildNotesByTicketId ?? {}).map(([ticketId, note]) => [`build:${ticketId}`, {
    kind:        'build',
    ticketId,
    note,
    reviewRound: null,
  }]));
  const turnsBeforeFirstCommand = scenario.turnsBeforeFirstCommand ?? DEFAULT_TURNS_BEFORE_FIRST_COMMAND;
  let mostAgentsAtOnce = 0;
  let mostAgentsInFlightAtOnce = 0;
  let liveOwnAgents = 0;
  let mostLiveAgentsAtOnce = 0;
  let mostAgentsOnBoardAtOnce = 0;
  let runRanAway = false;
  const reviewBarsAdded: string[] = [];
  const rereviewsRun: string[] = [];
  const reviewsWrittenByTicket = new Map<string, number>();
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

  // Every reviewer that returned wrote its `## Review`, so the ticket's round is their count plus one, as `ticket rereview` names its bar.
  const ticketRoundOf = (ticketId: string): number => (reviewsWrittenByTicket.get(ticketId) ?? 0) + 1;

  // As a real reviewer follows its prompt: the rereview runs unless the prompt skips it and the bar of the ticket's round already runs.
  const reviewerRunsItsRereview = (ticketId: string, prompt: string, earlierRow: RunningRow | undefined): boolean => {
    if (!prompt.includes(`ticket rereview ${ticketId}`)) return false;
    const barOfThisRoundRuns = earlierRow?.reviewRound === ticketRoundOf(ticketId);
    const rereviewRuns = !(barOfThisRoundRuns && prompt.includes(REVIEWER_SKIPS_A_REREVIEW_ALREADY_RUN));
    if (rereviewRuns) rereviewsRun.push(`rereview ${ticketId} round ${ticketRoundOf(ticketId)}`);
    return rereviewRuns;
  };

  const runningRowOf = (rowKey: string): RunningRow | undefined => [...ownAgentsOnBoard.values(), ...rowsLeftRunning.values()]
    .find((row) => `${row.kind}:${row.ticketId}` === rowKey);

  // As `ticket claim --note` and `task start` set it: a row carried on past or resumed keeps its note unless the resuming command names one.
  const builderRowNoteAfterFirstCommand = (prompt: string, earlierRow: RunningRow | undefined, pausedRow: RunningRow | undefined): string => {
    if (earlierRow !== undefined) return earlierRow.note;
    if (pausedRow === undefined) return claimNoteIn(prompt);
    return prompt.includes(`${BUILDER_RESUMES_A_PAUSED_ROW} --note "${claimNoteIn(prompt)}"`) ? claimNoteIn(prompt) : pausedRow.note;
  };

  // The first attempt's first command, before the runtime restarted it: its claim takes the ticket off the ready list, or its bar is added.
  const restartedAttemptActs = (kind: AgentKind, ticketId: string, rowKey: string, prompt: string): void => {
    if (kind === 'review') reviewerRunsItsRereview(ticketId, prompt, runningRowOf(rowKey));
    rowsLeftRunning.set(rowKey, {
      kind,
      ticketId,
      note:        kind === 'build' ? builderRowNoteAfterFirstCommand(prompt, runningRowOf(rowKey), pausedRows.get(rowKey)) : '',
      reviewRound: kind === 'review' ? ticketRoundOf(ticketId) : null,
    });
    board.readyTicketIds = board.readyTicketIds.filter((readyTicketId) => readyTicketId !== ticketId);
    if (kind === 'review') reviewBarsAdded.push(rowNameOf(rowKey));
  };

  const restartedTicketIdsOf = (kind: AgentKind): string[] => {
    if (kind === 'build') return scenario.restartedBuilderTicketIds ?? [];
    return kind === 'review' ? scenario.restartedReviewerTicketIds ?? [] : [];
  };

  const restartedOrdinalOf = (kind: AgentKind): number => (kind === 'review' ? scenario.restartedReviewerRound ?? 1 : 1);

  const ticketIdsOfInProgressRows = (kind: AgentKind): string[] => [...ownAgentsOnBoard.values(), ...rowsLeftRunning.values()]
    .filter((row) => row.kind === kind)
    .map((row) => row.ticketId);

  const rowsLeftRunningWithoutTakeover = (): number => {
    const rowKeysBeingTakenOver = new Set(rowKeysOfOwnAgentsRunning.values());
    return [...rowsLeftRunning.keys()].filter((rowKey) => !rowKeysBeingTakenOver.has(rowKey)).length;
  };

  const statedAgentSettingsOf = (ticketId: string): AgentModelAndEffort | null => {
    const settingsByTicketId = scenario.agentSettingsByTicketId ?? {};
    return Object.hasOwn(settingsByTicketId, ticketId) ? settingsByTicketId[ticketId] ?? null : null;
  };

  const priorityOf = (ticketId: string): string => {
    if (board.lowPriorityTicketIds.includes(ticketId)) return 'low';
    return board.highPriorityTicketIds.includes(ticketId) ? 'high' : 'normal';
  };

  // As `status --json` resolves them: every ready ticket with its priority, and its model and effort, the defaults filled in.
  const readyTicketsOnBoard = (): Record<string, unknown>[] => board.readyTicketIds.map((readyTicketId) => ({
    id:       readyTicketId,
    priority: priorityOf(readyTicketId),
    model:    statedAgentSettingsOf(readyTicketId)?.model ?? DEFAULT_AGENT_MODEL,
    effort:   statedAgentSettingsOf(readyTicketId)?.effort ?? DEFAULT_AGENT_EFFORT,
    ...(board.heldTicketIds.includes(readyTicketId) ? { held: true } : {}),
  }));

  const agentsOnBoard = (): number => board.otherAgentsInFlight + ownAgentsOnBoard.size + rowsLeftRunning.size;

  const noteTheBoard = (): void => {
    mostAgentsOnBoardAtOnce = Math.max(mostAgentsOnBoardAtOnce, agentsOnBoard());
  };

  // As `ticket claim` answers: a running row of the ticket refuses it unless the prompt carries on past a claim bearing its own note, and a full board
  // refuses a new agent. A builder refused as in-progress returns that row's note, as its prompt asks.
  const claimOutcomeFor = (
    ticketId: string,
    prompt: string,
    earlierRow: RunningRow | undefined,
    pausedRow: RunningRow | undefined,
    reply: Record<string, unknown>,
  ): Record<string, unknown> => {
    if (reply['outcome'] === 'claim-refused') return { ...reply, claimNote: earlierRow?.note ?? pausedRow?.note ?? '' };
    // A paused build row refuses the claim too, unless the prompt resumes it and the note is the run's own or, in a run named for the ticket, any run's.
    if (earlierRow === undefined && pausedRow !== undefined) {
      const noteIsOwn = prompt.includes(BUILDER_CARRIES_ON_PAST_ITS_OWN_CLAIM) && pausedRow.note === claimNoteIn(prompt);
      const noteIsAnotherDispatcherRuns = prompt.includes(BUILDER_TAKES_OVER_A_PAUSED_DISPATCHER_BUILD)
        && DispatcherClaimNoteUtil.noteIsADispatcherClaimOn(pausedRow.note, ticketId);
      if (prompt.includes(BUILDER_RESUMES_A_PAUSED_ROW) && (noteIsOwn || noteIsAnotherDispatcherRuns)) return reply;
      return {
        ...reply, outcome: 'claim-refused', detail: `#${ticketId} is in-progress`, claimNote: pausedRow.note,
      };
    }
    if (earlierRow !== undefined) {
      if (prompt.includes(BUILDER_CARRIES_ON_PAST_ITS_OWN_CLAIM) && earlierRow.note === claimNoteIn(prompt)) return reply;
      return {
        ...reply,
        outcome:   'claim-refused',
        detail:    `#${ticketId} is in-progress`,
        claimNote: earlierRow.note,
      };
    }
    if (runningRowOf(`review:${ticketId}`) !== undefined) return { ...reply, outcome: 'claim-refused', detail: `#${ticketId} is under review` };
    if (deliveredTicketIds.has(ticketId)) return { ...reply, outcome: 'claim-refused', detail: `#${ticketId} is delivered` };
    if (board.heldTicketIds.includes(ticketId)) return { ...reply, outcome: 'claim-refused', detail: `#${ticketId} is held` };
    if (agentsOnBoard() >= board.limit) return { ...reply, outcome: 'claim-refused', detail: `no slot free: ${agentsOnBoard()} of ${board.limit} agents in flight` };
    return reply;
  };

  const recordFreedSlotOf = (agentName: string): void => {
    slotGaps.push(agentName);
    if (scenario.elsewhereClaimsAFreedSlot === true && agentsOnBoard() < board.limit) board.otherAgentsInFlight++;
  };

  // A builder's `--start-review` leaves its reviewer's bar running in the same lock hold; a plain `ticket finish` frees the slot for a moment.
  const builderHandsItsSlotOn = (ticketId: string, prompt: string): void => {
    if (prompt.includes(`ticket finish ${ticketId} --start-review`)) {
      rowsLeftRunning.set(`review:${ticketId}`, {
        kind:        'review',
        ticketId,
        note:        '',
        reviewRound: ticketRoundOf(ticketId),
      });
      reviewBarsAdded.push(`review ${ticketId}`);
      return;
    }
    recordFreedSlotOf(`build ${ticketId}`);
  };

  // As `status --json` lists them, the defaults resolved.
  const reviewWaitingTicketsOnBoard = (): Record<string, string>[] => (scenario.reviewWaitingTicketIds ?? []).map((reviewWaitingTicketId) => ({
    id:     reviewWaitingTicketId,
    model:  statedAgentSettingsOf(reviewWaitingTicketId)?.model ?? DEFAULT_AGENT_MODEL,
    effort: statedAgentSettingsOf(reviewWaitingTicketId)?.effort ?? DEFAULT_AGENT_EFFORT,
  }));

  // As `status --json` lists them, the defaults resolved. Every paused build row is an in-progress ticket's own, and its worktree exists unless the
  // scenario removed it, as a parking agent leaves one.
  const pausedBuildsOnBoard = (): Record<string, unknown>[] => [...pausedRows.values()].filter((row) => row.kind === 'build').map((row) => ({
    id:             row.ticketId,
    note:           row.note,
    worktreeExists: !(scenario.pausedBuildIdsWithoutWorktree ?? []).includes(row.ticketId),
    priority:       priorityOf(row.ticketId),
    model:          statedAgentSettingsOf(row.ticketId)?.model ?? DEFAULT_AGENT_MODEL,
    effort:         statedAgentSettingsOf(row.ticketId)?.effort ?? DEFAULT_AGENT_EFFORT,
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
      heldTicketIds:   [...board.heldTicketIds],
    };
    if (scenario.statusOmitsInProgressRows === true) return concurrency;
    return { ...concurrency, inProgressTicketIds: ticketIdsOfInProgressRows('build'), inProgressReviewOfIds: ticketIdsOfInProgressRows('review') };
  };

  const returnedStatusBlock = (run: DispatchRunName): Record<string, unknown> => {
    if (run === 'main') heldTicketIdsReturned.push([...board.heldTicketIds]);
    return statusBlock();
  };

  const replyFor = (call: RecordedAgentCall): Record<string, unknown> | null => {
    if (call.kind === 'survey') {
      return {
        status:                 statusBlock(),
        reviewWaitingTickets:   reviewWaitingTicketsOnBoard(),
        pausedBuilds:           pausedBuildsOnBoard(),
        dirtyMainCheckoutFiles: [...scenario.dirtyMainCheckoutFiles ?? []],
      };
    }
    // As `ticket show --json` states a ticket: its model and effort only where it names them.
    if (call.kind === 'settings') {
      return { tickets: (call.ticketId ?? '').split(',').map((lookedUpTicketId) => ({ id: lookedUpTicketId, ...statedAgentSettingsOf(lookedUpTicketId) })) };
    }
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
    const callGeneration    = generation;
    const builtTicketId     = markerIdentifierIn(prompt, 'ticket');
    const reviewedTicketId  = markerIdentifierIn(prompt, 'review');
    const parkedTicketId    = markerIdentifierIn(prompt, 'park');
    const lookedUpTicketIds = markerIdentifierIn(prompt, 'settings');
    const kind              = kindOf(builtTicketId, reviewedTicketId, parkedTicketId, lookedUpTicketIds);
    const ticketId          = builtTicketId ?? reviewedTicketId ?? parkedTicketId ?? lookedUpTicketIds;
    const passKey           = `${kind}:${ticketId ?? ''}`;
    const ordinal           = kind === 'survey' ? null : (passesByTicket.get(`${run} ${passKey}`) ?? 0) + 1;
    passesByTicket.set(`${run} ${passKey}`, ordinal ?? 0);
    const call: RecordedAgentCall = {
      run,
      kind,
      ticketId,
      ordinal,
      model:                      options['model'],
      effort:                     options['effort'],
      agentType:                  options['agentType'],
      label:                      options['label'],
      phase:                      options['phase'],
      schema:                     options['schema'],
      prompt,
      statusBlocksReturnedBefore: heldTicketIdsReturned.length,
      logsBefore:                 logsOf(run).length,
    };
    calls.push(call);
    if (calls.length > MOST_AGENT_CALLS_PER_RUN) {
      runRanAway = true;
      return null;
    }
    let reply = replyFor(call);
    const misbehaviour = scenario.agentMisbehaviour?.(call);
    if (misbehaviour !== undefined && !('replacesFields' in misbehaviour)) reply = null;
    const documentReturned = (document: Record<string, unknown> | null): Record<string, unknown> | null => {
      if (misbehaviour !== undefined && 'throws' in misbehaviour) throw new Error(misbehaviour.throws);
      if (document === null || misbehaviour === undefined || !('replacesFields' in misbehaviour)) return document;
      return { ...document, ...misbehaviour.replacesFields };
    };
    if (ticketId !== null && ordinal === restartedOrdinalOf(kind) && restartedTicketIdsOf(kind).includes(ticketId)) restartedAttemptActs(kind, ticketId, passKey, prompt);
    liveOwnAgents++;
    mostLiveAgentsAtOnce = Math.max(mostLiveAgentsAtOnce, board.otherAgentsInFlight + liveOwnAgents);
    // A parking agent pauses the ticket's build row, so it is no longer running, and closes its review bar.
    if (kind === 'park' && ticketId !== null) {
      await turnsPass(turnsBeforeFirstCommand);
      if (generation !== callGeneration) return NEVER_SETTLES;
      const ticketRowKey = `build:${ticketId}`;
      const rowToPause = rowsLeftRunning.get(ticketRowKey);
      if (rowToPause !== undefined) {
        rowsLeftRunning.delete(ticketRowKey);
        pausedRows.set(ticketRowKey, rowToPause);
      }
      rowsLeftRunning.delete(`review:${ticketId}`);
      noteTheBoard();
      await turnsPass(TURNS_FROM_FIRST_COMMAND_TO_RETURN);
      if (generation !== callGeneration) return NEVER_SETTLES;
      liveOwnAgents--;
      scenario.afterAgent?.(call, board);
      return documentReturned(reply === null ? null : { ...reply, status: returnedStatusBlock(run) });
    }
    const callIndex = calls.length - 1;
    rowKeysOfOwnAgentsRunning.set(callIndex, passKey);
    mostAgentsAtOnce = Math.max(mostAgentsAtOnce, rowKeysOfOwnAgentsRunning.size);
    mostAgentsInFlightAtOnce = Math.max(mostAgentsInFlightAtOnce, board.otherAgentsInFlight + rowKeysOfOwnAgentsRunning.size + rowsLeftRunningWithoutTakeover());
    if (kind === 'survey' || kind === 'settings' || ticketId === null) {
      await nextTurn();
      if (generation !== callGeneration) return NEVER_SETTLES;
    } else {
      await turnsPass(turnsBeforeFirstCommand);
      if (generation !== callGeneration) return NEVER_SETTLES;
      const earlierRow = runningRowOf(passKey);
      const earlierRowIsRunning = earlierRow !== undefined;
      const pausedRow = pausedRows.get(passKey);
      if (kind === 'build' && reply !== null) reply = claimOutcomeFor(ticketId, prompt, earlierRow, pausedRow, reply);
      const reachesTheBoard = reply?.['outcome'] !== 'claim-refused';
      const rereviewRan = kind === 'review' && reviewerRunsItsRereview(ticketId, prompt, earlierRow);
      // A reviewer finding an earlier attempt's bar adds a second unless its prompt says to take that one.
      const takesTheEarlierRowOver = kind === 'build' || (earlierRowIsRunning && prompt.includes(REVIEWER_TAKES_OVER_A_RUNNING_BAR));
      const barKeepsItsRound = !rereviewRan && takesTheEarlierRowOver && earlierRow !== undefined;
      const ownRow: RunningRow = {
        kind,
        ticketId,
        note:        kind === 'build' ? builderRowNoteAfterFirstCommand(prompt, earlierRow, pausedRow) : '',
        reviewRound: kind === 'build' ? null : (barKeepsItsRound ? earlierRow.reviewRound : ticketRoundOf(ticketId)),
      };
      if (reachesTheBoard) {
        if (takesTheEarlierRowOver) {
          rowsLeftRunning.delete(passKey);
          pausedRows.delete(passKey);
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
      if (kind === 'review' && reply !== null) reviewsWrittenByTicket.set(ticketId, ticketRoundOf(ticketId));
      const rowStaysRunning = reachesTheBoard && rowIsLeftRunning(kind, reply, prompt);
      if (rowStaysRunning) rowsLeftRunning.set(passKey, ownRow);
      if (kind === 'build' && reply?.['outcome'] === 'in-review') builderHandsItsSlotOn(ticketId, prompt);
      if (kind === 'review' && reviewAsksForAnotherRound(reply) && !rowStaysRunning) recordFreedSlotOf(`review ${ticketId}`);
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
    return documentReturned(reply === null ? null : { ...reply, ...('status' in reply ? { status: returnedStatusBlock(run) } : {}) });
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

  const relaunchAgent: FakeAgent = async (prompt, options = {}) => fakeAgent(prompt, options, 'relaunch');

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
    return { ...withPriority, ticketIds, readyTickets: readyTicketsOnBoard().filter((entry) => ticketIds.includes(String(entry['id']))) };
  };

  const scriptBody = compileScript(source);
  const runScript = async (run: DispatchRunName, agentOfThisRun: FakeAgent, runGeneration: number, scriptArguments: Record<string, unknown>): Promise<unknown> => scriptBody(
    agentOfThisRun,
    async (thunks: (() => Promise<unknown>)[]) => Promise.all(thunks.map(async (thunk) => thunk().catch(() => null))),
    () => { throw new Error('The harness offers no pipeline(): the dispatcher runs its own pool.'); },
    (title: unknown) => { if (generation === runGeneration) phasesEntered.push({ run, title }); },
    (message: string) => { if (generation === runGeneration) logsOf(run).push(message); },
    scriptArguments,
    { total: null, spent: () => 0, remaining: () => Number.POSITIVE_INFINITY },
    () => { throw new Error('The harness offers no workflow().'); },
    guardedDate(),
    guardedMath(),
  );
  const mainArguments   = { ...argumentsFor(scenario.ticketIds), ...scenario.argumentOverrides };
  const racingRun       = (async () => {
    if (scenario.racingTicketIds === undefined) return null;
    await turnsPass(scenario.racingRunStartsAfterTurns ?? 0);
    return runScript('racing', racingAgent, 1, argumentsFor(scenario.racingTicketIds));
  })();
  let threw: string | null = null;
  let firstRunOutcome: unknown = null;
  try {
    firstRunOutcome = await Promise.race([runScript('main', journaledAgent, 1, mainArguments), runIsKilled.then(() => KILLED)]);
  } catch (error) {
    threw = thrownTextOf(error);
  }
  const runWasResumed = firstRunOutcome === KILLED;
  let summary: unknown = runWasResumed ? null : firstRunOutcome;
  if (runWasResumed) {
    try {
      summary = await runScript('main', replayingAgent, generation, mainArguments);
    } catch (error) {
      threw = thrownTextOf(error);
    }
  }
  const racingSummary = await racingRun;
  let relaunchSummary: unknown = null;
  if (scenario.relaunchedAfterTheRun === true) {
    board.dispatcherState = 'running';
    relaunchSummary = await runScript('relaunch', relaunchAgent, generation, argumentsFor(undefined));
  }
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
    relaunchSummary,
    relaunchLogs,
    rowsRunningAtEnd: [...rowsLeftRunning.keys()].map(rowNameOf),
    rowsPaused:       [...pausedRows.keys()].map(rowNameOf),
    reviewBarsAdded,
    rereviewsRun,
    logs,
    heldTicketIdsReturned,
    summary,
    runRanAway,
    runWasResumed,
    phasesEntered,
    threw,
  };
}
