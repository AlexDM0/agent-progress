/**
 * What one finished subagent cost and did, read out of the transcript the harness wrote for it. The figures are a pure function of the
 * transcript text, so they are tested against constructed transcripts rather than through a live `SubagentStop`.
 */

/**
 * `endContextTokens` is the window of the *last* call rather than a sum: it is how full the agent's
 * context was when it stopped. `oversizedContextTokens` is a sum over the calls that were made at a
 * context above the caller's threshold, deduplicated per call exactly as the totals are.
 */
export interface TranscriptUsageTotals {
  apiCallCount:             number;
  inputTokens:              number;
  cacheReadInputTokens:     number;
  cacheCreationInputTokens: number;
  outputTokens:             number;
  endContextTokens:         number;
  oversizedContextTokens:   number;
}

/** The totals plus what explains them, for comparing agents. A field a transcript does not carry is `null` or zero, never a throw. */
export interface TranscriptProfile extends TranscriptUsageTotals {
  startedAt:                   string | null;
  model:                       string | null;
  browserCallCount:            number;
  bashEditScriptCount:         number;
  verificationRunCount:        number;
  nestedInstructionCharacters: number;
  briefExcerpt:                string;
}

/** Matched as a fragment because the harness spells the browser tools `mcp__Claude_Browser__computer`, `…__navigate` and a dozen more. */
const BROWSER_TOOL_NAME_FRAGMENT = 'Claude_Browser';

/** The harness's own spelling for a `CLAUDE.md` it injected; observed in the transcripts under `~/.claude/projects/`. */
const NESTED_ATTACHMENT_TYPE = 'nested_memory';

const BASH_TOOL_NAME = 'Bash';

/** What a shell command that writes a file looks like: a heredoc, an inline interpreter, or an editor working in place. */
const BASH_EDIT_SCRIPT_FRAGMENTS = ['<<', 'python3 ', 'python ', 'perl -', 'node -e', 'bun -e', 'sed -i'] as const;

/** What a shell command that runs the test suite, the type checker or the linter looks like. One command counts once however many of them it chains. */
const VERIFICATION_RUN_FRAGMENTS = [
  'bun test',
  'bun run test',
  'bun run typecheck',
  'bun run lint',
  'npm test',
  'npm run test',
  'npx tsc',
  'tsc -p',
  'eslint',
  'vitest',
  'jest',
  'pytest',
] as const;

const TOOL_USE_BLOCK_TYPE = 'tool_use';

const TEXT_BLOCK_TYPE = 'text';

/** The harness's opening words for the two turns a workflow agent's transcript starts with; observed in the transcripts under `~/.claude/projects/`. */
const WORKFLOW_USER_REQUEST_RELAY_PREFIX = '[Workflow harness — user request]';

const WORKFLOW_COMPUTED_TASK_PREFIX = '[Workflow harness — computed task]';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

/** Anything that is not a whole count of at least 0 reads as 0, so a transcript written by a newer harness costs a field rather than the whole summary. */
function readTokenCount(usage: Record<string, unknown>, key: string): number {
  const value = usage[key];
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function parsedJsonLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    // A transcript is appended to while it is being read, so its last line is routinely half-written.
    return undefined;
  }
}

function assistantUsageIn(line: string): { messageIdentifier: string | undefined; usage: Record<string, unknown> } | undefined {
  const entry = asRecord(parsedJsonLine(line));
  if (entry === undefined || entry['type'] !== 'assistant') return undefined;

  const message = asRecord(entry['message']);
  if (message === undefined) return undefined;

  const usage = asRecord(message['usage']);
  if (usage === undefined) return undefined;

  const identifier = message['id'];
  return { messageIdentifier: typeof identifier === 'string' ? identifier : undefined, usage };
}

/**
 * Sums per API call (`message.id`), never per line: one call spans several lines that repeat its input, so input counts once per id and
 * output is the largest seen. Lines that are not assistant usage are skipped, and a message with no id counts as a call of its own.
 */
