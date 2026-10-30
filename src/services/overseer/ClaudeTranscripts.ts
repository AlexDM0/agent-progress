/**
 * A job session's subagents as Claude Code wrote them under `<home>/.claude/projects/<slug of the working directory>/<sessionId>/subagents/`,
 * tallied as the live facts tally the event log, so a job whose event log lost them after a crash or reboot still lists them. Each
 * subagent is keyed by the `toolUseId` its `.meta.json` names, the parent call the event log groups it under.
 */

import { listSessionSubagentTranscripts, transcriptFolderFor, transcriptTextAt } from '../../lib/claude-code/ClaudeTranscripts.ts';
import { TranscriptUsageUtil }                                                   from '../../lib/claude-code/utils/TranscriptUsageUtil.ts';
import { JsonRecordUtil }                                                        from '../../lib/json-record/JsonRecordUtil.ts';

export interface SessionTranscriptSource {
  homeDirectory:    string;
  workingDirectory: string;
  sessionId:        string;
}

export interface TranscriptSubagentFacts {
  parentToolUseId: string;
  toolCalls:       number;
  lastToolCall:    { toolName: string; startedAt: string | null; running: boolean } | null;
  tokens:          number;
}

const AGENT_METADATA_FILE_SUFFIX = '.meta.json';

const TRANSCRIPT_FILE_SUFFIX = '.jsonl';

function parsedRecordOf(text: string): Record<string, unknown> | undefined {
  try {
    return JsonRecordUtil.recordOf(JSON.parse(text));
  } catch {
    // A transcript is appended to while it is read, so its last line is routinely half-written.
    return undefined;
  }
}

/** The parent call from the `.meta.json` beside the transcript; `null` when the file, its JSON or the field is missing. */
function parentToolUseIdBeside(transcriptPath: string): string | null {
  const metadataText = transcriptTextAt(`${transcriptPath.slice(0, -TRANSCRIPT_FILE_SUFFIX.length)}${AGENT_METADATA_FILE_SUFFIX}`);
  const toolUseId    = metadataText === undefined ? undefined : parsedRecordOf(metadataText)?.['toolUseId'];
  return typeof toolUseId === 'string' && toolUseId.length > 0 ? toolUseId : null;
}

function contentBlocksOf(entry: Record<string, unknown>): Record<string, unknown>[] {
  const content = JsonRecordUtil.recordOf(entry['message'])?.['content'];
  if (!Array.isArray(content)) return [];
  return content.map((block) => JsonRecordUtil.recordOf(block)).filter((block): block is Record<string, unknown> => block !== undefined);
}

function summedTokensOf(transcriptText: string): number {
  const totals = TranscriptUsageUtil.usageTotalsOf(transcriptText, Number.POSITIVE_INFINITY);
  return totals.inputTokens + totals.outputTokens + totals.cacheCreationInputTokens + totals.cacheReadInputTokens;
}

/** Pure over the transcript text: a call is counted once by its `tool_use` id, and runs until a `tool_result` names that id. */
function subagentFactsOfTranscript(parentToolUseId: string, transcriptText: string): TranscriptSubagentFacts {
  const calledToolUseIds   = new Set<string>();
  const answeredToolUseIds = new Set<string>();
  let last: { toolUseId: string; toolName: string; startedAt: string | null } | null = null;
  for (const line of transcriptText.split('\n')) {
    const entry = line.trim() === '' ? undefined : parsedRecordOf(line);
    if (entry === undefined) continue;
    const { timestamp } = entry;
    for (const block of contentBlocksOf(entry)) {
      const {
        type: blockType, id: toolUseId, name: toolName, tool_use_id: answeredToolUseId
      } = block;
      if (blockType === 'tool_result' && typeof answeredToolUseId === 'string') answeredToolUseIds.add(answeredToolUseId);
      if (entry['type'] !== 'assistant' || blockType !== 'tool_use' || typeof toolUseId !== 'string' || calledToolUseIds.has(toolUseId)) continue;
      calledToolUseIds.add(toolUseId);
      last = { toolUseId, toolName: typeof toolName === 'string' ? toolName : '', startedAt: typeof timestamp === 'string' ? timestamp : null };
    }
  }
  return {
    parentToolUseId,
    toolCalls:    calledToolUseIds.size,
    lastToolCall: last === null ? null : { toolName: last.toolName, startedAt: last.startedAt, running: !answeredToolUseIds.has(last.toolUseId) },
    tokens:       summedTokensOf(transcriptText),
  };
}

/**
 * The session's subagents, its workflow runs' among them, except those whose parent call `skippedParentToolUseIds` holds, so a caller
 * reads no transcript its event log already tallied. A subagent with no `.meta.json` is keyed by its agent id; an absent folder is none.
 */
function subagentFactsOf(source: SessionTranscriptSource, skippedParentToolUseIds: ReadonlySet<string>): TranscriptSubagentFacts[] {
  const transcriptFolder = transcriptFolderFor(source.workingDirectory, source.homeDirectory);
  const facts: TranscriptSubagentFacts[] = [];
  for (const transcript of listSessionSubagentTranscripts(transcriptFolder, source.sessionId)) {
    const parentToolUseId = parentToolUseIdBeside(transcript.path) ?? transcript.agentIdentifier;
    if (skippedParentToolUseIds.has(parentToolUseId)) continue;
    const transcriptText = transcriptTextAt(transcript.path);
    if (transcriptText !== undefined) facts.push(subagentFactsOfTranscript(parentToolUseId, transcriptText));
  }
  return facts;
}

export const ClaudeTranscripts = Object.freeze({ subagentFactsOf, subagentFactsOfTranscript });
