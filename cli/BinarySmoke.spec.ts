/**
 * The real binary, spawned — the one suite here that does, so the shebang, the `Bun.argv` slice and
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
import { runAgentProgress } from '../lib/tooling/dev/CliProcess';
import {
  createScratchDirectory,
  createScratchGitRepository,
  gitIsAvailable,
  removeScratchDirectory
} from '../lib/tooling/dev/ScratchWorkspace';

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
  });

  test('refuses a word that is not a command with exit 1', async () => {
    const result = await runAgentProgress(['nosuchcommand'], { currentDirectory: scratchDirectory });
    expect(result.exitCode).toBe(1);
    expect(result.standardError).toContain('Unknown command: "nosuchcommand".');
  });

  // The hazard that exits 0 when it is unguarded, which is the only thing a calling script reads.
  test('refuses an inherited property of the command table with exit 1', async () => {
    const result = await runAgentProgress(['constructor'], { currentDirectory: scratchDirectory });
    expect(result.exitCode).toBe(1);
    expect(result.standardError).toContain('Unknown command: "constructor".');
    expect(result.standardError).not.toContain('TypeError');
  });
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
      await run(['ticket', 'review', '1', '--at', '-1h']);
      await run(['ticket', 'done', '1', '--commit', 'abc1234', '--tokens', '12k']);
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
        id: 2, name: 'Review pass', status: 'running', ticket: null, tokens: null 
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
        'Ticket #001 done',
        'Ticket #001 delivered',
      ]);

      const dashboard = readFileSync(join(repositoryDirectory, '.agent-progress', 'progress.html'), 'utf8');
      expect(dashboard).toContain('Double-click a role to edit it');
      expect(dashboard).toContain('Review pass');
    } finally {
      removeScratchDirectory(repositoryDirectory);
    }
  });
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
  });
});
