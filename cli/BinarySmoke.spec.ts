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
import { ORIGINAL_PRODUCT_NAMES, PRODUCT_NAMES, SIDE_BY_SIDE_PRODUCT_NAMES }          from '../src/shared/constants/ProductNames.ts';
import { CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS }                                    from '../src/testing/ChildProcessCaseTimeout.ts';
import { createScratchDirectory, createScratchGitRepository, removeScratchDirectory } from '../src/testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent }                                                   from '../src/testing/ToolGuard.ts';
import { runAgentProgress }                                                           from './testing/CliProcess.ts';
import { READY_TICKET_BODY_ARGUMENTS }                                                from './testing/ReadyTicketFiling.ts';

let scratchDirectory = '';

const STANDALONE_PROGRAM_NAME_PATTERN = new RegExp(
  `(?<![\\w./-])(?:${[SIDE_BY_SIDE_PRODUCT_NAMES.PROGRAM, ORIGINAL_PRODUCT_NAMES.PROGRAM].map((name) => RegExp.escape(name)).join('|')})(?![\\w.:/-])`,
  'g',
);

/** The brief's row, ticket and review lines are markers a prompt carries, not a program to run. */
const BRIEF_MARKER_PATTERN = new RegExp(`${RegExp.escape(ORIGINAL_PRODUCT_NAMES.PROGRAM)} (?:row|ticket|review):`, 'g');

/** Every program name the text files `init` installed stand alone in, each once. */
function programNamesInstalledIn(repositoryDirectory: string): string[] {
  const installedPaths = [...new Bun.Glob('**/*').scanSync({ cwd: repositoryDirectory, dot: true })]
    .filter((path) => path === 'CLAUDE.md' || path.startsWith('.claude/') || (path.startsWith(`${PRODUCT_NAMES.DATA_FOLDER}/`) && path.endsWith('.md')));
  expect(installedPaths.length, 'installed files found').toBeGreaterThan(5);
  const texts = installedPaths.map((path) => readFileSync(join(repositoryDirectory, path), 'utf8').replaceAll(BRIEF_MARKER_PATTERN, ''));
  return [...new Set(texts.flatMap((text) => text.match(STANDALONE_PROGRAM_NAME_PATTERN) ?? []))];
}

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
    expect(result.standardOutput).toContain(`Usage: ${PRODUCT_NAMES.PROGRAM} <command> [options]`);
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
describeWhenGitIsPresent('a whole session through the binary', () => {
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
      expect(programNamesInstalledIn(repositoryDirectory)).toEqual([PRODUCT_NAMES.PROGRAM]);
      expect(await run(['ticket', 'add', 'Double-click a role to edit it', '--type', 'ticket', ...READY_TICKET_BODY_ARGUMENTS])).toContain('Ticket #001 filed');
      expect(await run(['ticket', 'ready', '1'])).toContain('Ticket #001 ready to build');

      const [, suggestedCommand = ''] = /`([^`]+)`/.exec(await refused(['ticket', 'show', '9'])) ?? [];
      const [suggestedProgram, ...suggestedArguments] = suggestedCommand.split(' ');
      expect(suggestedProgram, 'the program a refusal tells the agent to run is the one this build links').toBe(PRODUCT_NAMES.PROGRAM);
      expect(await run(suggestedArguments)).toContain('Double-click a role to edit it');
      await run(['ticket', 'status', '1', 'in-progress', '--at', '-2h']);
      expect(await run(['task', 'add', 'Review pass', '--start', '--owner', 'Alex Example'])).toContain('Task #2 added');
      expect(await run(['task', 'pause', '2'])).toContain('Task #2 paused');
      await run(['task', 'start', '2']);
      await run(['log', 'Halfway through the role editor', '--at', '-5m']);
      expect(await refused(['task', 'finish', '1'])).toContain(`${PRODUCT_NAMES.PROGRAM} ticket status 001 in-review`);
      await run(['ticket', 'status', '1', 'in-review', '--at', '-1h']);
      await run(['ticket', 'status', '1', 'reviewed', '--commit', 'abc1234', '--tokens', '12k']);
      await run(['ticket', 'deliver', '1', '--by-hand']);

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
        type:   'ticket',
        task:   1,
        commit: 'abc1234',
      });

      expect(document.log.map((entry) => entry.text)).toEqual([
        'Ticket #001 filed: Double-click a role to edit it',
        'Ticket #001 ready to build',
        'Ticket #001 started',
        'Halfway through the role editor',
        'Ticket #001 in review',
        'Ticket #001 reviewed',
        'Ticket #001 delivered',
      ]);

      const stub = readFileSync(join(repositoryDirectory, PRODUCT_NAMES.DATA_FOLDER, 'progress.html'), 'utf8');
      expect(stub).toContain('Overseer down');
    } finally {
      removeScratchDirectory(repositoryDirectory);
    }
  }, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);
});

describeWhenGitIsPresent('a bare repository, through the binary', () => {
  test('init refuses it and writes nothing into the directory that holds it', async () => {
    const parentDirectory = createScratchDirectory('binary-smoke-bare');
    try {
      const bareDirectory = join(parentDirectory, 'example.git');
      Bun.spawnSync(['git', 'init', '-q', '--bare', bareDirectory], { stdout: 'pipe', stderr: 'pipe' });

      const result = await runAgentProgress(['init'], { currentDirectory: bareDirectory });

      expect(result.exitCode).toBe(1);
      expect(result.standardError).toContain('bare git repository');
      expect(existsSync(join(parentDirectory, PRODUCT_NAMES.DATA_FOLDER))).toBe(false);
      expect(existsSync(join(parentDirectory, 'CLAUDE.md'))).toBe(false);
    } finally {
      removeScratchDirectory(parentDirectory);
    }
  }, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);
});
