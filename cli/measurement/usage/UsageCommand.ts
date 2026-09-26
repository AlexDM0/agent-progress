/**
 * What every subagent of this repository cost, read from the harness's transcripts; `cli/measurement/hook/HookCommand.ts` records one agent as it
 * stops, this compares them all. Read-only, and finding no transcripts is one sentence at exit 0, not a refusal.
 */
import { readFileSync } from 'node:fs';

import type { SubagentTranscript }                      from '../../../src/lib/claude-code/ClaudeTranscripts';
import { listSubagentTranscripts, transcriptFolderFor } from '../../../src/lib/claude-code/ClaudeTranscripts';
import type { CohortSummary }                           from '../../../src/lib/claude-code/utils/TranscriptCohortUtil';
import { TranscriptCohortUtil }                         from '../../../src/lib/claude-code/utils/TranscriptCohortUtil';
import type { TranscriptProfile }                       from '../../../src/lib/claude-code/utils/TranscriptUsageUtil';
import { TranscriptUsageUtil }                          from '../../../src/lib/claude-code/utils/TranscriptUsageUtil';
import { TimeUtil }                                     from '../../../src/lib/utils/TimeUtil';
import { TokenCountUtil }                               from '../../../src/lib/utils/TokenCountUtil';
import { requireWorkspace }                             from '../../../src/services/tracker/Workspace';
import { OperationRefusal }                             from '../../../src/shared/OperationRefusal';
import { LIMITS }                                       from '../../../src/shared/constants/Limits';
import type { CommandContext }                          from '../../CommandContext';
import type { CommandHandler }                          from '../../CommandTable';
import type { ArgumentParser }                          from '../../arguments/ArgumentParser';
import { OutputUtil }                                   from '../../utils/OutputUtil';

const USAGE = 'agent-progress usage [--since <when>] [--transcripts <folder>] [--json]';

const KNOWN_OPTION_NAMES = ['since', 'transcripts', 'json'];

const MEAN_CALL_COUNT_DECIMALS = 1;

/** Long enough to tell two briefs apart on one terminal row and short enough that the row still fits beside the figures. */
const BRIEF_EXCERPT_CHARACTERS = 80;

const PERCENT_OF_A_WHOLE = 100;

