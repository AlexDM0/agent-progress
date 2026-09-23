/**
 * The one line this command writes, the rows its brief names that it adds the agent's tokens to, and
 * the seven ways it is allowed to write nothing. The failure
 * cases carry the weight: each one asserts **exit 0 and an untouched tracker**. The agent has already
 * finished when this runs, so a non-zero exit prevents nothing; what it does produce is an error the
 * orchestrator has to read and a delay before it hears its agent is done, and both cost more than the
 * log line nobody gets.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join }                                   from 'node:path';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test
}                                                                             from 'bun:test';
import { LOCK_RETRY_COUNT, LOCK_RETRY_INTERVAL_MILLISECONDS } from '../../lib/constants/Limits';
import type { ProgressFile }                                  from '../../lib/constants/Types';
import { createCapturedCommandContext }                       from '../../lib/tooling/dev/CapturedCommandContext';
import {
  createScratchDirectory,
  createScratchGitRepository,
  gitIsAvailable,
  removeScratchDirectory
}                                                                             from '../../lib/tooling/dev/ScratchWorkspace';
import { runCommandLine } from '../Main';

const FROZEN_NOW = new Date('2026-09-18T20:11:03Z');

const TRANSCRIPT_FILE_NAME = 'agent-example.jsonl';

/** The held-lock case waits out the whole retry budget before it is refused, exactly as `lib/platform/Lock.spec.ts` does. */
const HELD_LOCK_TIMEOUT_MILLISECONDS = LOCK_RETRY_COUNT * LOCK_RETRY_INTERVAL_MILLISECONDS * 3;

let repositoryDirectory = '';
let transcriptPath      = '';

function assistantLine(messageIdentifier: string, inputTokens: number, cacheReadTokens: number, outputTokens: number): string {
  return JSON.stringify({
    type:    'assistant',
    message: {
      id:    messageIdentifier,
      usage: { input_tokens: inputTokens, cache_read_input_tokens: cacheReadTokens, output_tokens: outputTokens },
    },
  });
}

function writeTranscript(lines: readonly string[]): string {
  const path = join(repositoryDirectory, TRANSCRIPT_FILE_NAME);
  writeFileSync(path, `${lines.join('\n')}\n`);
  return path;
}

function hookInput(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    agent_id:              'agent_42',
    agent_type:            'general-purpose',
    agent_transcript_path: transcriptPath,
    cwd:                   repositoryDirectory,
    ...overrides,
  });
}

function contextWith(standardInputText: string, currentDirectory = repositoryDirectory): ReturnType<typeof createCapturedCommandContext> {
  return createCapturedCommandContext({ currentDirectory, now: () => FROZEN_NOW, standardInputText });
}

function storedProgress(): ProgressFile {
  const progressFilePath = join(repositoryDirectory, '.agent-progress', 'progress.json');
  return JSON.parse(readFileSync(progressFilePath, 'utf8')) as ProgressFile;
}

function storedLog(): ProgressFile['log'] {
  return storedProgress().log;
}

function storedTokensOf(rowIdentifier: number): number | null | undefined {
  return storedProgress().tasks.find((task) => task.id === rowIdentifier)?.tokens;
}

async function addedRow(name: string): Promise<number> {
  expect(await runCommandLine(['task', 'add', name], contextWith(''))).toBe(0);
  const rowIdentifier = storedProgress().tasks.at(-1)?.id;
  if (rowIdentifier === undefined) throw new Error(`task add "${name}" filed no row`);
  return rowIdentifier;
}

function userLine(text: string): string {
  return JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } });
}

/** The fixture's two calls: 10 + 90,000 and 20 + 140,000, the figure the log line rounds to `input 230k`. */
const FIXTURE_INPUT_TOKENS = 230_030;

const FIXTURE_CALLS = [
  assistantLine('msg_one', 10, 90_000, 400),
  assistantLine('msg_one', 10, 90_000, 1200),
  assistantLine('msg_two', 20, 140_000, 800),
];

beforeEach(async () => {
  repositoryDirectory = createScratchGitRepository('hook-command');
  const initContext   = createCapturedCommandContext({ currentDirectory: repositoryDirectory, now: () => FROZEN_NOW });
  expect(await runCommandLine(['init', '--project', 'Example Agency'], initContext)).toBe(0);
  transcriptPath = writeTranscript([
    assistantLine('msg_one', 10, 90_000, 400),
    assistantLine('msg_one', 10, 90_000, 1200),
    assistantLine('msg_two', 20, 140_000, 800),
  ]);
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
});

