/**
 * The real binary, spawned end to end, so the shebang, the `Bun.argv` slice and
 * the exit status reaching the process are covered, in a scratch directory no tracker above the checkout can reach.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join }                     from 'node:path';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  test
}                                                              from 'bun:test';
import { CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS } from '../src/testing/ChildProcessCaseTimeout.ts';
import {
  createScratchDirectory,
  createScratchGitRepository,
  gitIsAvailable,
  removeScratchDirectory
} from '../src/testing/ScratchWorkspace.ts';
import { runAgentProgress } from './testing/CliProcess.ts';

let scratchDirectory = '';

beforeAll(() => {
  scratchDirectory = createScratchDirectory('binary-smoke');
});

afterAll(() => {
  removeScratchDirectory(scratchDirectory);
});

describe('the binary', () => {
  test('prints the command reference and exits 0', async () => {
    const result = await runAgentProgress(['help'], { currentDirectory: scratchDirectory });
    expect(result.exitCode).toBe(0);
    expect(result.standardOutput).toContain('Usage: agent-progress <command> [options]');
    expect(result.standardOutput).toContain('  ticket add "<title>"');
    expect(result.standardError).toBe('');
  }, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);

  test('refuses a word that is not a command with exit 1', async () => {
    const result = await runAgentProgress(['nosuchcommand'], { currentDirectory: scratchDirectory });
    expect(result.exitCode).toBe(1);
    expect(result.standardError).toContain('Unknown command: "nosuchcommand".');
  }, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);

  // The hazard that exits 0 when it is unguarded, which is the only thing a calling script reads.
  test('refuses an inherited property of the command table with exit 1', async () => {
    const result = await runAgentProgress(['constructor'], { currentDirectory: scratchDirectory });
    expect(result.exitCode).toBe(1);
    expect(result.standardError).toContain('Unknown command: "constructor".');
    expect(result.standardError).not.toContain('TypeError');
  }, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);
});

/**
 * One real session through the installed entry point: separate processes against one tracker on disk,
 * the only place the lock, the atomic writes and the `bun link`ed template lookups run together.
 */
describe.skipIf(!gitIsAvailable())('a whole session through the binary', () => {
  test('init, a ticket through its whole life, a task, a log line, and the JSON an agent reads', async () => {
    const repositoryDirectory = createScratchGitRepository('binary-smoke-session');

    try {
      const run = async (commandLineArguments: readonly string[]): Promise<string> => {
        const result = await runAgentProgress(commandLineArguments, { currentDirectory: repositoryDirectory });
        expect(result.exitCode, `\`agent-progress ${commandLineArguments.join(' ')}\` failed: ${result.standardError}`).toBe(0);
        return result.standardOutput;
      };

      const refused = async (commandLineArguments: readonly string[]): Promise<string> => {
        const result = await runAgentProgress(commandLineArguments, { currentDirectory: repositoryDirectory });
        expect(result.exitCode, `\`agent-progress ${commandLineArguments.join(' ')}\` was not refused`).toBe(1);
        return result.standardError;
      };

      await run(['init', '--project', 'Example Agency']);
      expect(await run(['ticket', 'add', 'Double-click a role to edit it', '--type', 'change'])).toContain('Ticket #001 filed');
      await run(['ticket', 'start', '1', '--at', '-2h']);
      expect(await run(['task', 'add', 'Review pass', '--start', '--owner', 'Alex Example'])).toContain('Task #2 added');
      expect(await run(['task', 'pause', '2'])).toContain('Task #2 paused');
      await run(['task', 'start', '2']);
      await run(['log', 'Halfway through the role editor', '--at', '-5m']);
      expect(await refused(['ticket', 'deliver', '1'])).toContain('agent-progress ticket status 001 delivered');
      await run(['ticket', 'finish', '1', '--at', '-1h']);
      await run(['ticket', 'approve', '1', '--commit', 'abc1234', '--tokens', '12k']);
      await run(['ticket', 'deliver', '1']);

      const document = JSON.parse(await run(['status', '--json', '--full'])) as {
        project:    string;
        version:    number;
        nextTaskId: number;
        tasks:      Array<{ id: number; name: string; status: string; ticket: string | null; start: string | null; end: string | null; tokens: number | null }>;
        tickets:    Array<{ id: string; status: string; type: string; task: number | null; commit?: string }>;
        log:        Array<{ text: string }>;
      };

      expect(document.project).toBe('Example Agency');
      expect(document.version, 'the whole progress file, not a summary of it').toBe(1);
      expect(document.nextTaskId).toBe(3);
      expect(document.tasks[0]).toMatchObject({
        id:     1,
        name:   '#001 Double-click a role to edit it',
        status: 'delivered',
        ticket: '001',
        tokens: 12_000,
      });
      expect(document.tasks[0]?.start).not.toBeNull();
      expect(document.tasks[0]?.end).not.toBeNull();
      expect(document.tasks[1]).toMatchObject({
        id:     2,
        name:   'Review pass',
        status: 'in-progress',
        ticket: null,
        tokens: null,
      });

      expect(document.tickets).toHaveLength(1);
      expect(document.tickets[0]).toMatchObject({
        id:     '001',
        status: 'delivered',
        type:   'change',
        task:   1,
        commit: 'abc1234',
      });

      expect(document.log.map((entry) => entry.text)).toEqual([
        'Ticket #001 filed: Double-click a role to edit it',
        'Ticket #001 started',
        'Halfway through the role editor',
        'Ticket #001 in review',
        'Ticket #001 reviewed',
        'Ticket #001 delivered',
      ]);

      const dashboard = readFileSync(join(repositoryDirectory, '.agent-progress', 'progress.html'), 'utf8');
      expect(dashboard).toContain('Double-click a role to edit it');
      expect(dashboard).toContain('Review pass');
    } finally {
      removeScratchDirectory(repositoryDirectory);
    }
  }, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);
});

