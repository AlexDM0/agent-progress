/** Every subagent transcript read into the figures `usage` reports, oldest first; one that cannot be read is named on standard error and left out. */
import type { SubagentTranscript } from '../../../src/lib/claude-code/ClaudeTranscripts.ts';
import { transcriptTextAt }        from '../../../src/lib/claude-code/ClaudeTranscripts.ts';
import type { TranscriptProfile }  from '../../../src/lib/claude-code/utils/TranscriptUsageUtil.ts';
import { TranscriptUsageUtil }     from '../../../src/lib/claude-code/utils/TranscriptUsageUtil.ts';
import { TimeUtil }                from '../../../src/lib/utils/TimeUtil.ts';
import { LIMITS }                  from '../../../src/shared/constants/Limits.ts';
import type { CommandContext }     from '../../CommandContext.ts';

/** Long enough to tell two briefs apart on one terminal row and short enough that the row still fits beside the figures. */
const BRIEF_EXCERPT_CHARACTERS = 80;

/** One agent as the report prints it and as `--json` carries it: the profile, flattened, with the figures a reader adds up by hand made explicit. */
export interface AgentUsage extends TranscriptProfile {
  sessionIdentifier: string;
  agentIdentifier:   string;
  transcriptPath:    string;
  totalInputTokens:  number;
}

function agentUsageFor(transcript: SubagentTranscript, transcriptText: string): AgentUsage {
  const profile = TranscriptUsageUtil.transcriptProfileOf(transcriptText, LIMITS.OVERSIZED_CONTEXT_THRESHOLD_TOKENS, BRIEF_EXCERPT_CHARACTERS);
  return {
    ...profile,
    sessionIdentifier: transcript.sessionIdentifier,
    agentIdentifier:   transcript.agentIdentifier,
    transcriptPath:    transcript.path,
    totalInputTokens:  TranscriptUsageUtil.totalInputTokensOf(profile),
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

export function readAgents(transcripts: readonly SubagentTranscript[], context: CommandContext): AgentUsage[] {
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