function summariseTranscriptUsage(transcriptText: string, oversizedContextThresholdTokens: number): TranscriptUsageTotals {
  const totals: TranscriptUsageTotals = {
    apiCallCount:             0,
    inputTokens:              0,
    cacheReadInputTokens:     0,
    cacheCreationInputTokens: 0,
    outputTokens:             0,
    endContextTokens:         0,
    oversizedContextTokens:   0,
  };
  const outputTokensByMessageIdentifier = new Map<string, number>();

  for (const line of transcriptText.split('\n')) {
    const trimmedLine = line.trim();
    if (trimmedLine.length === 0) continue;

    const assistantUsage = assistantUsageIn(trimmedLine);
    if (assistantUsage === undefined) continue;

    const { usage } = assistantUsage;
    const messageIdentifier = assistantUsage.messageIdentifier ?? `line-${totals.apiCallCount}`;
    const outputTokens      = readTokenCount(usage, 'output_tokens');
    const previousOutput    = outputTokensByMessageIdentifier.get(messageIdentifier);
    if (previousOutput !== undefined) {
      outputTokensByMessageIdentifier.set(messageIdentifier, Math.max(previousOutput, outputTokens));
      continue;
    }
    outputTokensByMessageIdentifier.set(messageIdentifier, outputTokens);

    const inputTokens              = readTokenCount(usage, 'input_tokens');
    const cacheReadInputTokens     = readTokenCount(usage, 'cache_read_input_tokens');
    const cacheCreationInputTokens = readTokenCount(usage, 'cache_creation_input_tokens');

    const callContextTokens = inputTokens + cacheReadInputTokens + cacheCreationInputTokens;

    totals.apiCallCount             += 1;
    totals.inputTokens              += inputTokens;
    totals.cacheReadInputTokens     += cacheReadInputTokens;
    totals.cacheCreationInputTokens += cacheCreationInputTokens;
    totals.endContextTokens          = callContextTokens;
    if (callContextTokens > oversizedContextThresholdTokens) totals.oversizedContextTokens += callContextTokens;
  }

  for (const outputTokens of outputTokensByMessageIdentifier.values()) totals.outputTokens += outputTokens;

  return totals;
}

function contentBlocksOf(message: Record<string, unknown>): unknown[] {
  const { content } = message;
  return Array.isArray(content) ? content : [];
}

function browserToolUseCountIn(message: Record<string, unknown>): number {
  let browserCallCount = 0;
  for (const block of contentBlocksOf(message)) {
    const blockRecord = asRecord(block);
    if (blockRecord === undefined || blockRecord['type'] !== TOOL_USE_BLOCK_TYPE) continue;
    const toolName = blockRecord['name'];
    if (typeof toolName === 'string' && toolName.includes(BROWSER_TOOL_NAME_FRAGMENT)) browserCallCount += 1;
  }
  return browserCallCount;
}

/** Tool-use blocks, unlike the usage figures, are written once rather than repeated across the lines of one call, so these are read per line. */
function bashCommandsIn(message: Record<string, unknown>): string[] {
  const commands: string[] = [];
  for (const block of contentBlocksOf(message)) {
    const blockRecord = asRecord(block);
    if (blockRecord === undefined || blockRecord['type'] !== TOOL_USE_BLOCK_TYPE || blockRecord['name'] !== BASH_TOOL_NAME) continue;
    const command = asRecord(blockRecord['input'])?.['command'];
    if (typeof command === 'string') commands.push(command);
  }
  return commands;
}

function commandMatchesAny(command: string, fragments: readonly string[]): boolean {
  return fragments.some((fragment) => command.includes(fragment));
}

/** Matches the attachment object's shape anywhere in the entry, never the line's text, and counts only the injected text, not its `path`. */
function nestedInstructionCharactersIn(value: unknown): number {
  if (Array.isArray(value)) {
    return (value as unknown[]).reduce((running: number, item: unknown) => running + nestedInstructionCharactersIn(item), 0);
  }

  const record = asRecord(value);
  if (record === undefined) return 0;

  if (record['type'] === NESTED_ATTACHMENT_TYPE) {
    const attachment  = asRecord(record['content']);
    const injectedText = attachment?.['content'];
    return typeof injectedText === 'string' ? injectedText.length : 0;
  }

  return Object.values(record).reduce((running: number, item: unknown) => running + nestedInstructionCharactersIn(item), 0);
}

/** Only `text` blocks, so an attachment the harness stapled to the same turn is never mistaken for what the agent was asked to do. */
function spokenTextOf(message: Record<string, unknown>): string {
  const { content } = message;
  return typeof content === 'string'
    ? content
    : contentBlocksOf(message)
      .map((block) => asRecord(block))
      .filter((block) => block?.['type'] === TEXT_BLOCK_TYPE)
      .map((block) => (typeof block?.['text'] === 'string' ? block['text'] : ''))
      .join('\n');
}

/** The harness indents every line of the computed text, so its own preamble is the column-zero lines before the first blank or indented one. */
function scriptPromptOf(computedTask: string): string {
  const lines            = computedTask.trimStart().split('\n');
  const promptStartIndex = lines.findIndex((line, index) => index > 0 && (line.trim().length === 0 || /^\s/.test(line)));
  return promptStartIndex === -1 ? '' : lines.slice(promptStartIndex).join('\n');
}

