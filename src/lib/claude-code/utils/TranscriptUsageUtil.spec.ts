/**
 * A call is a `message.id`, not a line, and every malformed shape a transcript can carry is skipped rather than read as an error.
 * Transcripts are constructed, as the claim is about the arithmetic.
 */
import { describe, expect, test } from 'bun:test';

import { TranscriptUsageUtil } from './TranscriptUsageUtil.ts';

const {
  briefTextOf,
  totalInputTokensOf,
  transcriptProfileOf,
  usageTotalsOf,
} = TranscriptUsageUtil;

const OVERSIZED_CONTEXT_THRESHOLD_TOKENS = 200_000;
const BRIEF_EXCERPT_CHARACTERS           = 80;

interface ConstructedUsage {
  input_tokens?:                number;
  cache_read_input_tokens?:     number;
  cache_creation_input_tokens?: number;
  output_tokens?:               number;
}

function assistantLine(messageIdentifier: string | null, usage: ConstructedUsage): string {
  const message = messageIdentifier === null ? { usage } : { id: messageIdentifier, usage };
  return JSON.stringify({ type: 'assistant', message });
}

describe('one API call spread over several lines', () => {
  /** The whole reason this module is not a `reduce` over the lines: the three lines below are one call, and summing them triples the input. */
  test('lines sharing a message id count once, at the input they all repeat and the largest output any of them carries', () => {
    const transcript = [
      assistantLine('msg_one', {
        input_tokens:                12,
        cache_read_input_tokens:     400,
        cache_creation_input_tokens: 80,
        output_tokens:               5,
      }),
      assistantLine('msg_one', {
        input_tokens:                12,
        cache_read_input_tokens:     400,
        cache_creation_input_tokens: 80,
        output_tokens:               90,
      }),
      assistantLine('msg_one', {
        input_tokens:                12,
        cache_read_input_tokens:     400,
        cache_creation_input_tokens: 80,
        output_tokens:               140,
      }),
    ].join('\n');

    const totals = usageTotalsOf(transcript, OVERSIZED_CONTEXT_THRESHOLD_TOKENS);

    expect(totals.apiCallCount).toBe(1);
    expect(totals.inputTokens).toBe(12);
    expect(totals.cacheReadInputTokens).toBe(400);
    expect(totals.cacheCreationInputTokens).toBe(80);
    expect(totals.outputTokens).toBe(140);
  });

  test('two different ids are two calls, and their input figures add up', () => {
    const transcript = [
      assistantLine('msg_one', { input_tokens: 10, cache_read_input_tokens: 100, output_tokens: 20 }),
      assistantLine('msg_two', { input_tokens: 30, cache_read_input_tokens: 500, output_tokens: 40 }),
    ].join('\n');

    const totals = usageTotalsOf(transcript, OVERSIZED_CONTEXT_THRESHOLD_TOKENS);

    expect(totals.apiCallCount).toBe(2);
    expect(totals.inputTokens).toBe(40);
    expect(totals.outputTokens).toBe(60);
  });

  /**
   * The lines of one call are not always consecutive, so the bookkeeping has to be per id rather than
   * per run: a `reduce` that closed a call when the id changed would read the four lines below as four.
   */
  test('two ids interleaved across four lines are two calls, each counted once at its input and at its largest output', () => {
    const transcript = [
      assistantLine('msg_one', { input_tokens: 10, cache_read_input_tokens: 100, output_tokens: 5 }),
      assistantLine('msg_two', { input_tokens: 30, cache_read_input_tokens: 500, output_tokens: 40 }),
      assistantLine('msg_one', { input_tokens: 10, cache_read_input_tokens: 100, output_tokens: 70 }),
      assistantLine('msg_two', { input_tokens: 30, cache_read_input_tokens: 500, output_tokens: 40 }),
    ].join('\n');

    const totals = usageTotalsOf(transcript, OVERSIZED_CONTEXT_THRESHOLD_TOKENS);

    expect(totals.apiCallCount).toBe(2);
    expect(totals.inputTokens, 'each id\'s input is taken once, however often its lines repeat it').toBe(40);
    expect(totals.cacheReadInputTokens).toBe(600);
    expect(totals.outputTokens, 'the largest output per id: 70 for the one that grew, 40 for the one that did not').toBe(110);
  });

  /** The end context is the last call's window, so it answers "how full was the agent when it stopped" rather than "what did the session weigh". */
  test('the end context is the last call\'s window and not the sum of every call', () => {
    const transcript = [
      assistantLine('msg_one', { input_tokens: 10, cache_read_input_tokens: 100, cache_creation_input_tokens: 5 }),
      assistantLine('msg_two', { input_tokens: 20, cache_read_input_tokens: 900, cache_creation_input_tokens: 7 }),
    ].join('\n');

    expect(usageTotalsOf(transcript, OVERSIZED_CONTEXT_THRESHOLD_TOKENS).endContextTokens).toBe(927);
  });
});

