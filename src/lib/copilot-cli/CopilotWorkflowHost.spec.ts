/**
 * The host against a fake SDK. What matters: an agent that settles, completed or failed, runs the command exactly once, with the running
 * totals of every `assistant.usage` it had and the prompt and label its events named; a failure before the first model call still runs it,
 * with zero totals; startup runs the reconciliation once; an SDK without the expected shape registers nothing and reports one line. The
 * default runner is proven once against a real process writing its stdin to a file.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join }                     from 'node:path';

import {
  afterAll,
  describe,
  expect,
  test
} from 'bun:test';

import { createScratchDirectory, removeScratchDirectory } from '../../testing/ScratchWorkspace.ts';
import {
  hostCopilotWorkflow,
  type CopilotWorkflowHostRequest,
  type HostedWorkflow,
  type SettledAgentInput
} from './CopilotWorkflowHost.ts';

const SETTLE_COMMAND = ['example-credit', 'settled'];

const EXAMPLE_SESSION_ID = 'session-example';

const EXAMPLE_ROOT = '/example/repository';

const EXAMPLE_WORKFLOW: HostedWorkflow = {
  meta: { name: 'example-workflow', description: 'An example workflow', phases: [{ title: 'Build', detail: 'build it' }, { title: 'Park' }] },
  run:  async () => 'ran',
};

interface FakeSdk {
  sdk:             Record<string, unknown>;
  definitions:     { meta: unknown; run: (context: unknown) => Promise<unknown> }[];
  joinedWorkflows: unknown[][];
  emit:            (event: unknown) => void;
}

function fakeSdk(): FakeSdk {
  const handlers: ((event: unknown) => void)[] = [];
  const fake: FakeSdk = {
    definitions:     [],
    joinedWorkflows: [],
    emit:            (event) => {
      for (const handler of handlers) handler(event);
    },
    sdk: {
      defineWorkflow: (definition: { meta: unknown; run: (context: unknown) => Promise<unknown> }) => {
        fake.definitions.push(definition);
        return { handleOf: definition };
      },
      joinSession: async (config: { workflows: unknown[] }) => {
        fake.joinedWorkflows.push(config.workflows);
        return {
          sessionId: EXAMPLE_SESSION_ID,
          on:        (handler: (event: unknown) => void) => {
            handlers.push(handler);
            return () => undefined;
          },
        };
      },
    },
  };
  return fake;
}

interface CommandRun {
  commandLine: readonly string[];
  stdinText:   string;
}

async function hostedOn(fake: FakeSdk, overrides: Partial<CopilotWorkflowHostRequest> = {}): Promise<{ commandRuns: CommandRun[]; reportedLines: string[] }> {
  const commandRuns: CommandRun[] = [];
  const reportedLines: string[] = [];
  await hostCopilotWorkflow({
    sdk:            fake.sdk,
    workflow:       EXAMPLE_WORKFLOW,
    settleCommand:  SETTLE_COMMAND,
    repositoryRoot: EXAMPLE_ROOT,
    runCommand:     (commandLine, stdinText) => {
      commandRuns.push({ commandLine, stdinText });
    },
    reportLine: (line) => {
      reportedLines.push(line);
    },
    ...overrides,
  });
  return { commandRuns, reportedLines };
}

function usageEvent(agentId: string, inputTokens: number, outputTokens: number, cacheReadTokens: number, cacheWriteTokens: number): unknown {
  return {
    type: 'assistant.usage',
    agentId,
    data: {
      inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, model: 'claude-haiku-4.5'
    }
  };
}

function startAgent(fake: FakeSdk, agentId: string, label: string, prompt: string): void {
  fake.emit({ type: 'subagent.started', agentId, data: { toolCallId: agentId, agentDisplayName: label, agentName: 'example-agent' } });
  fake.emit({ type: 'user.message', agentId, data: { content: prompt } });
}

function settledInputsOf(commandRuns: readonly CommandRun[]): SettledAgentInput[] {
  return commandRuns.filter((run) => run.stdinText !== '').map((run) => JSON.parse(run.stdinText) as SettledAgentInput);
}

const POLL_INTERVAL_MILLISECONDS = 20;

const POLLS_BEFORE_GIVING_UP = 500;

async function pollUntil(condition: () => boolean): Promise<void> {
  for (let i = 0; i < POLLS_BEFORE_GIVING_UP && !condition(); i++) await Bun.sleep(POLL_INTERVAL_MILLISECONDS);
}

const scratchDirectories: string[] = [];

afterAll(() => {
  for (const directory of scratchDirectories) removeScratchDirectory(directory);
});

describe('hostCopilotWorkflow, on a fake SDK', () => {
  test('registers the workflow under its name with only the meta keys Copilot reads, and runs it through the given runner', async () => {
    const fake = fakeSdk();
    const metaWithClaudeCodeKeys = { ...EXAMPLE_WORKFLOW.meta, whenToUse: 'Claude Code only', phases: [{ title: 'Build', detail: 'build it', model: 'haiku' }, { title: 'Park' }] };
    await hostedOn(fake, { workflow: { ...EXAMPLE_WORKFLOW, meta: metaWithClaudeCodeKeys } });
    expect(fake.definitions.map((definition) => definition.meta)).toEqual([EXAMPLE_WORKFLOW.meta]);
    expect(fake.joinedWorkflows).toEqual([[{ handleOf: fake.definitions[0] }]]);
    expect(await fake.definitions[0]?.run({})).toBe('ran');
  });

  test('runs the reconciliation once at startup, with the session id', async () => {
    const { commandRuns } = await hostedOn(fakeSdk());
    expect(commandRuns).toEqual([{ commandLine: [...SETTLE_COMMAND, '--session', EXAMPLE_SESSION_ID], stdinText: '' }]);
  });

  test('a completed agent runs the command exactly once, with the running totals of all its usage events', async () => {
    const fake = fakeSdk();
    const { commandRuns } = await hostedOn(fake);
    startAgent(fake, 'agent-1', 'build #001', 'agent-progress ticket: 1\nBuild it.');
    fake.emit({ type: 'user.message', agentId: 'agent-1', data: { content: 'A later message, not the brief' } });
    fake.emit(usageEvent('agent-1', 100, 10, 60, 30));
    fake.emit(usageEvent('agent-2', 5000, 500, 0, 0));
    fake.emit(usageEvent('agent-1', 200, 20, 150, 0));
    fake.emit({ type: 'subagent.completed', agentId: 'agent-1', data: { toolCallId: 'agent-1', agentDisplayName: 'build #001', agentName: 'example-agent' } });
    fake.emit({ type: 'subagent.completed', agentId: 'agent-1', data: { toolCallId: 'agent-1', agentDisplayName: 'build #001', agentName: 'example-agent' } });
    fake.emit(usageEvent('agent-1', 999, 999, 0, 0));
    expect(commandRuns.filter((run) => run.stdinText !== '').map((run) => run.commandLine)).toEqual([SETTLE_COMMAND]);
    expect(settledInputsOf(commandRuns)).toEqual([{
      repositoryRoot: EXAMPLE_ROOT,
      sessionId:      EXAMPLE_SESSION_ID,
      agentId:        'agent-1',
      label:          'build #001',
      prompt:         'agent-progress ticket: 1\nBuild it.',
      outcome:        'completed',
      usage:          {
        inputTokens: 300, outputTokens: 30, cacheReadTokens: 210, cacheWriteTokens: 30
      },
    }]);
    expect(Object.keys(JSON.parse(commandRuns[1]?.stdinText ?? '{}'))).toEqual(['repositoryRoot', 'sessionId', 'agentId', 'label', 'prompt', 'outcome', 'usage']);
  });

  test('a failed agent runs the command exactly once too, with its totals', async () => {
    const fake = fakeSdk();
    const { commandRuns } = await hostedOn(fake);
    startAgent(fake, 'agent-3', 'review 1 #002', 'agent-progress review: 2');
    fake.emit(usageEvent('agent-3', 40, 4, 0, 40));
    fake.emit({
      type:    'subagent.failed',
      agentId: 'agent-3',
      data:    {
        toolCallId: 'agent-3', agentDisplayName: 'review 1 #002', agentName: 'example-agent', error: 'example failure'
      }
    });
    fake.emit({
      type:    'subagent.failed',
      agentId: 'agent-3',
      data:    {
        toolCallId: 'agent-3', agentDisplayName: 'review 1 #002', agentName: 'example-agent', error: 'example failure'
      }
    });
    expect(settledInputsOf(commandRuns).map((input) => [input.agentId, input.outcome, input.usage])).toEqual([
      ['agent-3', 'failed', {
        inputTokens: 40, outputTokens: 4, cacheReadTokens: 0, cacheWriteTokens: 40
      }],
    ]);
  });

  test('an agent failing before its first model call runs the command with zero totals', async () => {
    const fake = fakeSdk();
    const { commandRuns } = await hostedOn(fake);
    fake.emit({
      type:    'subagent.failed',
      agentId: 'agent-4',
      data:    {
        toolCallId: 'agent-4', agentDisplayName: 'survey', agentName: 'example-agent', error: 'rejected effort'
      }
    });
    expect(settledInputsOf(commandRuns)).toEqual([{
      repositoryRoot: EXAMPLE_ROOT,
      sessionId:      EXAMPLE_SESSION_ID,
      agentId:        'agent-4',
      label:          'survey',
      prompt:         '',
      outcome:        'failed',
      usage:          {
        inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0
      },
    }]);
  });

  test('a settle that arrives after its usage keeps the totals, and usage outside any agent is not counted', async () => {
    const fake = fakeSdk();
    const { commandRuns } = await hostedOn(fake);
    fake.emit({ type: 'assistant.usage', data: { inputTokens: 7000, outputTokens: 70 } });
    startAgent(fake, 'agent-5', 'park #001', 'agent-progress row: 5');
    fake.emit(usageEvent('agent-5', 11, 1, 0, 0));
    fake.emit({ type: 'unrelated.event', agentId: 'agent-5', data: {} });
    fake.emit('not an event');
    fake.emit({ type: 'subagent.completed', agentId: 'agent-5', data: { toolCallId: 'agent-5', agentDisplayName: 'park #001', agentName: 'example-agent' } });
    expect(settledInputsOf(commandRuns).map((input) => input.usage.inputTokens)).toEqual([11]);
  });

  test('an SDK without joinSession and defineWorkflow registers nothing and reports one line', async () => {
    const fake = fakeSdk();
    const { commandRuns, reportedLines } = await hostedOn(fake, { sdk: { joinSession: fake.sdk['joinSession'] } });
    expect(fake.joinedWorkflows).toEqual([]);
    expect(commandRuns).toEqual([]);
    expect(reportedLines).toHaveLength(1);
    expect(reportedLines[0]).toContain('example-workflow');
  });

  test('a session without on() runs no command and reports one line', async () => {
    const fake = fakeSdk();
    const { commandRuns, reportedLines } = await hostedOn(fake, { sdk: { ...fake.sdk, joinSession: async () => ({ sessionId: EXAMPLE_SESSION_ID }) } });
    expect(commandRuns).toEqual([]);
    expect(reportedLines).toHaveLength(1);
  });
});

describe('the default runner', () => {
  test('starts the command in the repository root and hands it the settled agent on stdin', async () => {
    const repositoryRoot = createScratchDirectory('copilot-host-');
    scratchDirectories.push(repositoryRoot);
    const fake = fakeSdk();
    const reportedLines: string[] = [];
    await hostCopilotWorkflow({
      sdk:           fake.sdk,
      workflow:      EXAMPLE_WORKFLOW,
      settleCommand: ['sh', '-c', 'cat >> "$PWD/settled.jsonl"; echo >> "$PWD/settled.jsonl"'],
      repositoryRoot,
      reportLine:    (line) => {
        reportedLines.push(line);
      },
    });
    fake.emit({ type: 'subagent.completed', agentId: 'agent-6', data: { toolCallId: 'agent-6', agentDisplayName: 'build #006', agentName: 'example-agent' } });
    const settledFilePath = join(repositoryRoot, 'settled.jsonl');
    await pollUntil(() => existsSync(settledFilePath) && readFileSync(settledFilePath, 'utf8').includes('agent-6'));
    expect(readFileSync(settledFilePath, 'utf8')).toContain('"agentId":"agent-6"');
    expect(reportedLines).toEqual([]);
  });

  test('a command that cannot start is reported, not thrown', async () => {
    const repositoryRoot = createScratchDirectory('copilot-host-');
    scratchDirectories.push(repositoryRoot);
    const reportedLines: string[] = [];
    await hostCopilotWorkflow({
      sdk:           fakeSdk().sdk,
      workflow:      EXAMPLE_WORKFLOW,
      settleCommand: [join(repositoryRoot, 'no-such-command')],
      repositoryRoot,
      reportLine:    (line) => {
        reportedLines.push(line);
      },
    });
    await pollUntil(() => reportedLines.length > 0);
    expect(reportedLines).toHaveLength(1);
    expect(reportedLines[0]).toContain('could not run');
  });
});
