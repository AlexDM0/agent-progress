/**
 * The session reader's contract: each prompted agent's totals summed over its models from the newest shutdown naming it, the
 * main conversation and unprompted agents left out, `inputTokens` taken as Copilot reports it (it already holds the cache
 * reads and writes), and a session with no shutdown or an unreadable line told apart from one with no agents.
 */
import { describe, expect, test }                                       from 'bun:test';
import { copilotTokenUsageOf, readCopilotSession, sessionEventsPathOf } from './CopilotSessionEvents.ts';

function eventLine(type: string, data: Record<string, unknown>, agentIdentifier?: string): string {
  return JSON.stringify({ type, data, ...(agentIdentifier === undefined ? {} : { agentId: agentIdentifier }) });
}

function usageOf(inputTokens: number): Record<string, unknown> {
  return {
    requests: { count: 2 },
    usage:    {
      inputTokens, outputTokens: 40, cacheReadTokens: 7, cacheWriteTokens: 3
    }
  };
}

describe('reading a shut-down session', () => {
  test('sums each prompted agent over its models from the newest shutdown, leaving out main and unprompted agents', () => {
    const eventsText = [
      eventLine('user.message', { content: 'agent-progress row: 4' }, 'agent-one'),
      eventLine('user.message', { content: 'a later turn' }, 'agent-one'),
      eventLine('user.message', { content: 'the main prompt' }),
      eventLine('session.shutdown', { agentMetrics: { 'agent-one': { modelMetrics: { 'model-a': usageOf(100) } } } }),
      eventLine('session.shutdown', {
        agentMetrics: {
          'main':       { modelMetrics: { 'model-a': usageOf(999) } },
          'agent-one':  { agentName: 'general-purpose', agentDisplayName: 'builder #4', modelMetrics: { 'model-a': usageOf(300), 'model-b': usageOf(50) } },
          'agent-lone': { modelMetrics: { 'model-a': usageOf(10) } },
        },
      }),
    ].join('\n');

    expect(readCopilotSession(eventsText)).toEqual({
      verdict: 'shut-down',
      agents:  [{
        agentId:      'agent-one',
        agentName:    'general-purpose',
        displayName:  'builder #4',
        prompt:       'agent-progress row: 4',
        requestCount: 4,
        usage:        {
          inputTokens: 350, outputTokens: 80, cacheReadTokens: 14, cacheWriteTokens: 6
        },
      }],
    });
  });

  test('an agent that failed before its first call reads as zero totals', () => {
    const eventsText = [
      eventLine('user.message', { content: 'agent-progress row: 4' }, 'agent-one'),
      eventLine('session.shutdown', { agentMetrics: { 'agent-one': { modelMetrics: {} } } }),
    ].join('\n');

    const reading = readCopilotSession(eventsText);
    expect(reading.verdict === 'shut-down' ? reading.agents[0]?.usage.inputTokens : undefined).toBe(0);
  });
});

describe('a session that cannot be read', () => {
  test('one with no shutdown yet is not shut down', () => {
    expect(readCopilotSession(eventLine('user.message', { content: 'x' }, 'agent-one'))).toEqual({ verdict: 'not-shut-down' });
  });

  test('a line that is not JSON, and a shutdown whose counts are not whole, are malformed at their line', () => {
    expect(readCopilotSession(`${eventLine('session.start', {})}\n{"type":`)).toEqual({ verdict: 'malformed', lineNumber: 2 });
    const fractional = eventLine('session.shutdown', { agentMetrics: { 'agent-one': { modelMetrics: { 'model-a': usageOf(1.5) } } } });
    expect(readCopilotSession(fractional)).toEqual({ verdict: 'malformed', lineNumber: 1 });
  });
});

describe('the edges', () => {
  test('a session id holding a path step has no events path', () => {
    expect(sessionEventsPathOf('/home/example', '../other')).toBeUndefined();
    expect(sessionEventsPathOf('/home/example', 'a/b')).toBeUndefined();
    expect(sessionEventsPathOf('/home/example', 'abc-123')).toBe('/home/example/.copilot/session-state/abc-123/events.jsonl');
  });

  test('a usage object reads a missing count as zero and refuses a negative or fractional one', () => {
    expect(copilotTokenUsageOf({ inputTokens: 5 })).toEqual({
      inputTokens: 5, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0
    });
    expect(copilotTokenUsageOf({ inputTokens: -1 })).toBeUndefined();
    expect(copilotTokenUsageOf({ inputTokens: 0.5 })).toBeUndefined();
    expect(copilotTokenUsageOf(null)).toBeUndefined();
  });
});
