/**
 * The guard holds only if it blocks every way a subagent changes the check command (a line, `--clear`, `--restamp`, behind a `cd`, inside a
 * `bash -c` or `eval` string) and never blocks the orchestrator, a read, an unrelated call, or another command's quoted argument:
 * a false block stalls an agent, a missed one lets a weaker check through.
 */
import {
  afterAll,
  describe,
  expect,
  test
} from 'bun:test';

import { createScratchDirectory, removeScratchDirectory } from '../../../src/testing/ScratchWorkspace.ts';
import { runCommandLine }                                 from '../../Main.ts';
import { createCapturedCommandContext }                   from '../../testing/CapturedCommandContext.ts';

const scratchDirectory = createScratchDirectory('check-command-guard');

afterAll(() => removeScratchDirectory(scratchDirectory));

const BLOCKED_EXIT_CODE = 2;

function hookInputFor(commandLine: string, { fromASubagent }: { fromASubagent: boolean }): string {
  return JSON.stringify({
    hook_event_name: 'PreToolUse',
    cwd:             scratchDirectory,
    tool_name:       'Bash',
    tool_input:      { command: commandLine },
    ...(fromASubagent ? { agent_id: 'agent_example', agent_type: 'agent-progress-worker' } : {}),
  });
}

async function exitCodeFor(standardInputText: string): Promise<{ exitCode: number; errorText: string }> {
  const context  = createCapturedCommandContext({ currentDirectory: scratchDirectory, standardInputText });
  const exitCode = await runCommandLine(['hook', 'pre-tool-use'], context);
  return { exitCode, errorText: context.errorText() };
}

const CHANGING_COMMAND_LINES = [
  'agent-progress checks --clear',
  'agent-progress checks "bun test"',
  'agent-progress checks \'bun run typecheck && bun test\' --restamp',
  'agent-progress checks --restamp "bun test"',
  'cd /tmp/example && agent-progress checks --clear',
  'cd "/tmp/example agency" && AGENT_PROGRESS_ROOT=/tmp/example agent-progress checks "bun test"',
  'agent-progress status --json; agent-progress checks --clear',
  '/usr/local/bin/agent-progress checks --clear',
  'echo $(agent-progress checks --clear)',
  'bash -c "agent-progress checks --clear"',
  'sh -c \'agent-progress checks "bun test"\'',
  'zsh -lc "cd /tmp/example && agent-progress checks --clear"',
  '/bin/bash -c "agent-progress checks --clear"',
  'eval \'agent-progress checks "x"\'',
  'eval agent-progress checks --clear',
  'bash -c "eval \'agent-progress checks --clear\'"',
  'sh -c "bash -c \\"agent-progress checks --restamp \'bun test\'\\""',
];

const PASSING_COMMAND_LINES = [
  'agent-progress checks',
  'agent-progress checks --json',
  'cd /tmp/example && agent-progress checks --json 2>&1 | tail -5',
  'agent-progress checks --json > checks.json',
  'agent-progress status --json',
  'echo "agent-progress checks --clear"',
  'git commit -m "Run agent-progress checks before release"',
  'git commit -m "agent-progress checks --clear"',
  'echo \'agent-progress checks --clear\'',
  'git commit -m "bash -c \'agent-progress checks --clear\'"',
  'bash -c "agent-progress checks --json"',
  'eval \'agent-progress checks --json\'',
  'bash script.sh "agent-progress checks --clear"',
];

describe('a subagent\'s Bash call', () => {
  test.each(CHANGING_COMMAND_LINES)('changing the check command is blocked at exit 2 with the reason on standard error: %s', async (commandLine) => {
    const { exitCode, errorText } = await exitCodeFor(hookInputFor(commandLine, { fromASubagent: true }));

    expect(exitCode).toBe(BLOCKED_EXIT_CODE);
    expect(errorText).toContain('Only the orchestrator\'s own session changes the tracker\'s check command');
  });

  test.each(PASSING_COMMAND_LINES)('reading it, or anything else, passes: %s', async (commandLine) => {
    expect((await exitCodeFor(hookInputFor(commandLine, { fromASubagent: true }))).exitCode).toBe(0);
  });
});

describe('the main session', () => {
  test.each(CHANGING_COMMAND_LINES)('is never blocked, its input carrying no agent_id: %s', async (commandLine) => {
    expect(await exitCodeFor(hookInputFor(commandLine, { fromASubagent: false }))).toEqual({ exitCode: 0, errorText: '' });
  });
});

describe('an input the guard cannot judge', () => {
  test('another tool, a missing command or unreadable input passes, the last saying so', async () => {
    const otherTool = JSON.stringify({ agent_id: 'agent_example', tool_name: 'Read', tool_input: { file_path: 'agent-progress checks --clear' } });
    expect((await exitCodeFor(otherTool)).exitCode).toBe(0);
    expect((await exitCodeFor(JSON.stringify({ agent_id: 'agent_example', tool_name: 'Bash', tool_input: {} }))).exitCode).toBe(0);

    const unreadable = await exitCodeFor('not json');
    expect(unreadable.exitCode).toBe(0);
    expect(unreadable.errorText).toContain('agent-progress hook pre-tool-use: the hook input on standard input is not JSON, so the call was let through.');
  });
});
