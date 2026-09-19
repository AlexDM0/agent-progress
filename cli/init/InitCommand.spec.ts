/**
 * What `agent-progress init` leaves behind and what a second one does, including the root discovered from inside a linked worktree.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';

import {
  afterEach,
  describe,
  expect,
  test
}                                                              from 'bun:test';
import { CLAUDE_MANAGED_START }         from '../../lib/constants/Statuses';
import { createCapturedCommandContext } from '../../lib/tooling/dev/CapturedCommandContext';
import {
  addWorktree,
  createScratchDirectory,
  createScratchGitRepository,
  gitIsAvailable,
  removeScratchDirectory
}                                                              from '../../lib/tooling/dev/ScratchWorkspace';
import { runCommandLine } from '../Main';

const scratchDirectories: string[] = [];

function scratchRepository(): string {
  const repositoryDirectory = createScratchGitRepository('init-command');
  scratchDirectories.push(repositoryDirectory, `${repositoryDirectory}-worktrees`);
  return repositoryDirectory;
}

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) removeScratchDirectory(directory);
});

describe.skipIf(!gitIsAvailable())('initialising a repository', () => {
  test('creates the tracker tree, ignores it, writes the CLAUDE.md block and renders a page', async () => {
    const repositoryDirectory = scratchRepository();
    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory });

    expect(await runCommandLine(['init', '--project', 'Example Agency'], context)).toBe(0);

    expect(existsSync(join(repositoryDirectory, '.agent-progress', 'progress.json'))).toBe(true);
    expect(existsSync(join(repositoryDirectory, '.agent-progress', 'tickets'))).toBe(true);
    expect(existsSync(join(repositoryDirectory, '.agent-progress', 'progress.html'))).toBe(true);
    expect(readFileSync(join(repositoryDirectory, '.gitignore'), 'utf8')).toContain('.agent-progress/');

    const claudeInstructions = readFileSync(join(repositoryDirectory, 'CLAUDE.md'), 'utf8');
    expect(claudeInstructions).toContain(CLAUDE_MANAGED_START);
    expect(claudeInstructions).toContain('agent-progress');

    expect(readFileSync(join(repositoryDirectory, '.agent-progress', 'progress.json'), 'utf8')).toContain('Example Agency');
    expect(context.outputText()).toContain('.gitignore:');
    expect(context.outputText()).toContain('progress.html');
    expect(context.errorText()).toBe('');
  });

  test('the project name defaults to the directory the tracker is in', async () => {
    const repositoryDirectory = scratchRepository();
    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory });

    await runCommandLine(['init'], context);

    const stored = JSON.parse(readFileSync(join(repositoryDirectory, '.agent-progress', 'progress.json'), 'utf8')) as { project: string };
    expect(repositoryDirectory.endsWith(stored.project)).toBe(true);
  });

  test('--no-claude-md leaves the repository\'s instructions file exactly as it was', async () => {
    const repositoryDirectory = scratchRepository();
    const claudeFilePath      = join(repositoryDirectory, 'CLAUDE.md');
    writeFileSync(claudeFilePath, '# Example Agency\n\nRules nobody asked this tool to touch.\n');
    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory });

    expect(await runCommandLine(['init', '--no-claude-md'], context)).toBe(0);

    expect(readFileSync(claudeFilePath, 'utf8')).toBe('# Example Agency\n\nRules nobody asked this tool to touch.\n');
    expect(existsSync(join(repositoryDirectory, '.agent-progress', 'progress.json'))).toBe(true);
  });

  test('--root tracks the directory it names rather than the discovered repository root', async () => {
    const repositoryDirectory = scratchRepository();
    const plainDirectory      = createScratchGitRepository('init-command-root');
    scratchDirectories.push(plainDirectory);
    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory });

    expect(await runCommandLine(['init', '--root', plainDirectory], context)).toBe(0);

    expect(existsSync(join(plainDirectory, '.agent-progress', 'progress.json'))).toBe(true);
    expect(existsSync(join(repositoryDirectory, '.agent-progress', 'progress.json'))).toBe(false);
  });
});

describe.skipIf(!gitIsAvailable())('a second init', () => {
  test('at the same root refreshes the CLAUDE.md block, keeps the tracker and exits 0', async () => {
    const repositoryDirectory = scratchRepository();
    const first = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    await runCommandLine(['init'], first);
    const progressFilePath = join(repositoryDirectory, '.agent-progress', 'progress.json');
    const trackerIdBefore  = (JSON.parse(readFileSync(progressFilePath, 'utf8')) as { trackerId: string }).trackerId;

    const claudeFilePath = join(repositoryDirectory, 'CLAUDE.md');
    writeFileSync(claudeFilePath, `${CLAUDE_MANAGED_START}\n<!-- agent-progress:managed:end -->\n`);

    const second = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['init'], second)).toBe(0);

    expect(second.outputText()).toContain('already initialised');
    expect(readFileSync(claudeFilePath, 'utf8')).toContain('agent-progress');
    // The tracker id is the page's localStorage key, so a re-run that reset it would reset every reader's stored range.
    expect((JSON.parse(readFileSync(progressFilePath, 'utf8')) as { trackerId: string }).trackerId).toBe(trackerIdBefore);
  });

  test('one directory below an existing tracker is refused with exit 1 and names where the tracker is', async () => {
    const repositoryDirectory = scratchRepository();
    await runCommandLine(['init'], createCapturedCommandContext({ currentDirectory: repositoryDirectory }));
    const nestedDirectory = join(repositoryDirectory, 'packages', 'example');
    mkdirSync(nestedDirectory, { recursive: true });

    const context = createCapturedCommandContext({ currentDirectory: nestedDirectory });
    expect(await runCommandLine(['init', '--root', nestedDirectory], context)).toBe(1);

    expect(context.errorText()).toContain(repositoryDirectory);
    expect(existsSync(join(nestedDirectory, '.agent-progress'))).toBe(false);
  });
});

describe.skipIf(!gitIsAvailable())('from inside a linked worktree', () => {
  test('the tracker is created in the main checkout, not in the worktree', async () => {
    const repositoryDirectory = scratchRepository();
    const worktreeDirectory   = addWorktree(repositoryDirectory, 'subagent');

    const context = createCapturedCommandContext({ currentDirectory: worktreeDirectory });
    expect(await runCommandLine(['init'], context)).toBe(0);

    expect(existsSync(join(repositoryDirectory, '.agent-progress', 'progress.json'))).toBe(true);
    expect(existsSync(join(worktreeDirectory, '.agent-progress'))).toBe(false);
  });
});

describe.skipIf(!gitIsAvailable())('the two places init refuses before it writes anything', () => {
  test('a bare repository is refused, rather than tracked from its parent directory', async () => {
    const parentDirectory = createScratchDirectory('init-bare-parent');
    scratchDirectories.push(parentDirectory);
    const bareDirectory = join(parentDirectory, 'example.git');
    Bun.spawnSync(['git', 'init', '-q', '--bare', bareDirectory], { stdout: 'pipe', stderr: 'pipe' });

    const context  = createCapturedCommandContext({ currentDirectory: bareDirectory });
    const exitCode = await runCommandLine(['init'], context);

    expect(exitCode).toBe(1);
    expect(context.errorText()).toContain('bare git repository');
    expect(existsSync(join(parentDirectory, '.agent-progress')), 'nothing was written beside the bare repository').toBe(false);
    expect(existsSync(join(parentDirectory, 'CLAUDE.md'))).toBe(false);
  });

  test('--root naming a file or a path that is not there is refused with exit 1, not a raw errno', async () => {
    const repositoryDirectory = scratchRepository();
    writeFileSync(join(repositoryDirectory, 'notes.txt'), 'not a directory\n');

    for (const rootOption of ['notes.txt', 'no-such-directory']) {
      const context  = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
      const exitCode = await runCommandLine(['init', '--root', rootOption], context);

      expect(exitCode, rootOption).toBe(1);
      expect(context.errorText(), rootOption).toContain('is not an existing directory');
    }
    expect(existsSync(join(repositoryDirectory, 'no-such-directory'))).toBe(false);
  });

  test('the .gitignore line is reported in words a person reads, not as a verdict name', async () => {
    const repositoryDirectory = scratchRepository();

    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    await runCommandLine(['init'], context);

    expect(context.outputText()).toContain('.gitignore:  entry added');
    expect(context.outputText()).not.toContain('no-gitignore-written');
  });
});