describe('the lines a transcript carries that are not calls', () => {
  test('a message with no id is still one call, rather than being dropped or folded into another', () => {
    const transcript = assistantLine(null, { input_tokens: 15, output_tokens: 25 });

    const totals = usageTotalsOf(transcript, OVERSIZED_CONTEXT_THRESHOLD_TOKENS);

    expect(totals.apiCallCount).toBe(1);
    expect(totals.inputTokens).toBe(15);
    expect(totals.outputTokens).toBe(25);
  });

  test('a line that is not JSON, a user turn and an assistant turn without usage are all skipped', () => {
    const transcript = [
      'not json at all',
      JSON.stringify({ type: 'user', message: { content: 'do the thing' } }),
      JSON.stringify({ type: 'assistant', message: { id: 'msg_no_usage' } }),
      '',
      assistantLine('msg_one', { input_tokens: 7, output_tokens: 3 }),
      '{"type":"assistant","message":{"id":"msg_half_wri',
    ].join('\n');

    const totals = usageTotalsOf(transcript, OVERSIZED_CONTEXT_THRESHOLD_TOKENS);

    expect(totals.apiCallCount).toBe(1);
    expect(totals.inputTokens).toBe(7);
  });

  test('a usage field that is missing or not a number reads as zero rather than as a broken transcript', () => {
    const transcript = JSON.stringify({ type: 'assistant', message: { id: 'msg_one', usage: { input_tokens: 'lots', output_tokens: 9 } } });

    const totals = usageTotalsOf(transcript, OVERSIZED_CONTEXT_THRESHOLD_TOKENS);

    expect(totals.apiCallCount).toBe(1);
    expect(totals.inputTokens).toBe(0);
    expect(totals.outputTokens).toBe(9);
  });

  test('a fractional or negative usage count reads as zero, like any other count that is not whole', () => {
    const transcript = JSON.stringify({
      type:    'assistant',
      message: { id: 'msg_one', usage: { input_tokens: 10.5, cache_read_input_tokens: -4, output_tokens: 9 } },
    });

    const totals = usageTotalsOf(transcript, OVERSIZED_CONTEXT_THRESHOLD_TOKENS);

    expect(totals.apiCallCount).toBe(1);
    expect(totals.inputTokens).toBe(0);
    expect(totals.cacheReadInputTokens).toBe(0);
    expect(totals.outputTokens).toBe(9);
    expect(totals.endContextTokens).toBe(0);
  });

  /** Zero calls is a verdict a caller acts on, so it has to come back as zero and not as a throw. */
  test('an empty transcript answers zero calls and zero of everything', () => {
    expect(usageTotalsOf('', OVERSIZED_CONTEXT_THRESHOLD_TOKENS)).toEqual({
      apiCallCount:             0,
      inputTokens:              0,
      cacheReadInputTokens:     0,
      cacheCreationInputTokens: 0,
      outputTokens:             0,
      endContextTokens:         0,
      oversizedContextTokens:   0,
    });
  });
});

