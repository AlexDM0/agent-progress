/**
 * The one rule this module exists for — a call is a `message.id`, not a line — and the four shapes a
 * real transcript carries that would otherwise be read as an error: a line that is not JSON, an entry
 * that is not an assistant turn, an assistant turn with no usage, and a message with no id at all.
 * Every transcript here is constructed, because the claim is about the arithmetic and not about any
 * particular recorded session.
 */
import { describe, expect, test } from 'bun:test';

import { TranscriptUsageUtil } from './TranscriptUsageUtil';

const {
  composeUsageLine,
  evenSharesOf,
  profileTranscript,
  reviewedTicketIdentifierNamedInBrief,
  rowIdentifiersNamedInBrief,
  summariseTranscriptUsage,
  ticketIdentifiersNamedInBrief,
  totalInputTokensOf,
} = TranscriptUsageUtil;

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
        input_tokens: 12, cache_read_input_tokens: 400, cache_creation_input_tokens: 80, output_tokens: 5 
      }),
      assistantLine('msg_one', {
        input_tokens: 12, cache_read_input_tokens: 400, cache_creation_input_tokens: 80, output_tokens: 90 
      }),
      assistantLine('msg_one', {
        input_tokens: 12, cache_read_input_tokens: 400, cache_creation_input_tokens: 80, output_tokens: 140 
      }),
    ].join('\n');

    const totals = summariseTranscriptUsage(transcript);

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

    const totals = summariseTranscriptUsage(transcript);

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

    const totals = summariseTranscriptUsage(transcript);

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

    expect(summariseTranscriptUsage(transcript).endContextTokens).toBe(927);
  });
});

