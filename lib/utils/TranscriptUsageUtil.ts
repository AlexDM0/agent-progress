/**
 * What one finished subagent cost, read out of the transcript the harness wrote for it, and the one
 * line that says so. It lives here rather than inside the hook command because the numbers are a pure
 * function of the transcript text: the command supplies the bytes and appends the answer to the log,
 * and this module is unit-tested against its own contract rather than through a `SubagentStop`
 * invocation nobody can reproduce on demand.
 *
 * It replaces a standalone hook script each repository copied for itself. Shipping the arithmetic
 * inside the CLI is what lets `agent-progress init --hooks` wire a hook up instead of asking a person
 * to paste a file, and it is why the format of the line is fixed here rather than in a template.
 */
import { OVERSIZED_CONTEXT_THRESHOLD_TOKENS } from '../constants/Limits';
import { TicketIdUtil }                       from './TicketIdUtil';
import { TokenCountUtil }                     from './TokenCountUtil';

/**
 * `endContextTokens` is the window of the *last* call rather than a sum: it is how full the agent's
 * context was when it stopped. `oversizedContextTokens` is a sum over the calls that were made at a
 * context above `OVERSIZED_CONTEXT_THRESHOLD_TOKENS`, deduplicated per call exactly as the totals are.
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

/**
 * The totals plus what explains them, which is what `cli/usage/UsageCommand.ts` compares agents by.
 * Every added field answers a question the totals alone cannot: when the agent ran, which model it
 * ran on, whether it spent its calls in a screenshot loop (`browserCallCount`), how much of its
 * length the harness injected rather than the brief (`nestedInstructionCharacters`), whether it edited
 * files by shelling out instead of by the editing tools (`bashEditScriptCount`) and ran the full
 * checks after every edit rather than after a batch (`verificationRunCount`), and what it was asked to
 * do (`briefExcerpt`). A field a transcript does not carry is `null` or zero, never a throw.
 */
export interface TranscriptProfile extends TranscriptUsageTotals {
  startedAt:                   string | null;
  model:                       string | null;
  browserCallCount:            number;
  bashEditScriptCount:         number;
  verificationRunCount:        number;
  nestedInstructionCharacters: number;
  briefExcerpt:                string;
}

/** Long enough to tell two briefs apart on one terminal row and short enough that the row still fits beside the figures. */
const BRIEF_EXCERPT_CHARACTERS = 80;

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

/** A line of its own, ids as digits separated by commas: a placeholder such as `<rowId>` in a brief template never matches. */
const ROW_MARKER_PATTERN = /^[ \t]*agent-progress row:[ \t]*(\d+(?:[ \t]*,[ \t]*\d+)*)[ \t]*$/m;