/** Each width holds the wider of its header and its figures; the end-context column is the broad one because its header is, not its numbers. */
const AGENT_COLUMN_WIDTHS = {
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

/** A transcript that vanished or will not open costs its row, never the report: the folder is the harness's and may be pruned while this runs. */
function transcriptTextAt(transcriptPath: string): string | undefined {
  try {
    return readFileSync(transcriptPath, 'utf8');
  } catch {
    return undefined;
  }
}

function agentUsageFor(transcript: SubagentTranscript, transcriptText: string): AgentUsage {
  const profile = TranscriptUsageUtil.profileTranscript(transcriptText, LIMITS.OVERSIZED_CONTEXT_THRESHOLD_TOKENS, BRIEF_EXCERPT_CHARACTERS);
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
  return TimeUtil.formatLocalIso(instant).slice(LIMITS.MONTH_AND_DAY_SLICE_START, LIMITS.CLOCK_SLICE_END).replace('T', ' ');
}

function renderAgentRows(agents: readonly AgentUsage[]): string[] {
  const { formatTokenCount } = TokenCountUtil;
  const lines = [[
    OutputUtil.padColumn('started', AGENT_COLUMN_WIDTHS.startedAt),
    OutputUtil.padColumn('calls', AGENT_COLUMN_WIDTHS.calls),
    OutputUtil.padColumn('end context', AGENT_COLUMN_WIDTHS.endContext),
    OutputUtil.padColumn('input', AGENT_COLUMN_WIDTHS.input),
    OutputUtil.padColumn('output', AGENT_COLUMN_WIDTHS.output),
    OutputUtil.padColumn('browser', AGENT_COLUMN_WIDTHS.browser),
    OutputUtil.padColumn('over 200k', AGENT_COLUMN_WIDTHS.oversizedContext),
    OutputUtil.padColumn('bash edits', AGENT_COLUMN_WIDTHS.bashEdits),
    OutputUtil.padColumn('checks', AGENT_COLUMN_WIDTHS.checks),
    OutputUtil.padColumn('nested', AGENT_COLUMN_WIDTHS.nested),
    'brief',
  ].join('')];

  for (const agent of agents) {
    lines.push([
      OutputUtil.padColumn(localStampOf(agent.startedAt), AGENT_COLUMN_WIDTHS.startedAt),
      OutputUtil.padColumn(String(agent.apiCallCount), AGENT_COLUMN_WIDTHS.calls),
      OutputUtil.padColumn(formatTokenCount(agent.endContextTokens), AGENT_COLUMN_WIDTHS.endContext),
      OutputUtil.padColumn(formatTokenCount(agent.totalInputTokens), AGENT_COLUMN_WIDTHS.input),
      OutputUtil.padColumn(formatTokenCount(agent.outputTokens), AGENT_COLUMN_WIDTHS.output),
      OutputUtil.padColumn(String(agent.browserCallCount), AGENT_COLUMN_WIDTHS.browser),
      OutputUtil.padColumn(oversizedContextPercentOf(agent), AGENT_COLUMN_WIDTHS.oversizedContext),
      OutputUtil.padColumn(String(agent.bashEditScriptCount), AGENT_COLUMN_WIDTHS.bashEdits),
      OutputUtil.padColumn(String(agent.verificationRunCount), AGENT_COLUMN_WIDTHS.checks),
      OutputUtil.padColumn(formatTokenCount(agent.nestedInstructionCharacters), AGENT_COLUMN_WIDTHS.nested),
      agent.briefExcerpt,
    ].join(''));
  }
  return lines;
}

/** The character counts are formatted through the token formatter on purpose: the report is read as one column of magnitudes, not as two units. */
function renderCohortLine(label: string, summary: CohortSummary): string {
  if (summary.transcriptCount === 0) return `${label}: no agents.`;

  const { formatTokenCount } = TokenCountUtil;
  const agentWord            = summary.transcriptCount === 1 ? 'agent' : 'agents';
  return `${label}: ${summary.transcriptCount} ${agentWord}, median ${summary.medianApiCallCount} calls, `
    + `median end context ${formatTokenCount(summary.medianEndContextTokens)}, `
    + `mean input ${formatTokenCount(summary.meanTotalInputTokens)}, `
    + `mean output ${formatTokenCount(summary.meanOutputTokens)}, `
    + `mean ${summary.meanBrowserCallCount.toFixed(MEAN_CALL_COUNT_DECIMALS)} browser calls, `
    + `mean ${Math.round(summary.meanOversizedContextShare * PERCENT_OF_A_WHOLE)}% over 200k context, `
    + `mean ${summary.meanBashEditScriptCount.toFixed(MEAN_CALL_COUNT_DECIMALS)} bash edit scripts, `
    + `mean ${summary.meanVerificationRunCount.toFixed(MEAN_CALL_COUNT_DECIMALS)} verification runs, `
    + `mean ${formatTokenCount(summary.meanNestedInstructionCharacters)} nested characters`;
}

function resolveSinceOption(commandArguments: ArgumentParser, context: CommandContext): Date | undefined {
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
  const since            = resolveSinceOption(commandArguments, context);
  const transcriptFolder = commandArguments.option('transcripts') ?? transcriptFolderFor(workspace.rootDirectory);
  const agents           = readAgents(listSubagentTranscripts(transcriptFolder), context);

  const { summariseCohort } = TranscriptCohortUtil;
  const split               = since === undefined ? undefined : TranscriptCohortUtil.splitAt(agents, since);
  const cohorts: UsageCohorts = split === undefined
    ? { all: summariseCohort(agents) }
    : {
      all:    summariseCohort(agents),
      before: summariseCohort(split.before),
      after:  summariseCohort(split.after),
    };
  const document = { transcriptFolder, agents, cohorts };

  if (agents.length === 0) {
    OutputUtil.printEntity(commandArguments, context, document, `No subagent transcripts were found in ${transcriptFolder}, so there is nothing to report yet.`);
    return Promise.resolve();
  }

  const lines = renderAgentRows(agents);
  lines.push('');
  lines.push(renderCohortLine('All', cohorts.all));
  if (since !== undefined && cohorts.before !== undefined && cohorts.after !== undefined) {
    const boundary = TimeUtil.formatLocalIso(since);
    lines.push(renderCohortLine(`Before ${boundary}`, cohorts.before));
    lines.push(renderCohortLine(`Since ${boundary}`, cohorts.after));
  }

  OutputUtil.printEntity(commandArguments, context, document, lines.join('\n'));
  return Promise.resolve();
};
