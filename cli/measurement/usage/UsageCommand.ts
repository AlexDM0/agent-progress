/**
 * What every subagent of this repository cost, read from the harness's transcripts; `cli/measurement/hook/HookCommand.ts` records one agent as it
 * stops, this compares them all. Read-only, and finding no transcripts is one sentence at exit 0, not a refusal.
 */
import type { SubagentTranscript }                                        from '../../../src/lib/claude-code/ClaudeTranscripts.ts';
import { listSubagentTranscripts, transcriptFolderFor, transcriptTextAt } from '../../../src/lib/claude-code/ClaudeTranscripts.ts';
import type { CohortSummary }                                             from '../../../src/lib/claude-code/utils/TranscriptCohortUtil.ts';
import { TranscriptCohortUtil }                                           from '../../../src/lib/claude-code/utils/TranscriptCohortUtil.ts';
import type { TranscriptProfile }                                         from '../../../src/lib/claude-code/utils/TranscriptUsageUtil.ts';
import { TranscriptUsageUtil }                                            from '../../../src/lib/claude-code/utils/TranscriptUsageUtil.ts';
import { TimeUtil }                                                       from '../../../src/lib/utils/TimeUtil.ts';
import { TokenCountUtil }                                                 from '../../../src/lib/utils/TokenCountUtil.ts';
import { requireWorkspace }                                               from '../../../src/services/tracker/Workspace.ts';
import { OperationRefusal }                                               from '../../../src/shared/OperationRefusal.ts';
import { LIMITS }                                                         from '../../../src/shared/constants/Limits.ts';
import type { CommandContext }                                            from '../../CommandContext.ts';
import type { CommandHandler }                                            from '../../CommandHandler.ts';
import type { ArgumentParser }                                            from '../../arguments/ArgumentParser.ts';
import { OutputUtil }                                                     from '../../utils/OutputUtil.ts';

const USAGE = 'agent-progress usage [--since <when>] [--transcripts <folder>] [--json]';

const KNOWN_OPTION_NAMES = ['since', 'transcripts', 'json'];

const MEAN_CALL_COUNT_DECIMALS = 1;

/** Long enough to tell two briefs apart on one terminal row and short enough that the row still fits beside the figures. */
const BRIEF_EXCERPT_CHARACTERS = 80;

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

/** One agent as the report prints it and as `--json` carries it: the profile, flattened, with the figures a reader adds up by hand made explicit. */
interface AgentUsage extends TranscriptProfile {
  sessionIdentifier: string;
  agentIdentifier:   string;
  transcriptPath:    string;
  totalInputTokens:  number;
}

/** `before` and `after` are absent rather than empty without `--since`, so a reader of the document can tell "not asked for" from "nothing fell there". */
interface UsageCohorts {
  all:     CohortSummary;
  before?: CohortSummary;
  after?:  CohortSummary;
}

/** The table carries the share and not the raw count: agents are compared on how much of their own input was sent at an oversized context. */
function oversizedContextPercentOf(agent: AgentUsage): string {
  if (agent.totalInputTokens === 0) return '0%';
  return `${Math.round((agent.oversizedContextTokens / agent.totalInputTokens) * PERCENT_OF_A_WHOLE)}%`;
}

function agentUsageFor(transcript: SubagentTranscript, transcriptText: string): AgentUsage {
  const profile = TranscriptUsageUtil.transcriptProfileOf(transcriptText, LIMITS.OVERSIZED_CONTEXT_THRESHOLD_TOKENS, BRIEF_EXCERPT_CHARACTERS);
  return {
    ...profile,
    sessionIdentifier: transcript.sessionIdentifier,
    agentIdentifier:   transcript.agentIdentifier,
    transcriptPath:    transcript.path,
    totalInputTokens:  profile.inputTokens + profile.cacheReadInputTokens + profile.cacheCreationInputTokens,
  };
}

/**
 * Oldest first, which is the order the report is read in: a cohort is a story about what changed over
 * time. An agent with no stamp sorts to the front, beside the split's own closed answer for it.
 */