describe('the lines a transcript carries that are not calls', () => {
  test('a message with no id is still one call, rather than being dropped or folded into another', () => {
    const transcript = assistantLine(null, { input_tokens: 15, output_tokens: 25 });

    const totals = summariseTranscriptUsage(transcript);

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

    const totals = summariseTranscriptUsage(transcript);

    expect(totals.apiCallCount).toBe(1);
    expect(totals.inputTokens).toBe(7);
  });

  test('a usage field that is missing or not a number reads as zero rather than as a broken transcript', () => {
    const transcript = JSON.stringify({ type: 'assistant', message: { id: 'msg_one', usage: { input_tokens: 'lots', output_tokens: 9 } } });

    const totals = summariseTranscriptUsage(transcript);

    expect(totals.apiCallCount).toBe(1);
    expect(totals.inputTokens).toBe(0);
    expect(totals.outputTokens).toBe(9);
  });

  /** Zero calls is the verdict the hook reports instead of logging a line of noughts, so it has to come back as zero and not as a throw. */
  test('an empty transcript answers zero calls and zero of everything', () => {
    expect(summariseTranscriptUsage('')).toEqual({
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

    expect(summariseTranscriptUsage(transcript).oversizedContextTokens).toBe(201_000);
  });

  test('a context of exactly 200,000 is not oversized, because the bound is one the call has to pass', () => {
    const transcript = assistantLine('msg_one', { input_tokens: 100_000, cache_read_input_tokens: 100_000, output_tokens: 10 });

    expect(summariseTranscriptUsage(transcript).oversizedContextTokens).toBe(0);
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

    expect(summariseTranscriptUsage(transcript).oversizedContextTokens).toBe(302_500);
  });
});

/**
 * The profile is what `cli/usage/UsageCommand.ts` compares agents by, so each field is pinned on its
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

    const profile = profileTranscript(transcript);

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

    expect(profileTranscript(transcript).startedAt).toBe('2026-09-19T08:55:00.000Z');
  });

  test('a transcript with no timestamp and no assistant turn answers null for both, rather than the epoch or a guess', () => {
    const profile = profileTranscript(JSON.stringify({ type: 'user', message: { content: 'Do the thing' } }));

    expect(profile.startedAt).toBeNull();
    expect(profile.model).toBeNull();
  });

  test('the model is the first assistant message\'s, so a transcript that changed model mid-run still names what it started on', () => {
    const transcript = [
      JSON.stringify({ type: 'assistant', message: { id: 'msg_one', model: 'claude-opus-5', usage: {} } }),
      JSON.stringify({ type: 'assistant', message: { id: 'msg_two', model: 'claude-haiku-4', usage: {} } }),
    ].join('\n');

    expect(profileTranscript(transcript).model).toBe('claude-opus-5');
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

    expect(profileTranscript(transcript).browserCallCount).toBe(2);
  });

  test('a Bash command that writes through a heredoc, an inline interpreter or an in-place editor is an edit script, and one that reads is not', () => {
    const transcript = bashLine([
      'cat <<EOF > lib/Thing.ts\nexport const thing = 1;\nEOF',
      'python3 -c "open(\'lib/Thing.ts\', \'w\').write(\'x\')"',
      'sed -i \'\' s/one/two/ lib/Thing.ts',
      'rg --files lib',
    ]);

    expect(profileTranscript(transcript).bashEditScriptCount).toBe(3);
  });

  /** A command can be a heredoc fed to an interpreter, which is one edit and must not be counted as two. */
  test('a command matching several of the edit-script patterns at once counts once', () => {
    const transcript = bashLine(['python3 - <<EOF\nopen("lib/Thing.ts", "w").write("x")\nEOF']);

    expect(profileTranscript(transcript).bashEditScriptCount).toBe(1);
  });

  test('a test suite, a type checker and a linter each count as a verification run, and a chain of all three counts once', () => {
    const transcript = bashLine([
      'bun test lib/utils',
      'bun run typecheck',
      'npx tsc --noEmit && eslint . && pytest',
      'git status',
    ]);

    expect(profileTranscript(transcript).verificationRunCount).toBe(3);
  });

  /** Only the `Bash` tool's own commands: a file the agent read that happens to contain `bun test` is not a run of it. */
  test('a tool that is not Bash counts towards neither figure, however its input reads', () => {
    const transcript = JSON.stringify({
      type:    'assistant',
      message: { id: 'msg_one', usage: {}, content: [{ type: 'tool_use', name: 'Read', input: { command: 'bun test && sed -i s/a/b/ x' } }] },
    });

    const profile = profileTranscript(transcript);

    expect(profile.bashEditScriptCount).toBe(0);
    expect(profile.verificationRunCount).toBe(0);
  });

  test('the injected characters are the attachment\'s text, summed across turns and found however deeply it is nested', () => {
    const transcript = [userLineWithAttachment('Do the thing'), userLineWithAttachment('And the other thing')].join('\n');

    expect(profileTranscript(transcript).nestedInstructionCharacters).toBe(NESTED_INSTRUCTIONS.length * 2);
  });

  /** The shape every real attachment was found in: a line of its own, of type `attachment`, with the object beside the message rather than inside one. */
  test('an attachment on a line of its own is counted, which is where the harness actually puts them', () => {
    const transcript = JSON.stringify({
      type:       'attachment',
      timestamp:  '2026-09-19T08:55:00.000Z',
      attachment: { type: 'nested_memory', path: 'lib/CLAUDE.md', content: { path: 'lib/CLAUDE.md', content: NESTED_INSTRUCTIONS } },
    });

    expect(profileTranscript(transcript).nestedInstructionCharacters).toBe(NESTED_INSTRUCTIONS.length);
  });

  /** An agent that writes the word `nested_memory` in its own prose must not be read as having been handed one. */
  test('a line that merely mentions the attachment type in its text counts nothing', () => {
    const transcript = JSON.stringify({
      type:    'assistant',
      message: { id: 'msg_one', usage: {}, content: [{ type: 'text', text: 'The harness marks them "type":"nested_memory" and I counted 4000 characters.' }] },
    });

    expect(profileTranscript(transcript).nestedInstructionCharacters).toBe(0);
  });

  test('a transcript with no attachments counts zero injected characters rather than the whole user turn', () => {
    const transcript = JSON.stringify({ type: 'user', message: { content: 'Do the thing' } });

    expect(profileTranscript(transcript).nestedInstructionCharacters).toBe(0);
  });

  /** The load-bearing direction: the opening line of a real subagent transcript is routinely attachments plus the brief, in that order. */
  test('the excerpt is the brief and never the CLAUDE.md the harness stapled to the same turn', () => {
    expect(profileTranscript(userLineWithAttachment('Do the thing')).briefExcerpt).toBe('Do the thing');
  });

  test('the excerpt is one line of at most 80 characters, so a row stays a row', () => {
    const brief      = `Read ${'the file and then '.repeat(12)}stop`;
    const transcript = JSON.stringify({ type: 'user', message: { content: `Read\n\n   ${brief.slice(5)}` } });

    const { briefExcerpt } = profileTranscript(transcript);

    expect(briefExcerpt.length).toBe(80);
    expect(briefExcerpt).not.toContain('\n');
    expect(briefExcerpt.startsWith('Read the file and then')).toBe(true);
  });

  test('a user turn with nothing but attachments is passed over, and the next one supplies the excerpt', () => {
    const transcript = [
      JSON.stringify({ type: 'user', message: { content: [{ type: 'nested_memory', content: { path: 'lib/CLAUDE.md', content: NESTED_INSTRUCTIONS } }] } }),
      JSON.stringify({ type: 'user', message: { content: 'Do the thing' } }),
    ].join('\n');

    expect(profileTranscript(transcript).briefExcerpt).toBe('Do the thing');
  });

  test('an empty transcript profiles as zero everywhere and null where there is nothing to name', () => {
    const profile = profileTranscript('');

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

describe('the line the log receives', () => {
  test('it names the agent, the call count and the three figures, in the units the chart uses', () => {
    const line = composeUsageLine('agent_42', 'general-purpose', {
      apiCallCount:             32,
      inputTokens:              20_000,
      cacheReadInputTokens:     4_500_000,
      cacheCreationInputTokens: 280_000,
      outputTokens:             48_000,
      endContextTokens:         165_000,
      oversizedContextTokens:   0,
    });

    expect(line).toBe('Agent agent_42 (general-purpose) stopped: 32 calls, end context 165k, input 4.8M (cache read 4.5M), output 48k');
  });

  /** The cache-read share is what explains a long session; a plain input total hides it, which is why it is named separately. */
  test('the input figure is the whole of what was sent, so it is never smaller than the cache-read share beside it', () => {
    const line = composeUsageLine('agent_1', 'Explore', {
      apiCallCount:             2,
      inputTokens:              1000,
      cacheReadInputTokens:     9000,
      cacheCreationInputTokens: 2000,
      outputTokens:             500,
      endContextTokens:         6000,
      oversizedContextTokens:   0,
    });

    expect(line).toContain('input 12k (cache read 9k)');
    expect(line).toContain('output 500');
  });

  test('the row figure and the log line\'s input are one number: fresh input plus both cache figures', () => {
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
 * The marker decides which row an agent's cost lands on, so what matters is what must NOT count: a marker
 * quoted after the brief, a template placeholder, and an attachment turn standing in front of the brief.
 */
describe('the rows a brief names', () => {
  function userTextLine(text: string): string {
    return JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text }] } });
  }

  test('one id, or several separated by commas, are read in the order written', () => {
    expect(rowIdentifiersNamedInBrief(userTextLine('Do it.\nagent-progress row: 4\nStop.'))).toEqual([4]);
    expect(rowIdentifiersNamedInBrief(userTextLine('agent-progress row: 4, 7'))).toEqual([4, 7]);
    expect(rowIdentifiersNamedInBrief(userTextLine('  agent-progress row: 7,4,4  '))).toEqual([7, 4]);
  });

  /** A reviewer may be shown the builder's brief; the marker it quotes is the builder's row, not its own. */
  test('a marker in a later user turn is not the brief\'s, so it names nothing', () => {
    const transcript = [userTextLine('Review the branch.'), userTextLine('agent-progress row: 4')].join('\n');

    expect(rowIdentifiersNamedInBrief(transcript)).toEqual([]);
  });

  test('an attachment-only opening turn is passed over, as for the excerpt, and the brief after it is read', () => {
    const transcript = [
      JSON.stringify({ type: 'user', message: { content: [{ type: 'nested_memory', content: { path: 'lib/CLAUDE.md', content: 'agent-progress row: 9' } }] } }),
      userTextLine('agent-progress row: 4'),
    ].join('\n');

    expect(rowIdentifiersNamedInBrief(transcript)).toEqual([4]);
  });

  test('a placeholder, a marker inside a sentence and a brief without one all name nothing', () => {
    expect(rowIdentifiersNamedInBrief(userTextLine('agent-progress row: <rowId>'))).toEqual([]);
    expect(rowIdentifiersNamedInBrief(userTextLine('Write agent-progress row: 4 into the brief.'))).toEqual([]);
    expect(rowIdentifiersNamedInBrief(userTextLine('Do the work.'))).toEqual([]);
    expect(rowIdentifiersNamedInBrief('')).toEqual([]);
  });

  test('a brief split over several text blocks is read line by line, so a marker in the second block counts', () => {
    const transcript = JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: 'Do it.' }, { type: 'text', text: 'agent-progress row: 4' }] } });

    expect(rowIdentifiersNamedInBrief(transcript)).toEqual([4]);
  });
});

