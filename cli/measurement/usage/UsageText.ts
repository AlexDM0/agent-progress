/** What `usage` prints for a person: one row per agent, then one line per cohort. */
import type { CohortSummary } from '../../../src/lib/claude-code/utils/TranscriptCohortUtil.ts';
import { LocalTimeUtil }      from '../../../src/lib/local-time/LocalTimeUtil.ts';
import { TokenCountUtil }     from '../../../src/lib/token-count/TokenCountUtil.ts';
import { LIMITS }             from '../../../src/shared/constants/Limits.ts';
import { OutputUtil }         from '../../utils/OutputUtil.ts';
import type { AgentUsage }    from './UsageAgents.ts';

const MEAN_CALL_COUNT_DECIMALS = 1;

const PERCENT_OF_A_WHOLE = 100;

/** Each width holds the wider of its header and its figures; the end-context column is the broad one because its header is, not its numbers. */
const AGENT_COLUMN_WIDTHS_CHARACTERS = {
  startedAt:        14,
  calls:            7,
  endContext:       12,
  input:            9,
  output:           8,
  browser:          9,
  oversizedContext: 11,
  bashEdits:        11,
  checks:           8,
  nested:           9,
};

/** The table carries the share and not the raw count: agents are compared on how much of their own input was sent at an oversized context. */
function oversizedContextPercentOf(agent: AgentUsage): string {
  if (agent.totalInputTokens === 0) return '0%';
  return `${Math.round((agent.oversizedContextTokens / agent.totalInputTokens) * PERCENT_OF_A_WHOLE)}%`;
}

/**
 * The stamp is re-rendered in local time and then sliced, the way `cli/tracking/status/StatusText.ts`
 * slices its log stamps: a transcript records UTC, and a reader in another zone must never be shown a
 * clock reading nobody was at.
 */
function localStampOf(startedAt: string | null): string {
  if (startedAt === null) return '-';
  const instant = LocalTimeUtil.parseIso(startedAt);
  if (instant === null) return '-';
  return LocalTimeUtil.formatLocalIso(instant).slice(LIMITS.MONTH_AND_DAY_SLICE_START_CHARACTER_OFFSET, LIMITS.CLOCK_SLICE_END_CHARACTER_OFFSET).replace('T', ' ');
}

export function agentRowLinesOf(agents: readonly AgentUsage[]): string[] {
  const oversizedThresholdText = TokenCountUtil.formatTokenCount(LIMITS.OVERSIZED_CONTEXT_THRESHOLD_TOKENS);
  const lines = [[
    OutputUtil.padColumn('started', AGENT_COLUMN_WIDTHS_CHARACTERS.startedAt),
    OutputUtil.padColumn('calls', AGENT_COLUMN_WIDTHS_CHARACTERS.calls),
    OutputUtil.padColumn('end context', AGENT_COLUMN_WIDTHS_CHARACTERS.endContext),
    OutputUtil.padColumn('input', AGENT_COLUMN_WIDTHS_CHARACTERS.input),
    OutputUtil.padColumn('output', AGENT_COLUMN_WIDTHS_CHARACTERS.output),
    OutputUtil.padColumn('browser', AGENT_COLUMN_WIDTHS_CHARACTERS.browser),
    OutputUtil.padColumn(`over ${oversizedThresholdText}`, AGENT_COLUMN_WIDTHS_CHARACTERS.oversizedContext),
    OutputUtil.padColumn('bash edits', AGENT_COLUMN_WIDTHS_CHARACTERS.bashEdits),
    OutputUtil.padColumn('checks', AGENT_COLUMN_WIDTHS_CHARACTERS.checks),
    OutputUtil.padColumn('nested', AGENT_COLUMN_WIDTHS_CHARACTERS.nested),
    'brief',
  ].join('')];

  for (const agent of agents) {
    lines.push([
      OutputUtil.padColumn(localStampOf(agent.startedAt), AGENT_COLUMN_WIDTHS_CHARACTERS.startedAt),
      OutputUtil.padColumn(String(agent.apiCallCount), AGENT_COLUMN_WIDTHS_CHARACTERS.calls),
      OutputUtil.padColumn(TokenCountUtil.formatTokenCount(agent.endContextTokens), AGENT_COLUMN_WIDTHS_CHARACTERS.endContext),
      OutputUtil.padColumn(TokenCountUtil.formatTokenCount(agent.totalInputTokens), AGENT_COLUMN_WIDTHS_CHARACTERS.input),
      OutputUtil.padColumn(TokenCountUtil.formatTokenCount(agent.outputTokens), AGENT_COLUMN_WIDTHS_CHARACTERS.output),
      OutputUtil.padColumn(String(agent.browserCallCount), AGENT_COLUMN_WIDTHS_CHARACTERS.browser),
      OutputUtil.padColumn(oversizedContextPercentOf(agent), AGENT_COLUMN_WIDTHS_CHARACTERS.oversizedContext),
      OutputUtil.padColumn(String(agent.bashEditScriptCount), AGENT_COLUMN_WIDTHS_CHARACTERS.bashEdits),
      OutputUtil.padColumn(String(agent.verificationRunCount), AGENT_COLUMN_WIDTHS_CHARACTERS.checks),
      OutputUtil.padColumn(TokenCountUtil.formatTokenCount(agent.nestedInstructionCharacters), AGENT_COLUMN_WIDTHS_CHARACTERS.nested),
      agent.briefExcerpt,
    ].join(''));
  }
  return lines;
}

/** The character counts are formatted through the token formatter on purpose: the report is read as one column of magnitudes, not as two units. */
export function cohortLineOf(label: string, summary: CohortSummary): string {
  if (summary.transcriptCount === 0) return `${label}: no agents.`;

  const oversizedThresholdText = TokenCountUtil.formatTokenCount(LIMITS.OVERSIZED_CONTEXT_THRESHOLD_TOKENS);
  const agentWord              = summary.transcriptCount === 1 ? 'agent' : 'agents';
  return `${label}: ${summary.transcriptCount} ${agentWord}, median ${summary.medianApiCallCount} calls, `
    + `median end context ${TokenCountUtil.formatTokenCount(summary.medianEndContextTokens)}, `
    + `mean input ${TokenCountUtil.formatTokenCount(summary.meanTotalInputTokens)}, `
    + `mean output ${TokenCountUtil.formatTokenCount(summary.meanOutputTokens)}, `
    + `mean ${summary.meanBrowserCallCount.toFixed(MEAN_CALL_COUNT_DECIMALS)} browser calls, `
    + `mean ${Math.round(summary.meanOversizedContextShare * PERCENT_OF_A_WHOLE)}% over ${oversizedThresholdText} context, `
    + `mean ${summary.meanBashEditScriptCount.toFixed(MEAN_CALL_COUNT_DECIMALS)} bash edit scripts, `
    + `mean ${summary.meanVerificationRunCount.toFixed(MEAN_CALL_COUNT_DECIMALS)} verification runs, `
    + `mean ${TokenCountUtil.formatTokenCount(summary.meanNestedInstructionCharacters)} nested characters`;
}
