/**
 * Token crediting by message id. What matters: the live stream and a transcript replay of the same session credit each API call once,
 * whatever order they arrive in; repeated lines of one call count its input once and its largest output; a subagent's turns are grouped
 * under the tool call that started it and kept out of the top-level calls a budget counts; and a stop already logged credits only growth.
 */
import { describe, expect, test }            from 'bun:test';
import type { LogRecord }                    from '../../lib/tracker-model/@types/LogRecord.ts';
import { type CreditedTurn, TokenCrediting } from './TokenCrediting.ts';

function turn(messageId: string, parentToolUseId: string | null, inputTokens: number, outputTokens: number): CreditedTurn {
  return {
    messageId,
    parentToolUseId,
    usage: {
      inputTokens, outputTokens, cacheCreationInputTokens: 10, cacheReadInputTokens: 100
    }
  };
}

const LIVE_TURNS: readonly CreditedTurn[] = [
  turn('message-1', null, 5, 20),
  turn('message-2', null, 7, 30),
  turn('message-3', 'tool-use-a', 3, 40),
  turn('message-4', 'tool-use-b', 2, 50),
];

describe('sessionTokensOf', () => {
  test('a live total and a transcript replay of the same session credit each call once', () => {
    const liveOnly = TokenCrediting.sessionTokensOf(LIVE_TURNS);
    const withReplay = TokenCrediting.sessionTokensOf([...LIVE_TURNS, ...[...LIVE_TURNS].reverse()]);
    expect(withReplay).toEqual(liveOnly);
    expect(liveOnly.total).toEqual({
      calls: 4, inputTokens: 17, outputTokens: 140, cacheCreationInputTokens: 40, cacheReadInputTokens: 400
    });
  });

  test('the lines of one call count its input once and its largest output', () => {
    const sessionTokens = TokenCrediting.sessionTokensOf([turn('message-1', null, 5, 1), turn('message-1', null, 5, 20), turn('message-1', null, 5, 9)]);
    expect(sessionTokens.total).toMatchObject({ calls: 1, inputTokens: 5, outputTokens: 20 });
  });

  test('subagent turns group by parent_tool_use_id and stay out of the top-level calls', () => {
    const sessionTokens = TokenCrediting.sessionTokensOf(LIVE_TURNS);
    expect(sessionTokens.topLevel).toMatchObject({ calls: 2, inputTokens: 12, outputTokens: 50 });
    expect(Object.keys(sessionTokens.subagents)).toEqual(['tool-use-a', 'tool-use-b']);
    expect(sessionTokens.subagents['tool-use-a']).toMatchObject({ calls: 1, inputTokens: 3, outputTokens: 40 });
  });

  test('a turn without usage is a call that adds no tokens', () => {
    expect(TokenCrediting.sessionTokensOf([{ messageId: 'message-9', parentToolUseId: null, usage: null }]).total).toMatchObject({ calls: 1, inputTokens: 0 });
  });
});

describe('tokensStillToCreditOf', () => {
  function stopped(agentId: string, totalInputTokens: number): LogRecord {
    return {
      at:     '2026-11-01T21:00:00+01:00',
      kind:   'agent-stopped',
      fields: {
        agentId, agentType: 'builder', apiCallCount: 1, endContextTokens: 0, totalInputTokens, cacheReadInputTokens: 0, outputTokens: 0
      },
    } as LogRecord;
  }

  test('a new agent is credited whole, a resumed one only its growth, and a replayed stop nothing', () => {
    expect(TokenCrediting.tokensStillToCreditOf({ agentId: 'session-1', totalInputTokens: 900 }, [])).toBe(900);
    expect(TokenCrediting.tokensStillToCreditOf({ agentId: 'session-1', totalInputTokens: 900 }, [stopped('session-1', 600), stopped('other', 5000)])).toBe(300);
    expect(TokenCrediting.tokensStillToCreditOf({ agentId: 'session-1', totalInputTokens: 900 }, [stopped('session-1', 900)])).toBe(0);
  });
});
