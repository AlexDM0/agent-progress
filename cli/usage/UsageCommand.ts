/**
 * `agent-progress usage`: what this project's subagents actually cost, read back out of the
 * transcripts the harness wrote for them. It exists because the tracker's own token column is only
 * ever as good as what an orchestrator remembered to type — the column read 0 on every row of a
 * 73-agent build — while the transcripts held the figures the whole time.
 *
 * It is the measuring half of `cli/hook/HookCommand.ts`, and deliberately not the same thing: the
 * hook records one agent as it stops and can only ever see that one, this reads every agent a
 * repository has ever run and compares them. `--since` is what makes the comparison worth having —
 * it splits the cohort on the instant a way of briefing agents changed, so the two summaries answer
 * whether the change moved anything.
 *
 * It takes no lock, writes nothing and renders nothing: there is no tracker state to protect,
 * and a read-only report that regenerated the dashboard would be a surprise. Finding no transcripts
 * is a normal answer at exit 0 with one sentence, not a refusal — a repository that has never
 * delegated anything is not in a state the tool should complain about.
 */
import { readFileSync } from 'node:fs';

import { CLOCK_SLICE_END, MONTH_AND_DAY_SLICE_START }   from '../../lib/constants/Limits';
import type { SubagentTranscript }                      from '../../lib/platform/ClaudeTranscripts';
import { listSubagentTranscripts, transcriptFolderFor } from '../../lib/platform/ClaudeTranscripts';
import { OperationRefusal }                             from '../../lib/platform/OperationRefusal';
import { requireWorkspace }                             from '../../lib/platform/Workspace';
import { TimeUtil }                                     from '../../lib/utils/TimeUtil';
import { TokenCountUtil }                               from '../../lib/utils/TokenCountUtil';
import type { CohortSummary }                           from '../../lib/utils/TranscriptCohortUtil';
import { TranscriptCohortUtil }                         from '../../lib/utils/TranscriptCohortUtil';
import type { TranscriptProfile }                       from '../../lib/utils/TranscriptUsageUtil';
import { TranscriptUsageUtil }                          from '../../lib/utils/TranscriptUsageUtil';
import type { CommandContext }                          from '../CommandContext';
import { printEntity }                                  from '../CommandSupport';
import type { CommandHandler }                          from '../CommandTable';
import type { ArgumentParser }                          from '../arguments/ArgumentParser';

const USAGE = 'agent-progress usage [--since <when>] [--transcripts <folder>] [--json]';

const KNOWN_OPTION_NAMES = ['since', 'transcripts', 'json'];

const MEAN_CALL_COUNT_DECIMALS = 1;

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

function padColumn(text: string, width: number): string {
  return text.length >= width ? `${text} ` : text.padEnd(width);
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
  const profile = TranscriptUsageUtil.profileTranscript(transcriptText);
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
 * The stamp is re-rendered in local time and then sliced, the way `cli/status/StatusCommand.ts`
 * slices its log stamps: a transcript records UTC, and a reader in another zone must never be shown a
 * clock reading nobody was at.
 */
function localStampOf(startedAt: string | null): string {
  if (startedAt === null) return '-';
  const instant = TimeUtil.parseIso(startedAt);
  if (instant === null) return '-';
  return TimeUtil.formatLocalIso(instant).slice(MONTH_AND_DAY_SLICE_START, CLOCK_SLICE_END).replace('T', ' ');
}

function renderAgentRows(agents: readonly AgentUsage[]): string[] {
  const { formatTokenCount } = TokenCountUtil;
  const lines = [[
    padColumn('started', AGENT_COLUMN_WIDTHS.startedAt),
    padColumn('calls', AGENT_COLUMN_WIDTHS.calls),
    padColumn('end context', AGENT_COLUMN_WIDTHS.endContext),
    padColumn('input', AGENT_COLUMN_WIDTHS.input),
    padColumn('output', AGENT_COLUMN_WIDTHS.output),
    padColumn('browser', AGENT_COLUMN_WIDTHS.browser),
    padColumn('over 200k', AGENT_COLUMN_WIDTHS.oversizedContext),
    padColumn('bash edits', AGENT_COLUMN_WIDTHS.bashEdits),
    padColumn('checks', AGENT_COLUMN_WIDTHS.checks),
    padColumn('nested', AGENT_COLUMN_WIDTHS.nested),
    'brief',
  ].join('')];

  for (const agent of agents) {
    lines.push([
      padColumn(localStampOf(agent.startedAt), AGENT_COLUMN_WIDTHS.startedAt),
      padColumn(String(agent.apiCallCount), AGENT_COLUMN_WIDTHS.calls),
      padColumn(formatTokenCount(agent.endContextTokens), AGENT_COLUMN_WIDTHS.endContext),
      padColumn(formatTokenCount(agent.totalInputTokens), AGENT_COLUMN_WIDTHS.input),
      padColumn(formatTokenCount(agent.outputTokens), AGENT_COLUMN_WIDTHS.output),
      padColumn(String(agent.browserCallCount), AGENT_COLUMN_WIDTHS.browser),
      padColumn(oversizedContextPercentOf(agent), AGENT_COLUMN_WIDTHS.oversizedContext),
      padColumn(String(agent.bashEditScriptCount), AGENT_COLUMN_WIDTHS.bashEdits),
      padColumn(String(agent.verificationRunCount), AGENT_COLUMN_WIDTHS.checks),
      padColumn(formatTokenCount(agent.nestedInstructionCharacters), AGENT_COLUMN_WIDTHS.nested),
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
    printEntity(commandArguments, context, document, `No subagent transcripts were found in ${transcriptFolder}, so there is nothing to report yet.`);
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

  printEntity(commandArguments, context, document, lines.join('\n'));
  return Promise.resolve();
};
