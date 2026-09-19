/**
 * The one rule this module exists for — a call is a `message.id`, not a line — and the four shapes a
 * real transcript carries that would otherwise be read as an error: a line that is not JSON, an entry
 * that is not an assistant turn, an assistant turn with no usage, and a message with no id at all.
 * Every transcript here is constructed, because the claim is about the arithmetic and not about any
 * particular recorded session.
 */
import { describe, expect, test } from 'bun:test';

import { TranscriptUsageUtil } from './TranscriptUsageUtil';

const { composeUsageLine, profileTranscript, summariseTranscriptUsage } = TranscriptUsageUtil;

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
    });
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
    });

    expect(line).toContain('input 12k (cache read 9k)');
    expect(line).toContain('output 500');
  });
});