/** A workflow run started without a user request opens on the computed task itself, so the preamble is removed whether or not a relay came first. */
function briefExcerptOf(transcriptText: string, briefExcerptCharacters: number): string {
  const briefText     = briefTextOf(transcriptText);
  const excerptSource = briefText.trimStart().startsWith(WORKFLOW_COMPUTED_TASK_PREFIX) ? scriptPromptOf(briefText) : briefText;
  return excerptSource.replace(/\s+/g, ' ').trim().slice(0, briefExcerptCharacters);
}

function* spokenUserTurnsOf(transcriptText: string): Generator<string> {
  for (const line of transcriptText.split('\n')) {
    const trimmedLine = line.trim();
    if (trimmedLine.length === 0) continue;

    const entry = asRecord(parsedJsonLine(trimmedLine));
    if (entry === undefined || entry['type'] !== 'user') continue;

    const message = asRecord(entry['message']);
    if (message === undefined) continue;

    const spokenText = spokenTextOf(message);
    if (spokenText.trim().length > 0) yield spokenText;
  }
}

/**
 * The first user turn with spoken text, which `profileTranscript` excerpts too; an empty string when there is none.
 * A workflow agent's first turn is the harness relaying the session user's request, and its brief is the computed task that must follow it
 * at once; a relay followed by anything else has no brief, so a marker the relay quotes or a later message carries never counts.
 */
function briefTextOf(transcriptText: string): string {
  const spokenUserTurns = spokenUserTurnsOf(transcriptText);
  const firstTurn       = spokenUserTurns.next();
  if (firstTurn.done === true) return '';
  if (!firstTurn.value.trimStart().startsWith(WORKFLOW_USER_REQUEST_RELAY_PREFIX)) return firstTurn.value;

  const secondTurn = spokenUserTurns.next();
  if (secondTurn.done === true || !secondTurn.value.trimStart().startsWith(WORKFLOW_COMPUTED_TASK_PREFIX)) return '';
  return secondTurn.value;
}

/** Every token the agent sent: fresh input plus both cache figures, as one number so every caller reports the same total. */
function totalInputTokensOf(totals: TranscriptUsageTotals): number {
  return totals.inputTokens + totals.cacheReadInputTokens + totals.cacheCreationInputTokens;
}

/**
 * `startedAt` is the first `timestamp` on any line, or `null` rather than the epoch. The excerpt comes from the first user turn with spoken
 * text, because a subagent's opening line is often only injected attachments, and is one line cut to the caller's length.
 */
function profileTranscript(transcriptText: string, oversizedContextThresholdTokens: number, briefExcerptCharacters: number): TranscriptProfile {
  const profile: TranscriptProfile = {
    ...summariseTranscriptUsage(transcriptText, oversizedContextThresholdTokens),
    startedAt:                   null,
    model:                       null,
    browserCallCount:            0,
    bashEditScriptCount:         0,
    verificationRunCount:        0,
    nestedInstructionCharacters: 0,
    briefExcerpt:                briefExcerptOf(transcriptText, briefExcerptCharacters),
  };

  for (const line of transcriptText.split('\n')) {
    const trimmedLine = line.trim();
    if (trimmedLine.length === 0) continue;

    const entry = asRecord(parsedJsonLine(trimmedLine));
    if (entry === undefined) continue;

    const { timestamp } = entry;
    if (profile.startedAt === null && typeof timestamp === 'string' && timestamp.length > 0) profile.startedAt = timestamp;

    profile.nestedInstructionCharacters += nestedInstructionCharactersIn(entry);

    const message = asRecord(entry['message']);
    if (message === undefined) continue;

    if (entry['type'] === 'assistant') {
      const { model } = message;
      if (profile.model === null && typeof model === 'string' && model.length > 0) profile.model = model;
      profile.browserCallCount += browserToolUseCountIn(message);
      for (const command of bashCommandsIn(message)) {
        if (commandMatchesAny(command, BASH_EDIT_SCRIPT_FRAGMENTS)) profile.bashEditScriptCount += 1;
        if (commandMatchesAny(command, VERIFICATION_RUN_FRAGMENTS)) profile.verificationRunCount += 1;
      }
    }
  }

  return profile;
}

export const TranscriptUsageUtil = {
  briefTextOf,
  profileTranscript,
  summariseTranscriptUsage,
  totalInputTokensOf,
} as const;