/**
 * The ticket form exists for a low ticket whose row the builder's own claim creates, so the ids are only
 * read here and resolved later. What callers rely on: padded, unpadded and `#` spellings all come back as
 * the stored padded id, and the brief-only rule is the row form's.
 */
describe('the tickets a brief names', () => {
  function userTextLine(text: string): string {
    return JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text }] } });
  }

  test('padded, unpadded and hash-prefixed ids all read as the padded id, in the order written and each once', () => {
    expect(ticketIdentifiersNamedInBrief(userTextLine('Do it.\nagent-progress ticket: 22\nStop.'))).toEqual(['022']);
    expect(ticketIdentifiersNamedInBrief(userTextLine('agent-progress ticket: 022, 20'))).toEqual(['022', '020']);
    expect(ticketIdentifiersNamedInBrief(userTextLine('  agent-progress ticket: #20,22,022  '))).toEqual(['020', '022']);
  });

  test('a marker in a later user turn is not the brief\'s, so it names nothing', () => {
    const transcript = [userTextLine('Review the branch.'), userTextLine('agent-progress ticket: 22')].join('\n');

    expect(ticketIdentifiersNamedInBrief(transcript)).toEqual([]);
  });

  test('a placeholder, a marker inside a sentence, ticket zero and the row form all name no ticket', () => {
    expect(ticketIdentifiersNamedInBrief(userTextLine('agent-progress ticket: <id>'))).toEqual([]);
    expect(ticketIdentifiersNamedInBrief(userTextLine('Write agent-progress ticket: 22 into the brief.'))).toEqual([]);
    expect(ticketIdentifiersNamedInBrief(userTextLine('agent-progress ticket: 0'))).toEqual([]);
    expect(ticketIdentifiersNamedInBrief(userTextLine('agent-progress row: 22'))).toEqual([]);
  });

  test('a brief carrying both lines answers each reader with its own', () => {
    const transcript = userTextLine('agent-progress row: 4\nagent-progress ticket: 22');

    expect(rowIdentifiersNamedInBrief(transcript)).toEqual([4]);
    expect(ticketIdentifiersNamedInBrief(transcript)).toEqual(['022']);
  });
});

