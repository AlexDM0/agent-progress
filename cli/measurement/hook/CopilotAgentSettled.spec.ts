/**
 * The Copilot CLI crediting path. What matters is that a Copilot agent's tokens land once: the extension sends running totals and
 * a startup reconcile replays a whole session, so a repeat must add nothing and a grown total only its difference. The tracker is
 * found from the input's `repositoryRoot`, never from where the command ran, and every failure exits 0 with one report line and an
 * untouched tracker, as for `hook subagent-stop`.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join }                                   from 'node:path';

import {
  afterEach,
  beforeEach,
  expect,
  test
}                                                         from 'bun:test';
import { createScratchDirectory, removeScratchDirectory } from '../../../src/testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent }                       from '../../../src/testing/ToolGuard.ts';
import { runCommandLine }                                 from '../../Main.ts';
import { createCapturedCommandContext }                   from '../../testing/CapturedCommandContext.ts';
import { createInitializedScratchRepository }             from '../../testing/InitializedScratchRepository.ts';
import { storedLogEntriesOf }                             from '../../testing/StoredLogEntries.ts';
import { storedProgressOf }                               from '../../testing/StoredProgress.ts';

const FROZEN_NOW = new Date('2026-10-07T09:30:00Z');

const SESSION_IDENTIFIER = 'example-session-1';

let repositoryDirectory = '';
let elsewhereDirectory  = '';

function contextWith(standardInputText: string): ReturnType<typeof createCapturedCommandContext> {
  return createCapturedCommandContext({
    currentDirectory: elsewhereDirectory, now: () => FROZEN_NOW, standardInputText, homeDirectory: join(elsewhereDirectory, 'home')
  });
}

function settledInput(prompt: string, inputTokens: number, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    repositoryRoot: repositoryDirectory,
    sessionId:      SESSION_IDENTIFIER,
    agentId:        'copilot-agent-1',
    label:          'builder #1',
    prompt,
    outcome:        'completed',
    usage:          {
      inputTokens, outputTokens: 300, cacheReadTokens: inputTokens - 100, cacheWriteTokens: 50
    },
    ...overrides,
  });
}

async function addedRow(name: string): Promise<number> {
  expect(await runCommandLine(['task', 'add', name], createCapturedCommandContext({ currentDirectory: repositoryDirectory, now: () => FROZEN_NOW }))).toBe(0);
  const rowIdentifier = storedProgressOf(repositoryDirectory).tasks.at(-1)?.id;
  if (rowIdentifier === undefined) throw new Error(`task add "${name}" filed no row`);
  return rowIdentifier;
}

function storedTokensOf(rowIdentifier: number): number | null | undefined {
  return storedProgressOf(repositoryDirectory).tasks.find((task) => task.id === rowIdentifier)?.tokens;
}

function storedTrackerText(): string {
  const trackerFolder = join(repositoryDirectory, '.agent-progress');
  return ['progress.json', 'log.jsonl'].map((fileName) => {
    try {
      return readFileSync(join(trackerFolder, fileName), 'utf8');
    } catch {
      return '';
    }
  }).join('\n---\n');
}

function eventLine(type: string, data: Record<string, unknown>, agentIdentifier?: string): string {
  return JSON.stringify({
    type, data, id: `event-${type}`, parentId: null, timestamp: '2026-10-07T09:00:00.000Z', ...(agentIdentifier === undefined ? {} : { agentId: agentIdentifier })
  });
}

function modelMetricsOf(inputTokens: number, requestCount: number): Record<string, unknown> {
  return {
    'example-model': {
      requests: { count: requestCount, cost: 0 },
      usage:    {
        inputTokens, outputTokens: 200, cacheReadTokens: inputTokens - 10, cacheWriteTokens: 5, reasoningTokens: 0
      },
    },
  };
}

/** Two agents with a marker each, one that failed before its first call, and the main conversation, which holds no prompt of its own. */
function writeSessionEvents(firstRow: number, secondRow: number): void {
  const sessionFolder = join(elsewhereDirectory, 'home', '.copilot', 'session-state', SESSION_IDENTIFIER);
  mkdirSync(sessionFolder, { recursive: true });
  writeFileSync(join(sessionFolder, 'events.jsonl'), `${[
    eventLine('session.start', { sessionId: SESSION_IDENTIFIER }),
    eventLine('user.message', { content: `Build it.\nagent-progress row: ${firstRow}` }, 'agent-one'),
    eventLine('user.message', { content: `Review it.\nagent-progress row: ${secondRow}` }, 'agent-two'),
    eventLine('user.message', { content: 'Fail at once.' }, 'agent-failed'),
    eventLine('session.shutdown', {
      shutdownType: 'routine',
      agentMetrics: {
        'main':         { agentName: 'main', modelMetrics: modelMetricsOf(5000, 1) },
        'agent-one':    { agentName: 'general-purpose', agentDisplayName: 'builder #1', modelMetrics: modelMetricsOf(12_000, 3) },
        'agent-two':    { agentName: 'general-purpose', agentDisplayName: 'reviewer #2', modelMetrics: modelMetricsOf(8000, 2) },
        'agent-failed': { agentName: 'general-purpose', modelMetrics: {} },
      },
    }),
  ].join('\n')}\n`);
}

