/**
 * Refs and worktree HEADs at two moments, against real git in scratch repositories. What matters is that the snapshot holds every ref and
 * every worktree's HEAD, a detached one included, and that the difference names exactly what moved outside the allowed set: a ref moved,
 * created or deleted, and a worktree whose HEAD moved, but nothing allowed and nothing that stayed.
 */
import { afterAll, expect, test } from 'bun:test';

import {
  addWorktree,
  commitFile,
  createScratchDirectory,
  createScratchGitRepository,
  currentBranchOf,
  gitOutputIn,
  removeScratchDirectory
} from '../../testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent }                            from '../../testing/ToolGuard.ts';
import { refsMovedOutside, takeRefSnapshot, type RefSnapshot } from './RefSnapshot.ts';

const scratchDirectories: string[] = [];

afterAll(() => {
  for (const directory of scratchDirectories) removeScratchDirectory(directory);
});

function scratchGitRepository(prefix: string): string {
  const repositoryDirectory = createScratchGitRepository(prefix);
  scratchDirectories.push(repositoryDirectory, `${repositoryDirectory}-worktrees`);
  return repositoryDirectory;
}

function snapshotOf(repositoryDirectory: string): RefSnapshot {
  const reading = takeRefSnapshot(repositoryDirectory);
  if (reading.verdict !== 'read') throw new Error(`the snapshot was not read: ${reading.reason}`);
  return reading.snapshot;
}

/** git lists a worktree by its real path, which on macOS may differ from the scratch path through a symlinked temporary folder. */
function listedPathOf(worktreePath: string): string {
  return gitOutputIn(worktreePath, ['rev-parse', '--show-toplevel']);
}

describeWhenGitIsPresent('a ref snapshot', () => {
  test('it records every ref and every worktree\'s HEAD, a detached worktree included', () => {
    const repositoryDirectory = scratchGitRepository('ref-snapshot-record');
    const tip = gitOutputIn(repositoryDirectory, ['rev-parse', 'HEAD']);
    const worktreePath = addWorktree(repositoryDirectory, 'linked');
    gitOutputIn(worktreePath, ['checkout', '-q', '--detach']);
    gitOutputIn(repositoryDirectory, ['tag', 'marker']);
    expect(snapshotOf(repositoryDirectory)).toEqual({
      refs: {
        [`refs/heads/${currentBranchOf(repositoryDirectory)}`]: tip,
        'refs/heads/worktree/linked':                           tip,
        'refs/tags/marker':                                     tip,
      },
      worktreeHeads: { [listedPathOf(repositoryDirectory)]: tip, [listedPathOf(worktreePath)]: tip },
    });
  });

  test('outside any repository it reads git-failed', () => {
    const plainDirectory = createScratchDirectory('ref-snapshot-no-repository');
    scratchDirectories.push(plainDirectory);
    expect(takeRefSnapshot(plainDirectory).verdict).toBe('git-failed');
  });
});

describeWhenGitIsPresent('the difference between two snapshots', () => {
  test('it names each ref and worktree HEAD that moved, was created or was deleted outside the allowed set, and nothing else', () => {
    const repositoryDirectory = scratchGitRepository('ref-snapshot-difference');
    const tip = gitOutputIn(repositoryDirectory, ['rev-parse', 'HEAD']);
    const mainBranch = `refs/heads/${currentBranchOf(repositoryDirectory)}`;
    const worktreePath = addWorktree(repositoryDirectory, 'linked');
    gitOutputIn(repositoryDirectory, ['branch', 'doomed']);
    gitOutputIn(repositoryDirectory, ['branch', 'untouched']);
    const before = snapshotOf(repositoryDirectory);

    const mainCommit = commitFile(repositoryDirectory, 'main.txt', 'main\n');
    const linkedCommit = commitFile(worktreePath, 'linked.txt', 'linked\n');
    gitOutputIn(repositoryDirectory, ['branch', '-D', 'doomed']);
    gitOutputIn(repositoryDirectory, ['branch', 'created']);
    const after = snapshotOf(repositoryDirectory);

    expect(refsMovedOutside(before, after, { refs: [mainBranch], worktreePaths: [listedPathOf(repositoryDirectory)] })).toEqual([
      {
        kind: 'ref', name: 'refs/heads/created', before: null, after: mainCommit
      },
      {
        kind: 'ref', name: 'refs/heads/doomed', before: tip, after: null
      },
      {
        kind: 'ref', name: 'refs/heads/worktree/linked', before: tip, after: linkedCommit
      },
      {
        kind: 'worktree-head', name: listedPathOf(worktreePath), before: tip, after: linkedCommit
      },
    ]);
  });

  test('two snapshots with nothing moved, or with every movement allowed, differ in nothing', () => {
    const repositoryDirectory = scratchGitRepository('ref-snapshot-still');
    const before = snapshotOf(repositoryDirectory);
    expect(refsMovedOutside(before, snapshotOf(repositoryDirectory), { refs: [], worktreePaths: [] })).toEqual([]);
    commitFile(repositoryDirectory, 'main.txt', 'main\n');
    const allowed = { refs: [`refs/heads/${currentBranchOf(repositoryDirectory)}`], worktreePaths: [listedPathOf(repositoryDirectory)] };
    expect(refsMovedOutside(before, snapshotOf(repositoryDirectory), allowed)).toEqual([]);
  });
});
