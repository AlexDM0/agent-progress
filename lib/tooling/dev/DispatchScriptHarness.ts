/**
 * Runs `templates/workflows/AgentProgressDispatch.js` as the Workflow tool would, against a fake `agent()` and a fake board, so a spec can pin
 * the script's decisions without spawning a model. An agent's kind is read from its prompt's token marker, the way the hook reads it. A builder
 * or reviewer is on the board only from its first command until it finishes, as a real one is from its claim or its `task add --start`.
 */
import { readFileSync } from 'node:fs';
import { join }         from 'node:path';

export type AgentKind = 'survey' | 'build' | 'review';

export interface ReviewFinding {
  class:   string;
  file:    string;
  summary: string;
}

export interface BuilderReply {
  outcome: 'in-review' | 'claim-refused' | 'failed';
  detail?: string;
}

export interface ReviewerReply {
  verdict:         'released' | 'round-requested' | 'does-not-hold' | 'not-released';
  releaseReason?:  string;
  reworkedLines?:  number;
  findings?:       ReviewFinding[];
  filedTicketIds?: string[];
}

export type DispatcherStateOnBoard = 'running' | 'stopped' | 'finished';

export interface FakeBoard {
  limit:               number;
  otherAgentsInFlight: number;
  readyTicketIds:      string[];
  dispatcherState:     DispatcherStateOnBoard;
}

export interface RecordedAgentCall {
  kind:     AgentKind;
  ticketId: string | null;
  /** The builder's pass or the reviewer's round for this ticket, counted by the harness from 1; `null` for the survey. */
  ordinal:  number | null;
  model:    unknown;
  label:    unknown;
  prompt:   string;
}

export interface DispatchScenario {
  limit:                    number;
  readyTicketIds:           string[];
  otherAgentsInFlight?:     number;
  reviewWaitingTicketIds?:  string[];
  /** Defaults to `running`; `afterAgent` may change it mid-run. */
  dispatcherState?:         DispatcherStateOnBoard;
  /** Defaults to `in-review`; `null` is an agent that died. */
  builderReply?:            (ticketId: string, pass: number) => BuilderReply | null;
  /** Defaults to `released`; `null` is an agent that died. */
  reviewerReply?:           (ticketId: string, round: number) => ReviewerReply | null;
  /** Runs as an agent finishes and before its status block is taken, so a scenario can file a ticket mid-run. */
  afterAgent?:              (call: RecordedAgentCall, board: FakeBoard) => void;
  /** How many turns a builder or reviewer runs before its first command puts it on the board; defaults to `DEFAULT_TURNS_BEFORE_FIRST_COMMAND`. */
  turnsBeforeFirstCommand?: number;
  /** Every status block leaves out `runningTicketIds` and `runningReviewOfIds`, as an agent that did not derive them would. */
  statusOmitsRunningRows?:  boolean;
}

export interface DispatchRun {
  calls:                    RecordedAgentCall[];
  /** The most of the script's own agents that were running at one moment. */
  mostAgentsAtOnce:         number;
  /** The most agents in flight at one moment: the board's others plus every one of the script's own, on the board yet or not. */
  mostAgentsInFlightAtOnce: number;
  logs:                     string[];
  summary:                  unknown;
  /** Whether the script passed `MOST_AGENT_CALLS_PER_RUN`, after which every agent answered `null` so the run could end. */
  ranAway:                  boolean;
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

async function nextTurn(): Promise<void> {
  await new Promise((resolve) => { setImmediate(resolve); });
}

async function turnsPass(count: number): Promise<void> {
  for (let i = 0; i < count; i++) await nextTurn();
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
    limit:               scenario.limit,
    otherAgentsInFlight: scenario.otherAgentsInFlight ?? 0,
    readyTicketIds:      [...scenario.readyTicketIds],
    dispatcherState:     scenario.dispatcherState ?? 'running',
  };
  const calls: RecordedAgentCall[] = [];
  const logs: string[] = [];
  const passesByTicket = new Map<string, number>();
  const ownAgentsOnBoard = new Map<number, { kind: AgentKind; ticketId: string }>();
  const turnsBeforeFirstCommand = scenario.turnsBeforeFirstCommand ?? DEFAULT_TURNS_BEFORE_FIRST_COMMAND;
  let running = 0;
  let mostAgentsAtOnce = 0;
  let mostAgentsInFlightAtOnce = 0;
  let ranAway = false;

  const ticketIdsOfOwnAgentsOnBoard = (kind: AgentKind): string[] => [...ownAgentsOnBoard.values()]
    .filter((agentOnBoard) => agentOnBoard.kind === kind)
    .map((agentOnBoard) => agentOnBoard.ticketId);