// The orchestrator reads this hint from the command's printed output, so it is pinned where a process prints it, and so is its absence from the JSON.
describe.skipIf(!gitIsAvailable())('unholding a ticket whose build was left paused, through the binary', () => {
  test('names the single-ticket dispatcher run in the human output only in that state, and never under --json', async () => {
    const repositoryDirectory = createScratchGitRepository('binary-smoke-unhold');
    const resumeBuildHint = 'launch a single-ticket dispatcher run for #001';

    try {
      const run = async (commandLineArguments: readonly string[]): Promise<string> => {
        const result = await runAgentProgress(commandLineArguments, { currentDirectory: repositoryDirectory });
        expect(result.exitCode, `\`agent-progress ${commandLineArguments.join(' ')}\` failed: ${result.standardError}`).toBe(0);
        return result.standardOutput;
      };

      await run(['init', '--project', 'Example Agency']);
      await run(['ticket', 'add', 'Show the role history']);
      await run(['ticket', 'claim', '1', '--note', 'Built by the whole-board dispatcher run on ticket-001']);
      await run(['ticket', 'hold', '1']);
      expect(await run(['ticket', 'unhold', '1'])).not.toContain(resumeBuildHint);

      await run(['task', 'pause', '1']);
      await run(['ticket', 'hold', '1']);
      const jsonOutput = await run(['ticket', 'unhold', '1', '--json']);
      expect(jsonOutput).not.toContain(resumeBuildHint);
      expect((JSON.parse(jsonOutput) as { status: string }).status).toBe('in-progress');

      await run(['ticket', 'hold', '1']);
      expect((await run(['ticket', 'unhold', '1'])).trimEnd().split('\n').at(-1)).toContain(resumeBuildHint);
    } finally {
      removeScratchDirectory(repositoryDirectory);
    }
  }, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);
});

describe.skipIf(!gitIsAvailable())('a bare repository, through the binary', () => {
  test('init refuses it and writes nothing into the directory that holds it', async () => {
    const parentDirectory = createScratchDirectory('binary-smoke-bare');
    try {
      const bareDirectory = join(parentDirectory, 'example.git');
      Bun.spawnSync(['git', 'init', '-q', '--bare', bareDirectory], { stdout: 'pipe', stderr: 'pipe' });

      const result = await runAgentProgress(['init'], { currentDirectory: bareDirectory });

      expect(result.exitCode).toBe(1);
      expect(result.standardError).toContain('bare git repository');
      expect(existsSync(join(parentDirectory, '.agent-progress'))).toBe(false);
      expect(existsSync(join(parentDirectory, 'CLAUDE.md'))).toBe(false);
    } finally {
      removeScratchDirectory(parentDirectory);
    }
  }, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);
});
