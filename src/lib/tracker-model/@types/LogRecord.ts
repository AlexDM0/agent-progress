/**
 * What the Board tells the log, as ids and values with no wording; the caller words it. The union is the log's vocabulary: a new kind is
 * a member here plus its wording in `src/adapters/utils/LogUtil.ts` and its stored check, each an exhaustive switch or record the compiler holds.
 */
import type { AgentPair, TicketPriority }  from './Ticket.ts';
import type { DispatcherState, ViewRange } from './TrackerProgress.ts';

export interface AgentUsage {
  agentId:              string;
  agentType:            string;
  apiCallCount:         number;
  endContextTokens:     number;
  /** Fresh input plus cache read plus cache creation. */
  totalInputTokens:     number;
  cacheReadInputTokens: number;
  outputTokens:         number;
  /** Only for an agent a workflow run spawned: the run's id and the label the run gave it, each stored only when known. */
  workflowRunId?:       string;
  agentLabel?:          string;
}

export type LogRecordContent =
  | { kind: 'note'; fields: { text: string } }
  | { kind: 'ticket-filed'; ticketId: string; fields: { title: string } }
  | { kind: 'ticket-reopened' | 'ticket-started' | 'ticket-finished' | 'ticket-approved' | 'ticket-delivered'; ticketId: string; fields: Record<string, never> }
  | { kind: 'ticket-abandoned'; ticketId: string; fields: { reason: string } }
  | { kind: 'ticket-rereviewed'; ticketId: string; fields: { round: number } }
  | { kind: 'ticket-priority-changed'; ticketId: string; fields: { from: TicketPriority; to: TicketPriority } }
  | { kind: 'ticket-dependencies-set'; ticketId: string; fields: { dependsOn: readonly string[] } }
  | { kind: 'ticket-agents-changed'; ticketId: string; fields: { from: AgentPair; to: AgentPair } }
  | { kind: 'ticket-held'; ticketId: string; fields: { reason: string } }
  | { kind: 'ticket-unheld'; ticketId: string; fields: Record<string, never> }
  | { kind: 'ticket-release-marked'; ticketId: string; fields: { group: string } }
  | { kind: 'ticket-release-cleared'; ticketId: string; fields: Record<string, never> }
  | { kind: 'ticket-epics-set'; ticketId: string; fields: { epics: readonly string[] } }
  | { kind: 'epic-added' | 'epic-edited'; epicKey: string; fields: { title: string } }
  | { kind: 'epic-removed'; epicKey: string; fields: Record<string, never> }
  /** A review bar's `name` is carried because the sentence prints the row's stored name, which an edit may have made anything. */
  | { kind: 'review-bar-started' | 'review-bar-closed'; taskId: number; ticketId: string; fields: { name: string } }
  | { kind: 'chart-range-set'; fields: { view: ViewRange } }
  | { kind: 'concurrency-limit-set'; fields: { limit: number } }
  | { kind: 'dispatcher-set'; fields: { state: DispatcherState; runId: string | null } }
  | { kind: 'tracker-cleared'; fields: Record<string, never> }
  | { kind: 'agent-stopped'; fields: AgentUsage };

export type LogRecord = LogRecordContent & { at: string };