/**
 * The share of an agent's bill that was spent on calls made at a context above 200,000 tokens, which
 * is the figure that shows a brief being breached without anyone reading the transcript. It is summed
 * per call and not per line, so the dedup of the totals is pinned here a second time from its own side.
 */
describe('the tokens spent at an oversized context', () => {
  test('a call whose context passes 200,000 contributes its whole context, and a smaller one contributes nothing', () => {
    const transcript = [
      assistantLine('msg_small', { input_tokens: 1_000, cache_read_input_tokens: 50_000, output_tokens: 10 }),
      assistantLine('msg_large', { input_tokens: 1_000, cache_read_input_tokens: 200_000, output_tokens: 10 }),
    ].join('\n');

    expect(usageTotalsOf(transcript, OVERSIZED_CONTEXT_THRESHOLD_TOKENS).oversizedContextTokens).toBe(201_000);
  });

  test('a context of exactly 200,000 is not oversized, because the bound is one the call has to pass', () => {
    const transcript = assistantLine('msg_one', { input_tokens: 100_000, cache_read_input_tokens: 100_000, output_tokens: 10 });

    expect(usageTotalsOf(transcript, OVERSIZED_CONTEXT_THRESHOLD_TOKENS).oversizedContextTokens).toBe(0);
  });

  test('the three lines of one oversized call contribute it once, exactly as the totals count it once', () => {
    const oversizedUsage = {
      input_tokens:                2_000,
      cache_read_input_tokens:     300_000,
      cache_creation_input_tokens: 500,
      output_tokens:               10,
    };
    const transcript = [
      assistantLine('msg_one', oversizedUsage),
      assistantLine('msg_one', oversizedUsage),
      assistantLine('msg_one', oversizedUsage),
    ].join('\n');

    expect(usageTotalsOf(transcript, OVERSIZED_CONTEXT_THRESHOLD_TOKENS).oversizedContextTokens).toBe(302_500);
  });
});

/**
 * The profile is what a caller compares agents by, so each field is pinned on its
 * own against a constructed transcript, including the two that are easy to read off the wrong place:
 * the excerpt, which must come from the brief and not from an attachment stapled to the same turn,
 * and the injected characters, which must be counted wherever the attachment happens to be nested.
 */
