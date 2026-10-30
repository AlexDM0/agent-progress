/**
 * The `gate` verbs over a scratch tracker. What matters: no pipeline and `gate none` are told apart in `pipeline.json`, `gate list` and the
 * log; the verbs are the file's writers, through the lock, accepted with a ticket in flight; a malformed file is refused, never overwritten,
 * and a refused write leaves the progress file, the pipeline and the log as they were.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import {
  afterEach,
  beforeEach,
  expect,
  test
}                                             from 'bun:test';
import { workspacePathsFor }                  from '../../src/services/tracker/Workspace.ts';
import { removeScratchDirectory }             from '../../src/testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent }           from '../../src/testing/ToolGuard.ts';
import { createCapturedCommandContext }       from '../testing/CapturedCommandContext.ts';
import { createInitializedScratchRepository } from '../testing/InitializedScratchRepository.ts';
import { fileReadyTicket }                    from '../testing/ReadyTicketFiling.ts';
import { runCommandLineWithRunnerMoves }      from '../testing/RunnerTicketMoves.ts';
import { storedLogTextOf }                    from '../testing/StoredLogText.ts';

const FROZEN_NOW = new Date('2026-10-30T09:00:00Z');

let repositoryDirectory = '';

const pipelineFilePath = (): string => workspacePathsFor(repositoryDirectory).pipelineFilePath;

async function runWithExitCode(commandLineArguments: readonly string[]): Promise<{ exitCode: number; context: ReturnType<typeof createCapturedCommandContext> }> {
  const context  = createCapturedCommandContext({ currentDirectory: repositoryDirectory, now: () => FROZEN_NOW });
  const exitCode = await runCommandLineWithRunnerMoves(commandLineArguments, context);
  return { exitCode, context };
}

async function run(commandLineArguments: readonly string[]): Promise<ReturnType<typeof createCapturedCommandContext>> {
  const { context, exitCode } = await runWithExitCode(commandLineArguments);
  expect(exitCode, `\`agent-progress ${commandLineArguments.join(' ')}\` failed: ${context.errorText()}`).toBe(0);
  return context;
}

async function listed(): Promise<{ pipelineIsSet: boolean; pipelineHash: string | null; prepare: unknown[]; gates: { name: string; run: string }[] }> {
  return JSON.parse((await run(['gate', 'list', '--json'])).outputText()) as Awaited<ReturnType<typeof listed>>;
}

function storedFiles(): string[] {
  const workspace = workspacePathsFor(repositoryDirectory);
  return [workspace.progressFilePath, workspace.logFilePath, workspace.pipelineFilePath].map((filePath) => (existsSync(filePath) ? readFileSync(filePath, 'utf8') : ''));
}

beforeEach(async () => {
  repositoryDirectory = await createInitializedScratchRepository('gate-pipeline-verbs', ['--project', 'Example Agency'], () => FROZEN_NOW);
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
});

describeWhenGitIsPresent('the gate pipeline verbs', () => {
  test('with no pipeline gate list prints it unset with no gates, and writes no file', async () => {
    expect(await listed()).toEqual({
      pipelineIsSet: false, pipelineHash: null, prepare: [], gates: []
    });
    expect((await run(['gate', 'list'])).outputText()).toContain('checks-not-set');
    expect(existsSync(pipelineFilePath())).toBe(false);
  });

  test('gate none stores an empty gate list on purpose, logs it once, and gate list prints it set with no gates', async () => {
    await run(['gate', 'none']);

    expect(JSON.parse(readFileSync(pipelineFilePath(), 'utf8'))).toEqual({ prepare: [], gates: [] });
    expect(storedLogTextOf(repositoryDirectory).split('\n').filter((line) => line.includes('"pipeline-gates-none"'))).toHaveLength(1);
    const pipeline = await listed();
    expect(pipeline.pipelineIsSet).toBe(true);
    expect(pipeline.gates).toEqual([]);
  });

  test('gate prepare, add and remove write the pipeline in run order, a same-named gate replaced where it stands', async () => {
    await run(['gate', 'prepare', 'install', '--', 'bun', 'install']);
    await run(['gate', 'add', 'types', '--defined-by', 'tsconfig.json', '--', 'bun run typecheck']);
    await run(['gate', 'add', 'test', '--in', 'packages/example', '--writes', '~/.cache/example', '--overseer-only', '--', 'bun test']);
    await run(['gate', 'add', 'types', '--', 'tsc --noEmit']);
    await run(['gate', 'remove', 'test']);

    expect(JSON.parse(readFileSync(pipelineFilePath(), 'utf8'))).toEqual({
      prepare: [{ name: 'install', run: 'bun install' }],
      gates:   [{ name: 'types', run: 'tsc --noEmit' }],
    });
  });

  test('a gate added while a ticket is in progress is accepted, and the hash gate list prints follows the pipeline', async () => {
    await run(['gate', 'add', 'test', '--', 'bun test']);
    const hashBefore = (await listed()).pipelineHash;
    const added = JSON.parse((await fileReadyTicket(run, ['ticket', 'add', '--type', 'ticket', 'Example checkout page', '--json'])).outputText()) as { id: string };
    await run(['ticket', 'start', added.id]);

    await run(['gate', 'add', 'lint', '--', 'bun run lint']);

    const hashAfter = (await listed()).pipelineHash;
    expect(hashAfter).not.toBeNull();
    expect(hashAfter).not.toBe(hashBefore);
  });

  test('an unknown gate, and a write over a malformed pipeline.json, are refused at exit 1 with every file left as it was', async () => {
    await run(['gate', 'add', 'test', '--', 'bun test']);
    const before = storedFiles();
    const unknown = await runWithExitCode(['gate', 'remove', 'lint']);
    expect(unknown.exitCode).toBe(1);
    expect(unknown.context.errorText()).toContain('There is no gate lint: the gates are test.');
    expect(storedFiles()).toEqual(before);

    writeFileSync(pipelineFilePath(), '{ "gates": [{ "run": "bun test" }] }\n');
    const malformedBefore = storedFiles();
    for (const verb of [['gate', 'none'], ['gate', 'list']]) {
      const refused = await runWithExitCode(verb);
      expect(refused.exitCode, verb.join(' ')).toBe(1);
      expect(refused.context.errorText()).toContain('gates[0] has no name');
    }
    expect(storedFiles()).toEqual(malformedBefore);
  });

  test('a command missing after -- is refused with the usage', async () => {
    const refused = await runWithExitCode(['gate', 'add', 'test', 'bun test']);
    expect(refused.exitCode).toBe(1);
    expect(refused.context.errorText()).toContain('Put the command after --.');
    expect(existsSync(pipelineFilePath())).toBe(false);
  });
});