function oldestFirst(agents: readonly AgentUsage[]): AgentUsage[] {
  return [...agents].sort((a, b) => {
    const aStart = a.startedAt === null ? Number.NEGATIVE_INFINITY : TimeUtil.parseIso(a.startedAt)?.getTime() ?? Number.NEGATIVE_INFINITY;
    const bStart = b.startedAt === null ? Number.NEGATIVE_INFINITY : TimeUtil.parseIso(b.startedAt)?.getTime() ?? Number.NEGATIVE_INFINITY;
    return aStart - bStart || a.transcriptPath.localeCompare(b.transcriptPath);
  });
}

/**
 * The stamp is re-rendered in local time and then sliced, the way `cli/tracking/status/StatusCommand.ts`
 * slices its log stamps: a transcript records UTC, and a reader in another zone must never be shown a
 * clock reading nobody was at.
 */
function localStampOf(startedAt: string | null): string {
  if (startedAt === null) return '-';
  const instant = TimeUtil.parseIso(startedAt);
  if (instant === null) return '-';
  return TimeUtil.formatLocalIso(instant).slice(LIMITS.MONTH_AND_DAY_SLICE_START_CHARACTER_OFFSET, LIMITS.CLOCK_SLICE_END_CHARACTER_OFFSET).replace('T', ' ');
}

function agentRowLinesOf(agents: readonly AgentUsage[]): string[] {
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
function cohortLineOf(label: string, summary: CohortSummary): string {
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

function sinceDateFrom(commandArguments: ArgumentParser, context: CommandContext): Date | undefined {
  const written = commandArguments.option('since');
  if (written === undefined) return undefined;

  const resolved = TimeUtil.resolveWhen(written, context.now());
  if (resolved === null) {
    throw new OperationRefusal(
      'refused',
      `--since "${written}" is not a time. Write an ISO 8601 timestamp, \`now\`, or a signed offset from now such as \`-5m\`, \`-2h\` or \`-1d\`.`,
    );
  }
  return resolved;
}

function readAgents(transcripts: readonly SubagentTranscript[], context: CommandContext): AgentUsage[] {
  const agents: AgentUsage[] = [];
  for (const transcript of transcripts) {
    const transcriptText = transcriptTextAt(transcript.path);
    if (transcriptText === undefined) {
      context.standardError(`The transcript at ${transcript.path} could not be read, so that agent is not in these figures.`);
      continue;
    }
    agents.push(agentUsageFor(transcript, transcriptText));
  }
  return oldestFirst(agents);
}

export const usageCommand: CommandHandler = (commandArguments, context) => {
  commandArguments.rejectUnknownOptions(KNOWN_OPTION_NAMES, USAGE);
  commandArguments.rejectExtraPositionals(0, USAGE);

  const workspace        = requireWorkspace(context.currentDirectory);
  const since            = sinceDateFrom(commandArguments, context);
  const transcriptFolder = commandArguments.option('transcripts') ?? transcriptFolderFor(workspace.rootDirectory);
  const agents           = readAgents(listSubagentTranscripts(transcriptFolder), context);

  const split = since === undefined ? undefined : TranscriptCohortUtil.cohortSplitAt(agents, since);
  const cohorts: UsageCohorts = split === undefined
    ? { all: TranscriptCohortUtil.cohortSummaryOf(agents) }
    : {
      all:    TranscriptCohortUtil.cohortSummaryOf(agents),
      before: TranscriptCohortUtil.cohortSummaryOf(split.before),
      after:  TranscriptCohortUtil.cohortSummaryOf(split.after),
    };
  const document = { transcriptFolder, agents, cohorts };

  if (agents.length === 0) {
    OutputUtil.printEntity(commandArguments, context, document, `No subagent transcripts were found in ${transcriptFolder}, so there is nothing to report yet.`);
    return Promise.resolve();
  }

  const lines = agentRowLinesOf(agents);
  lines.push('');
  lines.push(cohortLineOf('All', cohorts.all));
  if (since !== undefined && cohorts.before !== undefined && cohorts.after !== undefined) {
    const boundary = TimeUtil.formatLocalIso(since);
    lines.push(cohortLineOf(`Before ${boundary}`, cohorts.before));
    lines.push(cohortLineOf(`Since ${boundary}`, cohorts.after));
  }

  OutputUtil.printEntity(commandArguments, context, document, lines.join('\n'));
  return Promise.resolve();
};
