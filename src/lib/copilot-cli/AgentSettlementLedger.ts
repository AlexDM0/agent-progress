/** What a Copilot session's events said about each of its agents, kept until the agent settles and handed over exactly once when it does. */
export interface AgentUsageTotals {
  inputTokens:      number;
  outputTokens:     number;
  cacheReadTokens:  number;
  cacheWriteTokens: number;
}

export type AgentOutcome = 'completed' | 'failed';

export interface SettledAgent {
  agentId: string;
  label:   string;
  prompt:  string;
  outcome: AgentOutcome;
  usage:   AgentUsageTotals;
}

interface AgentReadings {
  label:  string | null;
  prompt: string | null;
  usage:  AgentUsageTotals;
}

function zeroUsage(): AgentUsageTotals {
  return {
    inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0
  };
}

export class AgentSettlementLedger {
  readonly #readingsByAgentId = new Map<string, AgentReadings>();
  readonly #settledAgentIds = new Set<string>();

  recordStart(agentId: string, label: string): void {
    this.#readingsOf(agentId).label = label;
  }

  /** The first prompt an agent is given is its brief; a later message to it is not. */
  recordPrompt(agentId: string, prompt: string): void {
    const readings = this.#readingsOf(agentId);
    readings.prompt ??= prompt;
  }

  addUsage(agentId: string, usage: AgentUsageTotals): void {
    const totals = this.#readingsOf(agentId).usage;
    totals.inputTokens += usage.inputTokens;
    totals.outputTokens += usage.outputTokens;
    totals.cacheReadTokens += usage.cacheReadTokens;
    totals.cacheWriteTokens += usage.cacheWriteTokens;
  }

  /** `null` for an agent that already settled, so a repeated settle event is handed over once. */
  settle(agentId: string, outcome: AgentOutcome, labelOnTheSettleEvent: string): SettledAgent | null {
    if (this.#settledAgentIds.has(agentId)) return null;
    this.#settledAgentIds.add(agentId);
    const readings = this.#readingsOf(agentId);
    this.#readingsByAgentId.delete(agentId);
    return {
      agentId, label: readings.label ?? labelOnTheSettleEvent, prompt: readings.prompt ?? '', outcome, usage: { ...readings.usage }
    };
  }

  #readingsOf(agentId: string): AgentReadings {
    const known = this.#readingsByAgentId.get(agentId);
    if (known !== undefined) return known;
    const readings: AgentReadings = { label: null, prompt: null, usage: zeroUsage() };
    this.#readingsByAgentId.set(agentId, readings);
    return readings;
  }
}
