/**
 * Real directories for the specs that decide from what is on disk; nothing here calls `process.chdir`, because the suite is one process and a
 * changed working directory would be a cross-test dependency invisible from either file. Test-only: nothing that ships may import
 * `src/testing/`.
 */
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join }   from 'node:path';

import { workspacePathsFor } from '../services/tracker/Workspace.ts';

const SCRATCH_COMMIT_AUTHOR_NAME  = 'Alex Example';
const SCRATCH_COMMIT_AUTHOR_EMAIL = 'alex.example@example.com';

/** The `-c` pairs any git command that writes a commit in a scratch repository needs, whatever the machine's own configuration says. */
export const SCRATCH_COMMIT_IDENTITY_ARGUMENTS = [
  '-c',
  `user.name=${SCRATCH_COMMIT_AUTHOR_NAME}`,
  '-c',
  `user.email=${SCRATCH_COMMIT_AUTHOR_EMAIL}`,
  '-c',
  'commit.gpgsign=false',
] as const;

export function gitIsAvailable(): boolean {
  return Bun.which('git') !== null;
}

export function createScratchDirectory(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `agent-progress-${prefix}-`));
}

/** Resolved through symlinks (`/private/var` rather than `/var` on macOS), so it compares equal to a path discovery found. */
export function createCanonicalScratchDirectory(prefix: string): string {
  return realpathSync(createScratchDirectory(prefix));
}

/** Just enough of a tracker for discovery to find one at this root: its directory and a progress file. */
export function writeMinimalTracker(rootDirectory: string): string {
  const { progressFilePath, trackerDirectory } = workspacePathsFor(rootDirectory);
  mkdirSync(trackerDirectory, { recursive: true });
  writeFileSync(progressFilePath, '{"version":1}');
  return rootDirectory;
}

/** The empty commit is not decoration: `git worktree add` refuses a repository with no commits. */
export function createScratchGitRepository(prefix: string): string {
  const repositoryDirectory = createScratchDirectory(prefix);
  gitOutputIn(repositoryDirectory, ['init', '-q']);
  gitOutputIn(repositoryDirectory, [...SCRATCH_COMMIT_IDENTITY_ARGUMENTS, 'commit', '-q', '--allow-empty', '-m', 'Initial commit']);
  return repositoryDirectory;
}

/** Created beside the repository, never inside it, so a walk up from the worktree cannot find the main checkout's tracker by accident. */
export function addWorktree(repositoryDirectory: string, name: string): string {
  const worktreeDirectory = join(`${repositoryDirectory}-worktrees`, name);
  gitOutputIn(repositoryDirectory, ['worktree', 'add', '-q', '-b', `worktree/${name}`, worktreeDirectory]);
  return worktreeDirectory;
}

/** Writes the file, commits it alone, and answers the new commit. */
export function commitFile(repositoryDirectory: string, fileName: string, content: string): string {
  writeFileSync(join(repositoryDirectory, fileName), content);
  gitOutputIn(repositoryDirectory, ['add', '--', fileName]);
  gitOutputIn(repositoryDirectory, [...SCRATCH_COMMIT_IDENTITY_ARGUMENTS, 'commit', '-q', '-m', `Change ${fileName}`]);
  return gitOutputIn(repositoryDirectory, ['rev-parse', 'HEAD']);
}

export function currentBranchOf(repositoryDirectory: string): string {
  return gitOutputIn(repositoryDirectory, ['symbolic-ref', '--short', 'HEAD']);
}

/** `force`, so an `afterEach` cleaning up after a test that failed before creating anything does not turn one red test into two. */
export function removeScratchDirectory(directory: string): void {
  rmSync(directory, { recursive: true, force: true });
}

/** Throws on a non-zero exit, so a scratch setup step that failed stops the test instead of leaving it to assert on the wrong state. */
export function gitOutputIn(workingDirectory: string, gitArguments: readonly string[]): string {
  if (!gitIsAvailable()) {
    throw new Error('git is not on the PATH; a spec needing a scratch repository must skip through gitIsAvailable().');
  }
  const finished = Bun.spawnSync(['git', ...gitArguments], { cwd: workingDirectory, stdout: 'pipe', stderr: 'pipe' });
  if (finished.exitCode !== 0) {
    const reason = new TextDecoder().decode(finished.stderr).trim();
    throw new Error(`git ${gitArguments.join(' ')} failed in ${workingDirectory}: ${reason}`);
  }
  return new TextDecoder().decode(finished.stdout).trim();
}