beforeEach(async () => {
  repositoryDirectory = await createInitializedScratchRepository('copilot-agent-settled', ['--project', 'Example Agency'], () => FROZEN_NOW);
  elsewhereDirectory  = createScratchDirectory('copilot-agent-settled-elsewhere');
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
  removeScratchDirectory(elsewhereDirectory);
});

describeWhenGitIsPresent('a settled Copilot agent', () => {
  test('credits the row its prompt names its input total, found from repositoryRoot rather than the process directory', async () => {
    const rowIdentifier = await addedRow('Example work');
    const context       = contextWith(settledInput(`Do the work.\nagent-progress row: ${rowIdentifier}`, 20_000));

    expect(await runCommandLine(['hook', 'copilot-agent-settled'], context)).toBe(0);

    expect(storedTokensOf(rowIdentifier)).toBe(20_000);
    expect(storedLogEntriesOf(repositoryDirectory).at(-1)?.text).toContain('Agent copilot-agent-1');
    expect(context.errorText()).toBe('');
  });

  test('a repeat of the same input adds nothing and logs nothing new, and a larger running total adds only the difference', async () => {
    const rowIdentifier = await addedRow('Example work');
    const prompt        = `Do the work.\nagent-progress row: ${rowIdentifier}`;

    expect(await runCommandLine(['hook', 'copilot-agent-settled'], contextWith(settledInput(prompt, 20_000)))).toBe(0);
    const logLengthAfterFirst = storedLogEntriesOf(repositoryDirectory).length;
    expect(await runCommandLine(['hook', 'copilot-agent-settled'], contextWith(settledInput(prompt, 20_000)))).toBe(0);
    expect(storedTokensOf(rowIdentifier)).toBe(20_000);
    expect(storedLogEntriesOf(repositoryDirectory)).toHaveLength(logLengthAfterFirst);

    expect(await runCommandLine(['hook', 'copilot-agent-settled'], contextWith(settledInput(prompt, 26_000)))).toBe(0);
    expect(storedTokensOf(rowIdentifier)).toBe(26_000);
  });

  test('an agent that failed before its first model call credits nothing, writes nothing and exits 0', async () => {
    const rowIdentifier = await addedRow('Example work');
    const before        = storedTrackerText();
    const context       = contextWith(settledInput(`agent-progress row: ${rowIdentifier}`, 0, {
      outcome: 'failed',
      usage:   {
        inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0
      }
    }));

    expect(await runCommandLine(['hook', 'copilot-agent-settled'], context)).toBe(0);

    expect(storedTrackerText()).toBe(before);
    expect(context.errorText().trim().split('\n')).toHaveLength(1);
  });
});