describe('the profile of a whole transcript', () => {
  const NESTED_INSTRUCTIONS = '# CLAUDE.md\nThe rules of this folder.';

  function userLineWithAttachment(briefText: string): string {
    return JSON.stringify({
      type:      'user',
      timestamp: '2026-09-19T08:55:00.000Z',
      message:   {
        content: [
          { type: 'nested_memory', content: { path: 'lib/CLAUDE.md', content: NESTED_INSTRUCTIONS } },
          { type: 'text', text: briefText },
        ],
      },
    });
  }

  function bashLine(commands: readonly string[]): string {
    return JSON.stringify({
      type:    'assistant',
      message: {
        id:      'msg_one',
        usage:   {},
        content: commands.map((command) => ({ type: 'tool_use', name: 'Bash', input: { command } })),
      },
    });
  }

  test('it carries the totals, so a caller never has to sum a transcript twice', () => {
    const transcript = assistantLine('msg_one', { input_tokens: 11, cache_read_input_tokens: 900, output_tokens: 42 });

    const profile = transcriptProfileOf(transcript, OVERSIZED_CONTEXT_THRESHOLD_TOKENS, BRIEF_EXCERPT_CHARACTERS);

    expect(profile.apiCallCount).toBe(1);
    expect(profile.inputTokens).toBe(11);
    expect(profile.outputTokens).toBe(42);
    expect(profile.endContextTokens).toBe(911);
  });

  /** The first stamp on any line, not the first assistant one: an agent begins at the turn that briefed it, which is a user line. */
  test('the start is the first timestamp in the file, whatever kind of line carries it', () => {
    const transcript = [
      JSON.stringify({ type: 'user', timestamp: '2026-09-19T08:55:00.000Z', message: { content: 'Do the thing' } }),
      JSON.stringify({ type: 'assistant', timestamp: '2026-09-19T09:30:00.000Z', message: { id: 'msg_one', model: 'claude-opus-5', usage: {} } }),
    ].join('\n');

    expect(transcriptProfileOf(transcript, OVERSIZED_CONTEXT_THRESHOLD_TOKENS, BRIEF_EXCERPT_CHARACTERS).startedAt).toBe('2026-09-19T08:55:00.000Z');
  });

  test('a transcript with no timestamp and no assistant turn answers null for both, rather than the epoch or a guess', () => {
    const profile = transcriptProfileOf(JSON.stringify({ type: 'user', message: { content: 'Do the thing' } }), OVERSIZED_CONTEXT_THRESHOLD_TOKENS, BRIEF_EXCERPT_CHARACTERS);

    expect(profile.startedAt).toBeNull();
    expect(profile.model).toBeNull();
  });

  test('the model is the first assistant message\'s, so a transcript that changed model mid-run still names what it started on', () => {
    const transcript = [
      JSON.stringify({ type: 'assistant', message: { id: 'msg_one', model: 'claude-opus-5', usage: {} } }),
      JSON.stringify({ type: 'assistant', message: { id: 'msg_two', model: 'claude-haiku-4', usage: {} } }),
    ].join('\n');

    expect(transcriptProfileOf(transcript, OVERSIZED_CONTEXT_THRESHOLD_TOKENS, BRIEF_EXCERPT_CHARACTERS).model).toBe('claude-opus-5');
  });

  // A screenshot loop is the shape that costs an agent 40 consecutive calls, and the tool names are the only trace of it.
  test('a browser call is any tool whose name carries Claude_Browser, and nothing else is counted', () => {
    const transcript = JSON.stringify({
      type:    'assistant',
      message: {
        id:      'msg_one',
        usage:   {},
        content: [
          { type: 'tool_use', name: 'mcp__Claude_Browser__navigate' },
          { type: 'tool_use', name: 'mcp__Claude_Browser__computer' },
          { type: 'tool_use', name: 'Read' },
          { type: 'text', text: 'Taking a screenshot' },
        ],
      },
    });

    expect(transcriptProfileOf(transcript, OVERSIZED_CONTEXT_THRESHOLD_TOKENS, BRIEF_EXCERPT_CHARACTERS).browserCallCount).toBe(2);
  });

  test('a Bash command that writes through a heredoc, an inline interpreter or an in-place editor is an edit script, and one that reads is not', () => {
    const transcript = bashLine([
      'cat <<EOF > lib/Thing.ts\nexport const thing = 1;\nEOF',
      'python3 -c "open(\'lib/Thing.ts\', \'w\').write(\'x\')"',
      'sed -i \'\' s/one/two/ lib/Thing.ts',
      'rg --files lib',
    ]);

    expect(transcriptProfileOf(transcript, OVERSIZED_CONTEXT_THRESHOLD_TOKENS, BRIEF_EXCERPT_CHARACTERS).bashEditScriptCount).toBe(3);
  });

  /** A command can be a heredoc fed to an interpreter, which is one edit and must not be counted as two. */
  test('a command matching several of the edit-script patterns at once counts once', () => {
    const transcript = bashLine(['python3 - <<EOF\nopen("lib/Thing.ts", "w").write("x")\nEOF']);

    expect(transcriptProfileOf(transcript, OVERSIZED_CONTEXT_THRESHOLD_TOKENS, BRIEF_EXCERPT_CHARACTERS).bashEditScriptCount).toBe(1);
  });

  test('a test suite, a type checker and a linter each count as a verification run, and a chain of all three counts once', () => {
    const transcript = bashLine([
      'bun test lib/utils',
      'bun run typecheck',
      'npx tsc --noEmit && eslint . && pytest',
      'git status',
    ]);

    expect(transcriptProfileOf(transcript, OVERSIZED_CONTEXT_THRESHOLD_TOKENS, BRIEF_EXCERPT_CHARACTERS).verificationRunCount).toBe(3);
  });

  /** Only the `Bash` tool's own commands: a file the agent read that happens to contain `bun test` is not a run of it. */
  test('a tool that is not Bash counts towards neither figure, however its input reads', () => {
    const transcript = JSON.stringify({
      type:    'assistant',
      message: { id: 'msg_one', usage: {}, content: [{ type: 'tool_use', name: 'Read', input: { command: 'bun test && sed -i s/a/b/ x' } }] },
    });

    const profile = transcriptProfileOf(transcript, OVERSIZED_CONTEXT_THRESHOLD_TOKENS, BRIEF_EXCERPT_CHARACTERS);

    expect(profile.bashEditScriptCount).toBe(0);
    expect(profile.verificationRunCount).toBe(0);
  });

  test('the injected characters are the attachment\'s text, summed across turns and found however deeply it is nested', () => {
    const transcript = [userLineWithAttachment('Do the thing'), userLineWithAttachment('And the other thing')].join('\n');

    expect(transcriptProfileOf(transcript, OVERSIZED_CONTEXT_THRESHOLD_TOKENS, BRIEF_EXCERPT_CHARACTERS).nestedInstructionCharacters).toBe(NESTED_INSTRUCTIONS.length * 2);
  });

  /** The shape every real attachment was found in: a line of its own, of type `attachment`, with the object beside the message rather than inside one. */
  test('an attachment on a line of its own is counted, which is where the harness actually puts them', () => {
    const transcript = JSON.stringify({
      type:       'attachment',
      timestamp:  '2026-09-19T08:55:00.000Z',
      attachment: { type: 'nested_memory', path: 'lib/CLAUDE.md', content: { path: 'lib/CLAUDE.md', content: NESTED_INSTRUCTIONS } },
    });

    expect(transcriptProfileOf(transcript, OVERSIZED_CONTEXT_THRESHOLD_TOKENS, BRIEF_EXCERPT_CHARACTERS).nestedInstructionCharacters).toBe(NESTED_INSTRUCTIONS.length);
  });

  /** An agent that writes the word `nested_memory` in its own prose must not be read as having been handed one. */
  test('a line that merely mentions the attachment type in its text counts nothing', () => {
    const transcript = JSON.stringify({
      type:    'assistant',
      message: { id: 'msg_one', usage: {}, content: [{ type: 'text', text: 'The harness marks them "type":"nested_memory" and I counted 4000 characters.' }] },
    });

    expect(transcriptProfileOf(transcript, OVERSIZED_CONTEXT_THRESHOLD_TOKENS, BRIEF_EXCERPT_CHARACTERS).nestedInstructionCharacters).toBe(0);
  });

  test('a transcript with no attachments counts zero injected characters rather than the whole user turn', () => {
    const transcript = JSON.stringify({ type: 'user', message: { content: 'Do the thing' } });

    expect(transcriptProfileOf(transcript, OVERSIZED_CONTEXT_THRESHOLD_TOKENS, BRIEF_EXCERPT_CHARACTERS).nestedInstructionCharacters).toBe(0);
  });

  /** The load-bearing direction: the opening line of a real subagent transcript is routinely attachments plus the brief, in that order. */
  test('the excerpt is the brief and never the CLAUDE.md the harness stapled to the same turn', () => {
    expect(transcriptProfileOf(userLineWithAttachment('Do the thing'), OVERSIZED_CONTEXT_THRESHOLD_TOKENS, BRIEF_EXCERPT_CHARACTERS).briefExcerpt).toBe('Do the thing');
  });

  test('the excerpt is one line cut to the length the caller asks for', () => {
    const brief      = `Read ${'the file and then '.repeat(12)}stop`;
    const transcript = JSON.stringify({ type: 'user', message: { content: `Read\n\n   ${brief.slice(5)}` } });

    const { briefExcerpt } = transcriptProfileOf(transcript, OVERSIZED_CONTEXT_THRESHOLD_TOKENS, BRIEF_EXCERPT_CHARACTERS);

    expect(briefExcerpt.length).toBe(BRIEF_EXCERPT_CHARACTERS);
    expect(briefExcerpt).not.toContain('\n');
    expect(briefExcerpt.startsWith('Read the file and then')).toBe(true);
  });

  test('a user turn with nothing but attachments is passed over, and the next one supplies the excerpt', () => {
    const transcript = [
      JSON.stringify({ type: 'user', message: { content: [{ type: 'nested_memory', content: { path: 'lib/CLAUDE.md', content: NESTED_INSTRUCTIONS } }] } }),
      JSON.stringify({ type: 'user', message: { content: 'Do the thing' } }),
    ].join('\n');

    expect(transcriptProfileOf(transcript, OVERSIZED_CONTEXT_THRESHOLD_TOKENS, BRIEF_EXCERPT_CHARACTERS).briefExcerpt).toBe('Do the thing');
  });

  test('an empty transcript profiles as zero everywhere and null where there is nothing to name', () => {
    const profile = transcriptProfileOf('', OVERSIZED_CONTEXT_THRESHOLD_TOKENS, BRIEF_EXCERPT_CHARACTERS);

    expect(profile.apiCallCount).toBe(0);
    expect(profile.browserCallCount).toBe(0);
    expect(profile.bashEditScriptCount).toBe(0);
    expect(profile.verificationRunCount).toBe(0);
    expect(profile.oversizedContextTokens).toBe(0);
    expect(profile.nestedInstructionCharacters).toBe(0);
    expect(profile.briefExcerpt).toBe('');
    expect(profile.startedAt).toBeNull();
    expect(profile.model).toBeNull();
  });
});

