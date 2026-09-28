/**
 * Real directories for the specs that decide from what is on disk; nothing here calls `process.chdir`, because the suite is one process and a
 * changed working directory would be a cross-test dependency invisible from either file. Test-only: nothing that ships may import
 * `src/testing/`.
 */
import {
  cpSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join }   from 'node:path';

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

const templateDirectories: string[] = [];

let emptyRepositoryTemplateDirectory: string | null = null;

/** Marks a scratch directory built once and copied by many cases, so it is removed only after the whole run. */
export function keptAsTemplateUntilTheRunEnds(templateDirectory: string): string {
  templateDirectories.push(templateDirectory);
  return templateDirectory;
}

/** Copies the template's contents into a fresh scratch directory. */
export function createScratchCopyOf(templateDirectory: string, prefix: string): string {
  const copyDirectory = createScratchDirectory(prefix);
  cpSync(templateDirectory, copyDirectory, { recursive: true });
  return copyDirectory;
}

/** The empty commit is not decoration: `git worktree add` refuses a repository with no commits. */
function emptyRepositoryTemplate(): string {
  if (emptyRepositoryTemplateDirectory === null) {
    const templateDirectory = keptAsTemplateUntilTheRunEnds(createScratchDirectory('repository-template'));
    gitOutputIn(templateDirectory, ['init', '-q']);
    gitOutputIn(templateDirectory, [...SCRATCH_COMMIT_IDENTITY_ARGUMENTS, 'commit', '-q', '--allow-empty', '-m', 'Initial commit']);
    emptyRepositoryTemplateDirectory = templateDirectory;
  }
  return emptyRepositoryTemplateDirectory;
}

/** A copy of one repository built once per run, since spawning git to build each one is most of what a git spec's setup costs. */
export function createScratchGitRepository(prefix: string): string {
  return createScratchCopyOf(emptyRepositoryTemplate(), prefix);
}

/** Called once, after the whole run, by the preload `src/testing/TestRunReport.ts`. */
export function removeScratchTemplates(): void {
  for (const templateDirectory of templateDirectories.splice(0)) removeScratchDirectory(templateDirectory);
  emptyRepositoryTemplateDirectory = null;
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
    throw new Error('git is not on the PATH; a spec needing a scratch repository must be guarded by src/testing/ToolGuard.ts.');
  }
  const finished = Bun.spawnSync(['git', ...gitArguments], { cwd: workingDirectory, stdout: 'pipe', stderr: 'pipe' });
  if (finished.exitCode !== 0) {
    const reason = new TextDecoder().decode(finished.stderr).trim();
    throw new Error(`git ${gitArguments.join(' ')} failed in ${workingDirectory}: ${reason}`);
  }
  return new TextDecoder().decode(finished.stdout).trim();
}
