export interface AgentQuestion {
  readonly question:    string;
  readonly header:      string;
  readonly multiSelect: boolean;
  readonly options:     readonly { readonly label: string; readonly description: string }[];
}

export interface AgentTurnUsage {
  readonly inputTokens:              number;
  readonly outputTokens:             number;
  readonly cacheCreationInputTokens: number;
  readonly cacheReadInputTokens:     number;
}

/** The session's totals so far, per model, subagents included where the vendor counts them. */
export interface AgentUsageTotals {
  readonly byModel: Readonly<Record<string, AgentTurnUsage>>;
}

export type AgentSessionEvent =
  | { readonly kind: 'started'; readonly sessionId: string; readonly vendorVersion: string; readonly model: string; readonly tools: readonly string[] }
  | {
    readonly kind:            'assistant-turn';
    readonly messageId:       string;
    readonly parentToolUseId: string | null;
    readonly model:           string;
    readonly usage:           AgentTurnUsage | null;
    /** The turn's text blocks, joined; empty for a turn of tool calls alone. */
    readonly text:            string;
  }
  | {
    readonly kind:            'tool-call';
    readonly toolUseId:       string;
    readonly toolName:        string;
    readonly inputSummary:    string;
    readonly parentToolUseId: string | null;
  }
  /** The answer to the tool call `toolUseId` names, so a reader knows that call is no longer running. */
  | { readonly kind: 'tool-result'; readonly toolUseId: string; readonly parentToolUseId: string | null; readonly isError: boolean }
  | { readonly kind: 'question'; readonly requestId: string; readonly questions: readonly AgentQuestion[] }
  | { readonly kind: 'permission-denied'; readonly toolName: string }
  | {
    readonly kind:            'usage-window';
    readonly window:          string;
    readonly utilization:     number;
    readonly resetsAt:        string;
    readonly status:          string;
    readonly requestsRefused: boolean;
  }
  | {
    readonly kind:             'result';
    readonly isError:          boolean;
    readonly structuredReport: unknown;
    readonly usageTotals:      AgentUsageTotals | null;
    readonly contextTokens:    number | null;
  };
