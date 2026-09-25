/** What the `SubagentStop` hook reads out of a finished agent's transcript for the board: the rows and tickets its brief names, and the log line. */
import { TicketIdUtil }               from '../../../lib/utils/TicketIdUtil';
import type { TranscriptUsageTotals } from '../../../src/lib/claude-code/utils/TranscriptUsageUtil';
import { TranscriptUsageUtil }        from '../../../src/lib/claude-code/utils/TranscriptUsageUtil';
import { TokenCountUtil }             from '../../../src/lib/utils/TokenCountUtil';

/** A line of its own, ids as digits separated by commas: a placeholder such as `<rowId>` in a brief template never matches. */
const ROW_MARKER_PATTERN = /^[ \t]*agent-progress row:[ \t]*(\d+(?:[ \t]*,[ \t]*\d+)*)[ \t]*$/m;

/** The same shape naming tickets, each id padded or not and with an optional `#`, as `ticket show` accepts them. */
const TICKET_MARKER_PATTERN = /^[ \t]*agent-progress ticket:[ \t]*(#?\d+(?:[ \t]*,[ \t]*#?\d+)*)[ \t]*$/m;

/** One ticket only: a reviewer's brief is written before its review row exists, and names the ticket whose newest review row it will be. */
const REVIEW_MARKER_PATTERN = /^[ \t]*agent-progress review:[ \t]*(#?\d+)[ \t]*$/m;

/**
 * The rows named by the `agent-progress row: 4, 7` line of the agent's brief, in the order written and each once; empty when the
 * brief has no such line. Only the brief is read, so a later message quoting another agent's marker never counts.
 */
function rowIdentifiersNamedInBrief(transcriptText: string): number[] {
  const identifiers = identifiersListedInBrief(transcriptText, ROW_MARKER_PATTERN).map((identifier) => Number.parseInt(identifier, 10));
  return [...new Set(identifiers)];
}

/** The padded ids (`"022"`) named by the brief's `agent-progress ticket: 22, 20` line, read exactly as the row line is; an id of zero is dropped. */
function ticketIdentifiersNamedInBrief(transcriptText: string): string[] {
  const identifiers = identifiersListedInBrief(transcriptText, TICKET_MARKER_PATTERN)
    .map((identifier) => TicketIdUtil.parseTicketReference(identifier))
    .filter((identifier): identifier is string => identifier !== null);
  return [...new Set(identifiers)];
}

/** The padded id (`"007"`) named by the brief's `agent-progress review: 7` line, read exactly as the other two are; `null` when there is none. */
function reviewedTicketIdentifierNamedInBrief(transcriptText: string): string | null {
  const [identifier] = identifiersListedInBrief(transcriptText, REVIEW_MARKER_PATTERN);
  return identifier === undefined ? null : TicketIdUtil.parseTicketReference(identifier);
}

function identifiersListedInBrief(transcriptText: string, markerPattern: RegExp): string[] {
  const identifierList = markerPattern.exec(TranscriptUsageUtil.briefTextOf(transcriptText))?.[1];
  if (identifierList === undefined) return [];
  return identifierList.split(',').map((identifier) => identifier.trim());
}

/** Floor division over the shares, with the remainder on the first, so the shares always sum to the total. */
function evenSharesOf(totalTokens: number, shareCount: number): number[] {
  if (shareCount <= 0) return [];
  const evenShare = Math.floor(totalTokens / shareCount);
  const remainder = totalTokens - evenShare * shareCount;
  const shares    = new Array<number>(shareCount).fill(evenShare);
  shares[0]       = evenShare + remainder;
  return shares;
}

/**
 * The log line a stopped subagent leaves behind, formatted through `src/lib/utils/TokenCountUtil.ts` so
 * the log and the chart's token column read in the same units. The input figure is the whole of what
 * was sent — fresh input plus both cache figures — with the cache-read share named separately,
 * because that share is the number that explains a long session and is invisible in a plain total.
 */
function composeUsageLine(agentIdentifier: string, agentType: string, totals: TranscriptUsageTotals): string {
  const { formatTokenCount } = TokenCountUtil;
  const totalInputTokens = TranscriptUsageUtil.totalInputTokensOf(totals);
  return `Agent ${agentIdentifier} (${agentType}) stopped: ${totals.apiCallCount} calls, `
    + `end context ${formatTokenCount(totals.endContextTokens)}, `
    + `input ${formatTokenCount(totalInputTokens)} (cache read ${formatTokenCount(totals.cacheReadInputTokens)}), `
    + `output ${formatTokenCount(totals.outputTokens)}`;
}

export const SubagentStopUtil = {
  composeUsageLine,
  evenSharesOf,
  reviewedTicketIdentifierNamedInBrief,
  rowIdentifiersNamedInBrief,
  ticketIdentifiersNamedInBrief,
} as const;