/**
 * The review form names one ticket whose review row the reviewer files itself after its brief was written; the hook resolves the row.
 * What callers rely on: the padded id in every spelling, the brief-only rule, and a list or a placeholder naming nothing rather than a guess.
 */
describe('the ticket a reviewer\'s brief names', () => {
  function userTextLine(text: string): string {
    return JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text }] } });
  }

  test('padded, unpadded and hash-prefixed ids all read as the padded id', () => {
    expect(reviewedTicketIdentifierNamedInBrief(userTextLine('Review it.\nagent-progress review: 7\nStop.'))).toBe('007');
    expect(reviewedTicketIdentifierNamedInBrief(userTextLine('  agent-progress review: #007  '))).toBe('007');
  });

  test('a marker in a later user turn is not the brief\'s, so it names nothing', () => {
    const transcript = [userTextLine('Review the branch.'), userTextLine('agent-progress review: 7')].join('\n');

    expect(reviewedTicketIdentifierNamedInBrief(transcript)).toBeNull();
  });

  test('a placeholder, a list, ticket zero and the other two forms all name no ticket', () => {
    expect(reviewedTicketIdentifierNamedInBrief(userTextLine('agent-progress review: <ticketId>'))).toBeNull();
    expect(reviewedTicketIdentifierNamedInBrief(userTextLine('agent-progress review: 7, 8'))).toBeNull();
    expect(reviewedTicketIdentifierNamedInBrief(userTextLine('agent-progress review: 0'))).toBeNull();
    expect(reviewedTicketIdentifierNamedInBrief(userTextLine('agent-progress ticket: 7\nagent-progress row: 7'))).toBeNull();
  });
});

describe('dividing a bundle\'s tokens', () => {
  test('the shares are floored and the remainder goes to the first, so they always sum to the total', () => {
    expect(evenSharesOf(1001, 2)).toEqual([501, 500]);
    expect(evenSharesOf(10, 3)).toEqual([4, 3, 3]);
    expect(evenSharesOf(1001, 1)).toEqual([1001]);
  });

  test('no rows means no shares', () => {
    expect(evenSharesOf(1001, 0)).toEqual([]);
  });
});