describeWhenGitIsPresent('reconciling a Copilot session', () => {
  test('credits each prompted agent its shutdown total, and reconciling again adds nothing', async () => {
    const firstRow  = await addedRow('Example build');
    const secondRow = await addedRow('Example review');
    writeSessionEvents(firstRow, secondRow);
    const reconcileInput = JSON.stringify({ repositoryRoot: repositoryDirectory });

    const context = contextWith(reconcileInput);
    expect(await runCommandLine(['hook', 'copilot-agent-settled', '--session', SESSION_IDENTIFIER], context)).toBe(0);
    expect(context.errorText()).toBe('');
    expect(storedTokensOf(firstRow)).toBe(12_000);
    expect(storedTokensOf(secondRow)).toBe(8000);

    const logLengthAfterFirst = storedLogEntriesOf(repositoryDirectory).length;
    expect(await runCommandLine(['hook', 'copilot-agent-settled', '--session', SESSION_IDENTIFIER], contextWith(reconcileInput))).toBe(0);
    expect(storedTokensOf(firstRow)).toBe(12_000);
    expect(storedTokensOf(secondRow)).toBe(8000);
    expect(storedLogEntriesOf(repositoryDirectory)).toHaveLength(logLengthAfterFirst);
  });

  test('an agent the settled hook already credited is not credited again by the reconcile', async () => {
    const firstRow  = await addedRow('Example build');
    const secondRow = await addedRow('Example review');
    writeSessionEvents(firstRow, secondRow);
    const settled = settledInput(`agent-progress row: ${firstRow}`, 12_000, { agentId: 'agent-one' });
    expect(await runCommandLine(['hook', 'copilot-agent-settled'], contextWith(settled))).toBe(0);

    expect(await runCommandLine(['hook', 'copilot-agent-settled', '--session', SESSION_IDENTIFIER], contextWith(JSON.stringify({ repositoryRoot: repositoryDirectory })))).toBe(0);

    expect(storedTokensOf(firstRow)).toBe(12_000);
    expect(storedTokensOf(secondRow)).toBe(8000);
  });
});

describeWhenGitIsPresent('every failure exits 0 with one report line and writes nothing', () => {
  const FAILURES: readonly { name: string; argumentList: readonly string[]; input: () => string; prepare?: () => void }[] = [
    { name: 'input that is not JSON', argumentList: [], input: () => 'not json' },
    { name: 'input without an agentId', argumentList: [], input: () => settledInput('agent-progress row: 1', 100, { agentId: undefined }) },
    { name: 'usage with a fractional count', argumentList: [], input: () => settledInput('agent-progress row: 1', 100.5) },
    { name: 'input without a repositoryRoot', argumentList: [], input: () => settledInput('agent-progress row: 1', 100, { repositoryRoot: undefined }) },
    { name: 'a repositoryRoot with no tracker', argumentList: [], input: () => settledInput('agent-progress row: 1', 100, { repositoryRoot: elsewhereDirectory }) },
    { name: 'a session whose events file is missing', argumentList: ['--session', 'missing-session'], input: () => JSON.stringify({ repositoryRoot: repositoryDirectory }) },
    { name: 'a session id that is a path', argumentList: ['--session', '../escape'], input: () => JSON.stringify({ repositoryRoot: repositoryDirectory }) },
    {
      name:         'a session not yet shut down',
      argumentList: ['--session', SESSION_IDENTIFIER],
      input:        () => JSON.stringify({ repositoryRoot: repositoryDirectory }),
      prepare:      () => {
        const sessionFolder = join(elsewhereDirectory, 'home', '.copilot', 'session-state', SESSION_IDENTIFIER);
        mkdirSync(sessionFolder, { recursive: true });
        writeFileSync(join(sessionFolder, 'events.jsonl'), `${eventLine('user.message', { content: 'agent-progress row: 1' }, 'agent-one')}\n`);
      },
    },
    {
      name:         'a malformed events file',
      argumentList: ['--session', SESSION_IDENTIFIER],
      input:        () => JSON.stringify({ repositoryRoot: repositoryDirectory }),
      prepare:      () => {
        const sessionFolder = join(elsewhereDirectory, 'home', '.copilot', 'session-state', SESSION_IDENTIFIER);
        mkdirSync(sessionFolder, { recursive: true });
        writeFileSync(join(sessionFolder, 'events.jsonl'), '{"type":"session.shutdown"\n');
      },
    },
  ];

  for (const failure of FAILURES) {
    test(failure.name, async () => {
      await addedRow('Example work');
      failure.prepare?.();
      const before  = storedTrackerText();
      const context = contextWith(failure.input());

      expect(await runCommandLine(['hook', 'copilot-agent-settled', ...failure.argumentList], context)).toBe(0);

      expect(storedTrackerText()).toBe(before);
      expect(context.errorText().trim().split('\n')).toHaveLength(1);
      expect(context.errorText()).toStartWith('agent-progress hook copilot-agent-settled:');
    });
  }
});

test('--session with another hook event is refused at exit 1', async () => {
  const directory = createScratchDirectory('copilot-agent-settled-refusal');
  try {
    const context = createCapturedCommandContext({ currentDirectory: directory, standardInputText: '' });
    expect(await runCommandLine(['hook', 'subagent-stop', '--session', SESSION_IDENTIFIER], context)).toBe(1);
  } finally {
    removeScratchDirectory(directory);
  }
});
