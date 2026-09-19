/**
 * The root each shape of working directory resolves to: repository, subdirectory, linked worktree,
 * submodule, bare repository and none. Every subagent worktree must reach the main checkout.
 */
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join, sep }                              from 'node:path';
import {
  afterAll,
  describe,
  expect,
  test
} from 'bun:test';

import {
  addWorktree,
  createScratchDirectory,
  createScratchGitRepository,
  gitIsAvailable,
  removeScratchDirectory
} from '../tooling/dev/ScratchWorkspace';
import { discoverRepositoryRoot } from './RepositoryRoot';

const scratchDirectories: string[] = [];

/** `realpath` of a scratch path, because macOS hands out `/var/folders/...` and resolves it to `/private/var/folders/...`. */
function realPathOf(path: string): string {
  return realpathSync(path);
}

function scratchGitRepository(prefix: string): string {
  const repositoryDirectory = createScratchGitRepository(prefix);
  scratchDirectories.push(repositoryDirectory, `${repositoryDirectory}-worktrees`);
  return repositoryDirectory;
}

function scratchDirectory(prefix: string): string {
  const directory = createScratchDirectory(prefix);
  scratchDirectories.push(directory);
  return directory;
}

function runGit(workingDirectory: string, gitArguments: readonly string[]): void {
  const finished = Bun.spawnSync(['git', ...gitArguments], { cwd: workingDirectory, stdout: 'pipe', stderr: 'pipe' });
  if (finished.exitCode !== 0) {
    throw new Error(`git ${gitArguments.join(' ')} failed in ${workingDirectory}: ${new TextDecoder().decode(finished.stderr).trim()}`);
  }
}

afterAll(() => {
  for (const directory of scratchDirectories) removeScratchDirectory(directory);
});

describe.skipIf(!gitIsAvailable())('with git on the machine', () => {
  test('a plain repository is its own root', () => {
    const repositoryDirectory = scratchGitRepository('repository-root-plain');
    const discovered = discoverRepositoryRoot(repositoryDirectory);
    expect(discovered.source).toBe('git');
    expect(discovered.rootDirectory).toBe(realPathOf(repositoryDirectory));
  });

  test('a subdirectory resolves to the repository, not to itself', () => {
    const repositoryDirectory = scratchGitRepository('repository-root-subdirectory');
    const nestedDirectory = join(repositoryDirectory, 'deep', 'nested');
    mkdirSync(nestedDirectory, { recursive: true });
    const discovered = discoverRepositoryRoot(nestedDirectory);
    expect(discovered.rootDirectory).toBe(realPathOf(repositoryDirectory));
    expect(discovered.source).toBe('git');
  });

  test('a linked worktree resolves to the main repository, which is what lets every subagent share one tracker', () => {
    const repositoryDirectory = scratchGitRepository('repository-root-worktree');
    const worktreeDirectory = addWorktree(repositoryDirectory, 'subagent');
    const discovered = discoverRepositoryRoot(worktreeDirectory);
    expect(discovered.rootDirectory).toBe(realPathOf(repositoryDirectory));
    expect(discovered.source).toBe('git');
  });

  test('a subdirectory of a linked worktree resolves to the main repository too', () => {
    const repositoryDirectory = scratchGitRepository('repository-root-worktree-deep');
    const worktreeDirectory = addWorktree(repositoryDirectory, 'subagent');
    const nestedDirectory = join(worktreeDirectory, 'packages', 'example');
    mkdirSync(nestedDirectory, { recursive: true });
    expect(discoverRepositoryRoot(nestedDirectory).rootDirectory).toBe(realPathOf(repositoryDirectory));
  });

  test('a submodule resolves to its own checkout, never into the superproject\'s .git/modules', () => {
    const superprojectDirectory = scratchGitRepository('repository-root-superproject');
    const submoduleSource       = scratchGitRepository('repository-root-submodule-source');
    // `protocol.file.allow` is off by default since git 2.38, so a submodule cannot be added from a local path without it.
    runGit(superprojectDirectory, ['-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', submoduleSource, 'example']);

    const submoduleCheckout = join(superprojectDirectory, 'example');
    const discovered        = discoverRepositoryRoot(submoduleCheckout);

    expect(discovered.rootDirectory).toBe(realPathOf(submoduleCheckout));
    expect(discovered.source).toBe('git');
    expect(discovered.rootDirectory).not.toContain('.git');
  });

  test('a subdirectory of a submodule resolves to the submodule, not to the superproject', () => {
    const superprojectDirectory = scratchGitRepository('repository-root-submodule-deep');
    const submoduleSource       = scratchGitRepository('repository-root-submodule-deep-source');
    runGit(superprojectDirectory, ['-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', submoduleSource, 'example']);
    const nestedDirectory = join(superprojectDirectory, 'example', 'packages', 'inner');
    mkdirSync(nestedDirectory, { recursive: true });

    expect(discoverRepositoryRoot(nestedDirectory).rootDirectory).toBe(realPathOf(join(superprojectDirectory, 'example')));
  });

  test('a bare repository is reported as bare, so nothing is ever written beside it', () => {
    const bareDirectory = scratchDirectory('repository-root-bare');
    runGit(bareDirectory, ['init', '-q', '--bare']);

    const discovered = discoverRepositoryRoot(bareDirectory);

    expect(discovered.source).toBe('bare-repository');
    expect(discovered.rootDirectory).toBe(realPathOf(bareDirectory));
  });

  test('the main repository and one of its worktrees agree on the root, exactly', () => {
    const repositoryDirectory = scratchGitRepository('repository-root-agreement');
    const worktreeDirectory = addWorktree(repositoryDirectory, 'subagent');
    expect(discoverRepositoryRoot(worktreeDirectory).rootDirectory).toBe(discoverRepositoryRoot(repositoryDirectory).rootDirectory);
  });
});

test('a directory in no repository is its own root, and says so', () => {
  const plainDirectory = scratchDirectory('repository-root-plain-directory');
  const discovered = discoverRepositoryRoot(plainDirectory);
  expect(discovered.rootDirectory).toBe(realPathOf(plainDirectory));
  expect(discovered.source).toBe('directory');
});

test('a worktree pointer file is read by hand, so a machine with no git still shares one tracker', () => {
  const mainCheckout = scratchDirectory('repository-root-pointer-main');
  mkdirSync(join(mainCheckout, '.git', 'worktrees', 'subagent'), { recursive: true });
  const worktreeDirectory = scratchDirectory('repository-root-pointer-worktree');
  writeFileSync(join(worktreeDirectory, '.git'), `gitdir: ${join(realPathOf(mainCheckout), '.git', 'worktrees', 'subagent')}\n`);

  const discovered = discoverRepositoryRoot(worktreeDirectory);
  expect(discovered.rootDirectory).toBe(realPathOf(mainCheckout));
  expect(discovered.source).toBe('git');
});

test('a .git file that is not a worktree pointer leaves the root at the directory holding it', () => {
  const submoduleDirectory = scratchDirectory('repository-root-submodule');
  writeFileSync(join(submoduleDirectory, '.git'), 'gitdir: ../.git/modules/example\n');
  const discovered = discoverRepositoryRoot(submoduleDirectory);
  expect(discovered.rootDirectory).toBe(realPathOf(submoduleDirectory));
  expect(discovered.source).toBe('git');
});

test('the answer is always absolute, whatever spelling the caller used', () => {
  const plainDirectory = scratchDirectory('repository-root-absolute');
  const discovered = discoverRepositoryRoot(join(plainDirectory, '.'));
  expect(discovered.rootDirectory.startsWith(sep)).toBe(true);
});