describe('the total input of a call', () => {
  test('the row figure and the reported input are one number: fresh input plus both cache figures', () => {
    expect(totalInputTokensOf({
      apiCallCount:             2,
      inputTokens:              1000,
      cacheReadInputTokens:     9000,
      cacheCreationInputTokens: 2000,
      outputTokens:             500,
      endContextTokens:         6000,
      oversizedContextTokens:   0,
    })).toBe(12_000);
  });
});

/**
 * A workflow agent's transcript opens with the harness relaying the session user's request and only then the script's prompt, both as plain
 * strings rather than content arrays. What callers rely on: the computed task is read as the brief, and nothing else after a relay ever is.
 */
describe('a workflow agent\'s brief', () => {
  const RELAY_TURN = '[Workflow harness — user request] The harness relays the request below.\n  Run the board.';

  function plainUserLine(text: string): string {
    return JSON.stringify({ type: 'user', message: { role: 'user', content: text } });
  }

  function computedTaskTurn(indentedTask: string): string {
    return `[Workflow harness — computed task] The task text below was computed at runtime.\n${indentedTask}`;
  }

  /** The real shape: the harness's preamble is one column-zero line, and the indented script prompt follows it with no blank line between. */
  test('the excerpt is the script\'s prompt, not the relay and not the harness\'s preamble to it', () => {
    const transcript = [plainUserLine(RELAY_TURN), plainUserLine(computedTaskTurn('  Example task: 42\n  Worktree: /tmp/example   Branch: example-042'))].join('\n');

    const { briefExcerpt } = transcriptProfileOf(transcript, OVERSIZED_CONTEXT_THRESHOLD_TOKENS, BRIEF_EXCERPT_CHARACTERS);

    expect(briefExcerpt).toBe('Example task: 42 Worktree: /tmp/example Branch: example-042');
  });

  test('a preamble spanning several lines is removed up to its first blank line', () => {
    const preamble   = '[Workflow harness — computed task] The task text below\nwas computed at runtime.';
    const transcript = [plainUserLine(RELAY_TURN), plainUserLine(`${preamble}\n\n  Build the ticket.`)].join('\n');

    expect(transcriptProfileOf(transcript, OVERSIZED_CONTEXT_THRESHOLD_TOKENS, BRIEF_EXCERPT_CHARACTERS).briefExcerpt).toBe('Build the ticket.');
  });

  test('a relay with no computed task after it has no brief, so its excerpt is empty rather than the relay', () => {
    const transcript = [plainUserLine(RELAY_TURN), plainUserLine('Hello.')].join('\n');

    expect(transcriptProfileOf(transcript, OVERSIZED_CONTEXT_THRESHOLD_TOKENS, BRIEF_EXCERPT_CHARACTERS).briefExcerpt).toBe('');
  });

  /** A workflow run launched with no user request has no relay: its agents open on the computed task, and their rows name the prompt all the same. */
  test('a computed task with no relay before it is excerpted from the script\'s prompt too', () => {
    const transcript = plainUserLine(computedTaskTurn('  Build the ticket.'));

    expect(transcriptProfileOf(transcript, OVERSIZED_CONTEXT_THRESHOLD_TOKENS, BRIEF_EXCERPT_CHARACTERS).briefExcerpt).toBe('Build the ticket.');
  });

  test('an ordinary brief that merely mentions the harness keeps its whole excerpt', () => {
    const transcript = plainUserLine('Explain what [Workflow harness — computed task] means.\n  In short.');

    const { briefExcerpt } = transcriptProfileOf(transcript, OVERSIZED_CONTEXT_THRESHOLD_TOKENS, BRIEF_EXCERPT_CHARACTERS);

    expect(briefExcerpt).toBe('Explain what [Workflow harness — computed task] means. In short.');
  });
});

