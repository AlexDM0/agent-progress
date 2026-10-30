/** The fields of a `BoardState` job (`GET /api/state`, the `job` event) the Agents view reads: the board record and the Overseer's live facts. */
import type { IdentifiedRecord } from '../../@types/BoardStateDocument.ts';

export interface LastToolCallDocument {
  readonly toolName:  string;
  /** `null` for a call logged before stamps, which shows no elapsed time. */
  readonly startedAt: string | null;
  readonly running:   boolean;
}

export interface SubagentDocument {
  readonly parentToolUseId: string;
  readonly toolCalls:       number;
  readonly lastToolCall:    LastToolCallDocument | null;
  readonly tokens:          number;
}

export interface JobLiveFactsDocument {
  readonly calls:                  number;
  readonly callBudget:             number | null;
  readonly tokens:                 number;
  readonly toolCalls:              number;
  readonly lastToolCall:           LastToolCallDocument | null;
  readonly subagents:              readonly SubagentDocument[];
  readonly toolCallsWithSubagents: number;
  readonly silentSweeps:           number;
  readonly watcherProtocol:        number | null;
  readonly watchOnly:              boolean;
}

export interface AgentJobDocument extends IdentifiedRecord {
  readonly kind:            string;
  readonly role:            string | null;
  readonly ticketIds:       readonly string[];
  readonly state:           string;
  readonly attempt:         number;
  readonly watcherInstance: number;
  readonly crashResumes:    number;
  readonly slot?:           { readonly phase: string };
  readonly stopRequest?:    string;
  readonly live:            JobLiveFactsDocument;
}

export interface JobDecisionDocument extends IdentifiedRecord {
  readonly jobId: string | null;
}