  const statusBlock = (): Record<string, unknown> => {
    const agentsInFlight = board.otherAgentsInFlight + ownAgentsOnBoard.size;
    const concurrency = {
      limit:           board.limit,
      agentsInFlight,
      freeSlots:       Math.max(0, board.limit - agentsInFlight),
      readyTicketIds:  [...board.readyTicketIds],
      dispatcherState: board.dispatcherState,
    };
    if (scenario.statusOmitsRunningRows === true) return concurrency;
    return { ...concurrency, runningTicketIds: ticketIdsOfOwnAgentsOnBoard('build'), runningReviewOfIds: ticketIdsOfOwnAgentsOnBoard('review') };
  };

  const replyFor = (call: RecordedAgentCall): Record<string, unknown> | null => {
    if (call.kind === 'survey') return { status: statusBlock(), reviewWaitingTicketIds: scenario.reviewWaitingTicketIds ?? [] };
    const ticketId = call.ticketId ?? '';
    const ordinal  = call.ordinal ?? 1;
    if (call.kind === 'build') {
      const reply = scenario.builderReply === undefined ? { outcome: 'in-review' as const } : scenario.builderReply(ticketId, ordinal);
      return reply === null ? null : { outcome: reply.outcome, detail: reply.detail ?? '', status: statusBlock() };
    }
    const reply = scenario.reviewerReply === undefined ? { verdict: 'released' as const } : scenario.reviewerReply(ticketId, ordinal);
    return reply === null ? null : { ...reviewerDocumentOf(reply, ordinal), status: statusBlock() };
  };

  const fakeAgent = async (prompt: string, options: Record<string, unknown> = {}): Promise<unknown> => {
    const builtTicketId    = markerIdentifierIn(prompt, 'ticket');
    const reviewedTicketId = markerIdentifierIn(prompt, 'review');
    const kind: AgentKind  = builtTicketId !== null ? 'build' : reviewedTicketId !== null ? 'review' : 'survey';
    const ticketId         = builtTicketId ?? reviewedTicketId;
    const passKey          = `${kind}:${ticketId ?? ''}`;
    const ordinal          = kind === 'survey' ? null : (passesByTicket.get(passKey) ?? 0) + 1;
    passesByTicket.set(passKey, ordinal ?? 0);
    const call: RecordedAgentCall = {
      kind,
      ticketId,
      ordinal,
      model: options['model'],
      label: options['label'],
      prompt,
    };
    calls.push(call);
    if (calls.length > MOST_AGENT_CALLS_PER_RUN) {
      ranAway = true;
      return null;
    }
    const reply = replyFor(call);
    if (kind === 'build' && ticketId !== null && reply?.['outcome'] !== 'claim-refused') {
      board.readyTicketIds = board.readyTicketIds.filter((readyTicketId) => readyTicketId !== ticketId);
    }
    running++;
    mostAgentsAtOnce = Math.max(mostAgentsAtOnce, running);
    mostAgentsInFlightAtOnce = Math.max(mostAgentsInFlightAtOnce, board.otherAgentsInFlight + running);
    if (kind === 'survey' || ticketId === null) {
      await nextTurn();
    } else {
      const callIndex = calls.length - 1;
      await turnsPass(turnsBeforeFirstCommand);
      if (reply?.['outcome'] !== 'claim-refused') ownAgentsOnBoard.set(callIndex, { kind, ticketId });
      await turnsPass(TURNS_FROM_FIRST_COMMAND_TO_RETURN);
      ownAgentsOnBoard.delete(callIndex);
    }
    running--;
    scenario.afterAgent?.(call, board);
    return reply === null ? null : { ...reply, ...('status' in reply ? { status: statusBlock() } : {}) };
  };

  const scriptBody = compileScript(source);
  const summary = await scriptBody(
    fakeAgent,
    async (thunks: (() => Promise<unknown>)[]) => Promise.all(thunks.map(async (thunk) => thunk().catch(() => null))),
    () => { throw new Error('The harness offers no pipeline(): the dispatcher runs its own pool.'); },
    () => {},
    (message: string) => { logs.push(message); },
    ARGUMENTS_FOR_SCRIPT,
    { total: null, spent: () => 0, remaining: () => Number.POSITIVE_INFINITY },
    () => { throw new Error('The harness offers no workflow().'); },
    guardedDate(),
    guardedMath(),
  );
  return {
    calls,
    mostAgentsAtOnce,
    mostAgentsInFlightAtOnce,
    logs,
    summary,
    ranAway,
  };
}