/**
 * The brief is what a caller reads a marker or an excerpt from, so what matters is which turn it is: never an attachment-only turn,
 * the computed task after a workflow relay, and nothing at all after a relay that is followed by anything else.
 */
describe('the brief a transcript opens with', () => {
  const RELAY_TURN = '[Workflow harness — user request] The harness relays the request below.\n  Run the board.';

  const COMPUTED_TASK_TURN = '[Workflow harness — computed task] The task text below was computed at runtime.\n  Build the ticket.';

  function plainUserLine(text: string): string {
    return JSON.stringify({ type: 'user', message: { role: 'user', content: text } });
  }

  test('a plain first turn is the brief', () => {
    const transcript = [plainUserLine('Do the thing.'), plainUserLine('And then the other thing.')].join('\n');

    expect(briefTextOf(transcript)).toBe('Do the thing.');
  });

  test('an attachment-only turn is passed over, and the turn after it is the brief', () => {
    const transcript = [
      JSON.stringify({ type: 'user', message: { content: [{ type: 'nested_memory', content: { path: 'lib/CLAUDE.md', content: '# CLAUDE.md' } }] } }),
      plainUserLine('Do the thing.'),
    ].join('\n');

    expect(briefTextOf(transcript)).toBe('Do the thing.');
  });

  test('a relay followed by a computed task gives the computed task', () => {
    const transcript = [plainUserLine(RELAY_TURN), plainUserLine(COMPUTED_TASK_TURN)].join('\n');

    expect(briefTextOf(transcript)).toBe(COMPUTED_TASK_TURN);
  });

  test('a relay followed by an ordinary message gives no brief at all', () => {
    const transcript = [plainUserLine(RELAY_TURN), plainUserLine('Do the thing.')].join('\n');

    expect(briefTextOf(transcript)).toBe('');
  });

  test('an empty transcript gives no brief at all', () => {
    expect(briefTextOf('')).toBe('');
  });
});
