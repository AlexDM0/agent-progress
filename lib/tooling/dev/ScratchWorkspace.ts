/**
 * Real directories for the specs that decide from what is on disk; nothing here calls `process.chdir`, because the suite is one process and a
 * changed working directory would be a cross-test dependency invisible from either file. Test-only: nothing that ships may import
 * `lib/tooling/dev/`, and `lib/ImportDirection.spec.ts` fails the build on any non-spec import of it.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir }              from 'node:os';
import { join }                from 'node:path';

const SCRATCH_COMMIT_AUTHOR_NAME  = 'Alex Example';
const SCRATCH_COMMIT_AUTHOR_EMAIL = 'alex.example@example.com';

export function gitIsAvailable(): boolean {
  return Bun.which('git') !== null;
}

export function createScratchDirectory(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `agent-progress-${prefix}-`));
}

/** The empty commit is not decoration: `git worktree add` refuses a repository with no commits. */
export function createScratchGitRepository(prefix: string): string {
  const repositoryDirectory = createScratchDirectory(prefix);
  runGit(repositoryDirectory, ['init', '-q']);
  runGit(repositoryDirectory, [
    '-c',
    `user.name=${SCRATCH_COMMIT_AUTHOR_NAME}`,
    '-c',
    `user.email=${SCRATCH_COMMIT_AUTHOR_EMAIL}`,
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'Initial commit',
  ]);
  return repositoryDirectory;
}

/** Created beside the repository, never inside it, so a walk up from the worktree cannot find the main checkout's tracker by accident. */
export function addWorktree(repositoryDirectory: string, name: string): string {
  const worktreeDirectory = join(`${repositoryDirectory}-worktrees`, name);
  runGit(repositoryDirectory, ['worktree', 'add', '-q', '-b', `worktree/${name}`, worktreeDirectory]);
  return worktreeDirectory;
}

/** `force`, so an `afterEach` cleaning up after a test that failed before creating anything does not turn one red test into two. */
export function removeScratchDirectory(directory: string): void {
  rmSync(directory, { recursive: true, force: true });
}

function runGit(workingDirectory: string, gitArguments: readonly string[]): void {
  if (!gitIsAvailable()) {
    throw new Error('git is not on the PATH; a spec needing a scratch repository must skip through gitIsAvailable().');
  }
  const finished = Bun.spawnSync(['git', ...gitArguments], { cwd: workingDirectory, stdout: 'pipe', stderr: 'pipe' });
  if (finished.exitCode !== 0) {
    const reason = new TextDecoder().decode(finished.stderr).trim();
    throw new Error(`git ${gitArguments.join(' ')} failed in ${workingDirectory}: ${reason}`);
  }
}