/** The same shape naming tickets, each id padded or not and with an optional `#`, as `ticket show` accepts them. */
const TICKET_MARKER_PATTERN = /^[ \t]*agent-progress ticket:[ \t]*(#?\d+(?:[ \t]*,[ \t]*#?\d+)*)[ \t]*$/m;

/** One ticket only: a reviewer's brief is written before its review row exists, and names the ticket whose newest review row it will be. */
const REVIEW_MARKER_PATTERN = /^[ \t]*agent-progress review:[ \t]*(#?\d+)[ \t]*$/m;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

/** Anything that is not a finite number reads as 0, so a transcript written by a newer harness costs a field rather than the whole summary. */
function readTokenCount(usage: Record<string, unknown>, key: string): number {
  const value = usage[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
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
 * Sums usage per API call, never per line, and **every caller depends on that direction**. One call is
 * stored as several assistant lines sharing a `message.id` — one per content block — each repeating
 * the same input figures, with the last carrying the final output count. So the input figures are
 * taken once per id and the output is the largest value seen for that id. Measured on a 466-line
 * transcript: 297 calls, where summing every line overstated input by about half.
 *
 * A line that is not JSON, is not an assistant entry, or carries no `message.usage` is skipped rather
 * than treated as an error: a transcript also records the user turns, the tool results and a final
 * line that may still be half-written. A message with no id is counted as a call of its own, because
 * the alternative — folding every idless line into one bucket — would lose calls rather than merge
 * them. An empty transcript answers zero calls, which is what the caller reports instead of a line.
 */
function summariseTranscriptUsage(transcriptText: string): TranscriptUsageTotals {
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
    if (callContextTokens > OVERSIZED_CONTEXT_THRESHOLD_TOKENS) totals.oversizedContextTokens += callContextTokens;
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

/**
 * Walks the whole parsed line rather than a known field, and is run over **every** line rather than
 * over the user turns. Measured on 207 subagent transcripts of the `company-builder` build on
 * 2026-09-19: all 404 real attachments sat on lines of their own, of type `attachment`, carrying the
 * object as `entry.attachment`. The 16 further hits on `user` and `assistant` lines were agents
 * writing the word in prose, and none of them held an attachment object — which is why the match is
 * on the object's shape and never on the text of the line.
 *
 * Only the injected text is counted; the `path` beside it is bookkeeping, not context the agent paid for.
 */
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
function briefExcerptOf(transcriptText: string): string {
  const briefText     = briefTextOf(transcriptText);
  const excerptSource = briefText.trimStart().startsWith(WORKFLOW_COMPUTED_TASK_PREFIX) ? scriptPromptOf(briefText) : briefText;
  return excerptSource.replace(/\s+/g, ' ').trim().slice(0, BRIEF_EXCERPT_CHARACTERS);
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
  const identifierList = markerPattern.exec(briefTextOf(transcriptText))?.[1];
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

/** Every token the agent sent: fresh input plus both cache figures. The log line's `input` and the row's tokens are this one number. */
function totalInputTokensOf(totals: TranscriptUsageTotals): number {
  return totals.inputTokens + totals.cacheReadInputTokens + totals.cacheCreationInputTokens;
}

/**
 * The totals of `summariseTranscriptUsage` plus the fields that explain them, in one pass over
 * the same text. `startedAt` is the first `timestamp` any line carries, whatever its type, because
 * the harness stamps the user turn that opened the agent and that is when the agent began; a
 * transcript with no stamp at all answers `null` rather than the epoch, so a cohort split can leave
 * it out of the side it cannot prove it belongs to.
 *
 * **The excerpt is taken from the brief, the first user turn that has spoken text, not from the first
 * user line**: the opening line of a subagent transcript is routinely nothing but injected attachments,
 * and an excerpt read off it would name a `CLAUDE.md` in every row instead of the brief. A workflow
 * agent's brief is its computed task, excerpted from the script's prompt after the harness's preamble.
 */
function profileTranscript(transcriptText: string): TranscriptProfile {
  const profile: TranscriptProfile = {
    ...summariseTranscriptUsage(transcriptText),
    startedAt:                   null,
    model:                       null,
    browserCallCount:            0,
    bashEditScriptCount:         0,
    verificationRunCount:        0,
    nestedInstructionCharacters: 0,
    briefExcerpt:                briefExcerptOf(transcriptText),
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

/**
 * The log line a stopped subagent leaves behind, formatted through `lib/utils/TokenCountUtil.ts` so
 * the log and the chart's token column read in the same units. The input figure is the whole of what
 * was sent — fresh input plus both cache figures — with the cache-read share named separately,
 * because that share is the number that explains a long session and is invisible in a plain total.
 */
function composeUsageLine(agentIdentifier: string, agentType: string, totals: TranscriptUsageTotals): string {
  const { formatTokenCount } = TokenCountUtil;
  const totalInputTokens = totalInputTokensOf(totals);
  return `Agent ${agentIdentifier} (${agentType}) stopped: ${totals.apiCallCount} calls, `
    + `end context ${formatTokenCount(totals.endContextTokens)}, `
    + `input ${formatTokenCount(totalInputTokens)} (cache read ${formatTokenCount(totals.cacheReadInputTokens)}), `
    + `output ${formatTokenCount(totals.outputTokens)}`;
}

export const TranscriptUsageUtil = {
  composeUsageLine,
  evenSharesOf,
  profileTranscript,
  reviewedTicketIdentifierNamedInBrief,
  rowIdentifiersNamedInBrief,
  summariseTranscriptUsage,
  ticketIdentifiersNamedInBrief,
  totalInputTokensOf,
} as const;