describe.skipIf(!gitIsAvailable())('a subagent that stopped', () => {
  test('gets one log line naming it, its calls and what it cost, summed per call and not per line', async () => {
    const context = contextWith(hookInput());

    expect(await runCommandLine(['hook', 'subagent-stop'], context)).toBe(0);

    const lastEntry = storedLog().at(-1);
    expect(lastEntry?.text).toBe('Agent agent_42 (general-purpose) stopped: 2 calls, end context 140k, input 230k (cache read 230k), output 2k');
    expect(context.errorText()).toBe('');
  });

  /**
   * The hook runs wherever the harness is, and the agent that stopped may have been in a worktree, so
   * the tracker is found from the hook input's `cwd` rather than from this process's directory.
   */
  test('the tracker is found from the hook input\'s cwd, not from where the command was run', async () => {
    const elsewhere = createScratchDirectory('hook-command-elsewhere');
    try {
      const context = contextWith(hookInput(), elsewhere);

      expect(await runCommandLine(['hook', 'subagent-stop'], context)).toBe(0);

      expect(storedLog().at(-1)?.text).toContain('Agent agent_42');
    } finally {
      removeScratchDirectory(elsewhere);
    }
  });

  test('an input without an agent id or type still records the cost, under a name that says so', async () => {
    const context = contextWith(hookInput({ agent_id: undefined, agent_type: undefined }));

    expect(await runCommandLine(['hook', 'subagent-stop'], context)).toBe(0);

    expect(storedLog().at(-1)?.text).toStartWith('Agent unknown (unknown) stopped: 2 calls');
  });
});

describe.skipIf(!gitIsAvailable())('the row the brief names', () => {
  /** Adding rather than setting is the claim: a row an implementer and a second pass both worked on carries what both cost. */
  test('a brief naming a row takes its tokens from unset to the input total, and the same input again doubles it', async () => {
    const rowIdentifier = await addedRow('Example work');
    transcriptPath      = writeTranscript([userLine(`Do the work.\nagent-progress row: ${rowIdentifier}\nStop at 150 calls.`), ...FIXTURE_CALLS]);
    expect(storedTokensOf(rowIdentifier)).toBeNull();

    expect(await runCommandLine(['hook', 'subagent-stop'], contextWith(hookInput()))).toBe(0);
    expect(storedTokensOf(rowIdentifier)).toBe(FIXTURE_INPUT_TOKENS);
    expect(storedLog().at(-1)?.text).toContain('input 230k');

    expect(await runCommandLine(['hook', 'subagent-stop'], contextWith(hookInput()))).toBe(0);
    expect(storedTokensOf(rowIdentifier)).toBe(FIXTURE_INPUT_TOKENS * 2);
  });

  test('a bundle divides the total evenly, and the remainder goes to the first row named', async () => {
    const firstRow  = await addedRow('Example first');
    const secondRow = await addedRow('Example second');
    transcriptPath  = writeTranscript([userLine(`agent-progress row: ${firstRow}, ${secondRow}`), assistantLine('msg_only', 1001, 0, 50)]);

    expect(await runCommandLine(['hook', 'subagent-stop'], contextWith(hookInput()))).toBe(0);

    expect(storedTokensOf(firstRow)).toBe(501);
    expect(storedTokensOf(secondRow)).toBe(500);
  });

  /** A reviewer's brief can quote the builder's marker further down the conversation; only the agent's own brief may name its row. */
  test('a marker that appears only in a later message changes no row, and the log line is still written', async () => {
    const rowIdentifier = await addedRow('Example work');
    transcriptPath      = writeTranscript([
      userLine('Review the branch.'),
      assistantLine('msg_one', 10, 90_000, 400),
      userLine(`agent-progress row: ${rowIdentifier}`),
      assistantLine('msg_two', 20, 140_000, 800),
    ]);
    const context = contextWith(hookInput());

    expect(await runCommandLine(['hook', 'subagent-stop'], context)).toBe(0);

    expect(storedTokensOf(rowIdentifier)).toBeNull();
    expect(storedLog().at(-1)?.text).toContain('Agent agent_42');
    expect(context.errorText()).toBe('');
  });

  test('a brief without a marker leaves every row as it was', async () => {
    const rowIdentifier = await addedRow('Example work');
    transcriptPath      = writeTranscript([userLine('Do the work.'), ...FIXTURE_CALLS]);

    expect(await runCommandLine(['hook', 'subagent-stop'], contextWith(hookInput()))).toBe(0);

    expect(storedTokensOf(rowIdentifier)).toBeNull();
    expect(storedLog().at(-1)?.text).toContain('input 230k');
  });

  test('a row the tracker does not hold is named on standard error, the rows it does hold are recorded, and it exits 0', async () => {
    const rowIdentifier = await addedRow('Example work');
    const missingRow    = rowIdentifier + 900;
    transcriptPath      = writeTranscript([userLine(`agent-progress row: ${rowIdentifier}, ${missingRow}`), assistantLine('msg_only', 1001, 0, 50)]);
    const context       = contextWith(hookInput());

    expect(await runCommandLine(['hook', 'subagent-stop'], context)).toBe(0);

    expect(storedTokensOf(rowIdentifier)).toBe(501);
    expect(context.errorText()).toContain(`#${missingRow}`);
    expect(context.errorText().trim().split('\n'), 'one sentence for the one missing row').toHaveLength(1);
    expect(storedLog().at(-1)?.text).toContain('Agent agent_42');
  });

  /** The path and the agent type a workflow agent was observed with; nothing in them may stop the row from being found. */
  test('a workflow agent\'s transcript under subagents/workflows/<runId>/ is recorded like any other', async () => {
    const rowIdentifier    = await addedRow('Example workflow step');
    const workflowFolder   = join(repositoryDirectory, 'session', 'subagents', 'workflows', 'run_example');
    const workflowPath     = join(workflowFolder, 'agent-example.jsonl');
    mkdirSync(workflowFolder, { recursive: true });
    writeFileSync(workflowPath, `${[userLine(`agent-progress row: ${rowIdentifier}`), ...FIXTURE_CALLS].join('\n')}\n`);
    const context = contextWith(hookInput({ agent_type: 'workflow-subagent', agent_transcript_path: workflowPath }));

    expect(await runCommandLine(['hook', 'subagent-stop'], context)).toBe(0);

    expect(storedTokensOf(rowIdentifier)).toBe(FIXTURE_INPUT_TOKENS);
    expect(storedLog().at(-1)?.text).toContain('(workflow-subagent)');
  });
});

