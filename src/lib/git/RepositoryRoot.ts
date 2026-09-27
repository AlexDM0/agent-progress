/**
 * The root of the repository a directory belongs to, the same for every worktree of it. `git rev-parse --git-common-dir` resolves a
 * worktree to the repository that owns it, relative to the directory asked about, and every answer is `realpath`-resolved, so two
 * spellings of one directory give one root.
 */
import {
  existsSync,
  readFileSync,
  realpathSync,
  statSync
} from 'node:fs';
import {
  basename,
  dirname,
  isAbsolute,
  resolve
} from 'node:path';

import { GitProcess }     from './GitProcess.ts';
import { GIT_ENTRY_NAME } from './constants/GitConventions.ts';

const WORKTREE_GIT_DIRECTORY_SEGMENT = '/.git/worktrees/';

const BARE_REPOSITORY_ANSWER = 'true';

/** `git` found a checkout, `bare-repository` found a repository with no working tree, and `directory` found nothing and hands the start back. */
export interface RepositoryRootDiscovery {
  rootDirectory: string;
  source:        'git' | 'bare-repository' | 'directory';
}

function resolvedRealPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * `null` covers a missing binary, a directory outside any repository and a question that does not
 * apply, which is what lets `--show-toplevel` be asked speculatively where a bare repository refuses it.
 */
function gitAnswer(directory: string, gitArguments: readonly string[]): string | null {
  const run = GitProcess.run(directory, gitArguments);
  if (!GitProcess.succeeded(run)) return null;
  const answer = run.standardOutput.trim();
  return answer.length > 0 ? answer : null;
}

/** A `.git` file pointing at `/abs/.git/worktrees/<name>` names `/abs`; anything else, a submodule, means the containing directory. */
function repositoryRootFromGitFile(gitFilePath: string, containingDirectory: string): string {
  const pointer = readFileSync(gitFilePath, 'utf8').trim();
  const gitDirectory = pointer.startsWith('gitdir:') ? pointer.slice('gitdir:'.length).trim() : '';
  const worktreeSegmentIndex = gitDirectory.indexOf(WORKTREE_GIT_DIRECTORY_SEGMENT);
  if (worktreeSegmentIndex > 0) {
    const mainCheckout = gitDirectory.slice(0, worktreeSegmentIndex);
    if (isAbsolute(mainCheckout)) return mainCheckout;
    return resolve(containingDirectory, mainCheckout);
  }
  return containingDirectory;
}

function repositoryRootWithoutGit(directory: string): string | null {
  let candidate = directory;
  for (;;) {
    const gitEntryPath = resolve(candidate, GIT_ENTRY_NAME);
    if (existsSync(gitEntryPath)) {
      try {
        if (statSync(gitEntryPath).isDirectory()) return candidate;
        return repositoryRootFromGitFile(gitEntryPath, candidate);
      } catch {
        // An unreadable `.git` tells us nothing to act on; keep walking rather than claim this directory.
      }
    }
    const parentDirectory = dirname(candidate);
    if (parentDirectory === candidate) return null;
    candidate = parentDirectory;
  }
}

export function discoverRepositoryRoot(currentDirectory: string): RepositoryRootDiscovery {
  const startingDirectory = resolvedRealPath(resolve(currentDirectory));

  const commonDirectory = gitAnswer(startingDirectory, ['rev-parse', '--git-common-dir']);
  if (commonDirectory !== null) {
    const resolvedCommonDirectory = resolve(startingDirectory, commonDirectory);

    // Only a common directory that really is a `.git` beside a checkout has that checkout as its parent:
    // a submodule's is `<superproject>/.git/modules/<name>` and a bare repository's is the repository itself.
    if (basename(resolvedCommonDirectory) === GIT_ENTRY_NAME) {
      return { rootDirectory: resolvedRealPath(dirname(resolvedCommonDirectory)), source: 'git' };
    }

    const workingTree = gitAnswer(startingDirectory, ['rev-parse', '--show-toplevel']);
    if (workingTree !== null) return { rootDirectory: resolvedRealPath(workingTree), source: 'git' };

    if (gitAnswer(startingDirectory, ['rev-parse', '--is-bare-repository']) === BARE_REPOSITORY_ANSWER) {
      return { rootDirectory: startingDirectory, source: 'bare-repository' };
    }
  }

  const rootWithoutGit = repositoryRootWithoutGit(startingDirectory);
  if (rootWithoutGit !== null) return { rootDirectory: resolvedRealPath(rootWithoutGit), source: 'git' };

  return { rootDirectory: startingDirectory, source: 'directory' };
}
