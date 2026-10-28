/**
 * What a session's tokens credit, design section 4.5, as pure functions: turns are keyed by message id, so the live stream and a transcript
 * replay of the same session count each API call once, and a subagent's turns are grouped under the tool call that started it.
 */
import type { AgentTurnUsage }        from '../../lib/agent-launch/AgentSessionEvent.ts';
import type { AgentUsage, LogRecord } from '../../lib/tracker-model/@types/LogRecord.ts';

/** One assistant turn as the live stream or a transcript replay reports it. */
export interface CreditedTurn {
  readonly messageId:       string;
  readonly parentToolUseId: string | null;
  readonly usage:           AgentTurnUsage | null;
}

export interface TokenTotals {
  calls:                    number;
  inputTokens:              number;
  outputTokens:             number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens:     number;
}

export interface SessionTokens {
  /** The session's own turns, `parentToolUseId` null: the calls a role's budget counts. */
  topLevel:  TokenTotals;
  /** Each subagent's turns, keyed by the tool call that started it. */
  subagents: Record<string, TokenTotals>;
  total:     TokenTotals;
}

function emptyTotals(): TokenTotals {
  return {
    calls: 0, inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0
  };
}

function addTurn(totals: TokenTotals, usage: AgentTurnUsage | null, outputTokens: number): void {
  totals.calls += 1;
  totals.inputTokens += usage?.inputTokens ?? 0;
  totals.cacheCreationInputTokens += usage?.cacheCreationInputTokens ?? 0;
  totals.cacheReadInputTokens += usage?.cacheReadInputTokens ?? 0;
  totals.outputTokens += outputTokens;
}

/**
 * One API call spans several lines that repeat its input, so a message id's input counts once, from the first turn seen with it, and its
 * output is the largest any of them reports, as `TranscriptUsageUtil` sums a transcript.
 */
function sessionTokensOf(turns: readonly CreditedTurn[]): SessionTokens {
  const firstTurnByMessageId = new Map<string, CreditedTurn>();
  const largestOutputByMessageId = new Map<string, number>();
  for (const turn of turns) {
    if (!firstTurnByMessageId.has(turn.messageId)) firstTurnByMessageId.set(turn.messageId, turn);
    largestOutputByMessageId.set(turn.messageId, Math.max(largestOutputByMessageId.get(turn.messageId) ?? 0, turn.usage?.outputTokens ?? 0));
  }
  const sessionTokens: SessionTokens = { topLevel: emptyTotals(), subagents: {}, total: emptyTotals() };
  for (const [messageId, turn] of firstTurnByMessageId) {
    const outputTokens = largestOutputByMessageId.get(messageId) ?? 0;
    const { parentToolUseId } = turn;
    let group = sessionTokens.topLevel;
    if (parentToolUseId !== null) {
      if (!Object.hasOwn(sessionTokens.subagents, parentToolUseId)) sessionTokens.subagents[parentToolUseId] = emptyTotals();
      group = sessionTokens.subagents[parentToolUseId] ?? group;
    }
    addTurn(group, turn.usage, outputTokens);
    addTurn(sessionTokens.total, turn.usage, outputTokens);
  }
  return sessionTokens;
}

/**
 * A resumed session's total holds every earlier stop's, so an agent id already logged is credited only what its total grew by since its
 * largest logged stop; a replayed stop therefore credits nothing twice.
 */
function tokensStillToCreditOf(usage: Pick<AgentUsage, 'agentId' | 'totalInputTokens'>, storedLogRecords: readonly LogRecord[]): number {
  const alreadyCreditedTokens = storedLogRecords.reduce(
    (largest, record) => (record.kind === 'agent-stopped' && record.fields.agentId === usage.agentId ? Math.max(largest, record.fields.totalInputTokens) : largest),
    0,
  );
  return Math.max(0, usage.totalInputTokens - alreadyCreditedTokens);
}

export const TokenCrediting = Object.freeze({ sessionTokensOf, tokensStillToCreditOf });