describe.skipIf(!gitIsAvailable())('every way it can fail', () => {
  /** The table is the whole claim: each of these leaves the tracker as it was and still answers 0. */
  test('nothing piped in, input that is not JSON, input that is not an object, and no transcript path all exit 0 and record nothing', async () => {
    const cases: Record<string, string> = {
      'nothing piped in':           '',
      'whitespace only':            '   \n  ',
      'not JSON at all':            'the agent stopped',
      'JSON that is not an object': '["agent_42"]',
      'no transcript path':         hookInput({ agent_transcript_path: undefined }),
    };

    for (const [description, standardInputText] of Object.entries(cases)) {
      const context = contextWith(standardInputText);

      expect(await runCommandLine(['hook', 'subagent-stop'], context), description).toBe(0);

      expect(storedLog(), description).toEqual([]);
      expect(context.errorText(), description).toContain('nothing was recorded');
      expect(context.outputText(), description).toBe('');
    }
  });

  test('a transcript that is not there is reported by name and exits 0', async () => {
    const missingPath = join(repositoryDirectory, 'no-such-transcript.jsonl');
    const context     = contextWith(hookInput({ agent_transcript_path: missingPath }));

    expect(await runCommandLine(['hook', 'subagent-stop'], context)).toBe(0);

    expect(storedLog()).toEqual([]);
    expect(context.errorText()).toContain(missingPath);
    expect(context.errorText()).toContain('could not be read');
  });

  /** A line of noughts is worse than no line: it reads as a subagent that cost nothing rather than as one nobody measured. */
  test('a transcript holding no API calls records nothing rather than a line of zeroes', async () => {
    const context = contextWith(hookInput({ agent_transcript_path: writeTranscript(['{"type":"user","message":{"content":"do it"}}']) }));

    expect(await runCommandLine(['hook', 'subagent-stop'], context)).toBe(0);

    expect(storedLog()).toEqual([]);
    expect(context.errorText()).toContain('holds no API calls');
  });

  /**
   * The only failure that reaches this command as a throw from inside the tracker, and the one a
   * fan-out actually produces: a sibling command is mid-write when the agent stops. An empty `.lock`
   * is a lock nobody finished writing, which `lib/platform/Lock.ts` waits out and then refuses rather
   * than assuming free — so the line is lost, and nothing else is.
   */
  test('a lock the tracker will not give up costs the line only, leaving the log and the lock as they were', async () => {
    const lockFilePath = join(repositoryDirectory, '.agent-progress', '.lock');
    writeFileSync(lockFilePath, '');
    const context = contextWith(hookInput());

    expect(await runCommandLine(['hook', 'subagent-stop'], context)).toBe(0);

    expect(storedLog()).toEqual([]);
    expect(context.errorText().split('\n'), 'one sentence, not a stack the orchestrator has to read').toHaveLength(1);
    expect(context.errorText()).toContain('could not be recorded');
    expect(context.outputText()).toBe('');
    expect(readFileSync(lockFilePath, 'utf8'), 'the lock it refused to take is left exactly as it was').toBe('');
  }, HELD_LOCK_TIMEOUT_MILLISECONDS);

  test('a cwd with no tracker above it is reported and still exits 0, because a hook failure must never reach the orchestrator', async () => {
    const untrackedDirectory = createScratchDirectory('hook-command-untracked');
    try {
      const context = contextWith(hookInput({ cwd: untrackedDirectory }));

      expect(await runCommandLine(['hook', 'subagent-stop'], context)).toBe(0);

      expect(storedLog()).toEqual([]);
      expect(context.errorText()).toContain(untrackedDirectory);
      expect(context.errorText()).toContain('could not be recorded');
    } finally {
      removeScratchDirectory(untrackedDirectory);
    }
  });
});

describe.skipIf(!gitIsAvailable())('the one thing it does refuse', () => {
  test('a missing or misspelled event is refused with exit 1, since only a person typing it can get that wrong', async () => {
    for (const commandLineArguments of [['hook'], ['hook', 'subagent-stopped']]) {
      const context = contextWith(hookInput());

      expect(await runCommandLine(commandLineArguments, context), commandLineArguments.join(' ')).toBe(1);

      expect(context.errorText()).toContain('agent-progress hook takes one event');
      expect(storedLog()).toEqual([]);
    }
  });
});
