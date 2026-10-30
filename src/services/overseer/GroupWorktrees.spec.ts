/**
 * A group's own worktree on a scratch repository. What matters: the first launch creates `group-<name>` from the main line's tip, a later
 * one reuses the branch as it stands rather than resetting it to main, a refresh worktree is detached so it never moves the group branch,
 * and the release's removal deletes the branch only through `branch -d`, never forced.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { join }                      from 'node:path';

import { afterEach, expect, test } from 'bun:test';
import {
  commitFile,
  createScratchGitRepository,
  gitOutputIn,
  removeScratchDirectory
}                                   from '../../testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent } from '../../testing/ToolGuard.ts';
import { GroupWorktrees }           from './GroupWorktrees.ts';

let repository: string | null = null;

afterEach(() => {
  if (repository === null) return;
  removeScratchDirectory(`${repository}-worktrees`);
  removeScratchDirectory(repository);
  repository = null;
});

function scratchRepository(): { root: string; worktreesRoot: string } {
  const root = createScratchGitRepository('group-worktrees');
  repository = root;
  gitOutputIn(root, ['checkout', '-q', '-B', 'main']);
  commitFile(root, 'base.ts', 'export const base = 1;\n');
  return { root, worktreesRoot: `${root}-worktrees` };
}

describeWhenGitIsPresent('a group worktree', () => {
  test('is created on group-<name> from the main line\'s tip at the first launch', () => {
    const { root, worktreesRoot } = scratchRepository();
    const prepared = GroupWorktrees.prepareGroupWorktree(root, worktreesRoot, 'group-example', 'main');
    expect(prepared).toEqual({ verdict: 'ready', path: join(worktreesRoot, 'group-example') });
    expect(gitOutputIn(join(worktreesRoot, 'group-example'), ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('group-example');
    expect(gitOutputIn(root, ['rev-parse', 'refs/heads/group-example'])).toBe(gitOutputIn(root, ['rev-parse', 'refs/heads/main']));
  });

  test('reuses an existing group branch as it stands, never moving it to main', () => {
    const { root, worktreesRoot } = scratchRepository();
    gitOutputIn(root, ['branch', 'group-example']);
    const groupTip = gitOutputIn(root, ['rev-parse', 'refs/heads/group-example']);
    commitFile(root, 'main-only.ts', 'export const mainOnly = 1;\n');
    GroupWorktrees.prepareGroupWorktree(root, worktreesRoot, 'group-example', 'main');
    expect(gitOutputIn(join(worktreesRoot, 'group-example'), ['rev-parse', 'HEAD'])).toBe(groupTip);
  });

  test('a refresh worktree is detached at the group tip, and the release removes the group and deletes its merged branch', () => {
    const { root, worktreesRoot } = scratchRepository();
    GroupWorktrees.prepareGroupWorktree(root, worktreesRoot, 'group-example', 'main');
    const groupTip = gitOutputIn(root, ['rev-parse', 'refs/heads/group-example']);
    const refresh = GroupWorktrees.prepareRefreshWorktree(root, worktreesRoot, 'group-example', groupTip);
    expect(refresh).toEqual({ verdict: 'ready', path: join(worktreesRoot, 'refresh-group-example') });
    expect(gitOutputIn(join(worktreesRoot, 'refresh-group-example'), ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('HEAD');
    expect(GroupWorktrees.removeWorktree(root, join(worktreesRoot, 'refresh-group-example'))).toBeNull();
    expect(GroupWorktrees.removeGroup(root, worktreesRoot, 'group-example')).toBeNull();
    expect(existsSync(join(worktreesRoot, 'group-example'))).toBe(false);
    expect(Bun.spawnSync(['git', 'rev-parse', '--verify', '--quiet', 'refs/heads/group-example'], { cwd: root }).exitCode).not.toBe(0);
  });

  test('a leftover refresh worktree at an older group tip is detached at the new tip before the merge', () => {
    const { root, worktreesRoot } = scratchRepository();
    GroupWorktrees.prepareGroupWorktree(root, worktreesRoot, 'group-example', 'main');
    const olderTip = gitOutputIn(root, ['rev-parse', 'refs/heads/group-example']);
    GroupWorktrees.prepareRefreshWorktree(root, worktreesRoot, 'group-example', olderTip);
    commitFile(join(worktreesRoot, 'group-example'), 'cart.ts', 'export const cart = 1;\n');
    const newTip = gitOutputIn(root, ['rev-parse', 'refs/heads/group-example']);
    const refreshWorktree = join(worktreesRoot, 'refresh-group-example');
    expect(gitOutputIn(refreshWorktree, ['rev-parse', 'HEAD'])).toBe(olderTip);

    expect(GroupWorktrees.prepareRefreshWorktree(root, worktreesRoot, 'group-example', newTip)).toEqual({ verdict: 'ready', path: refreshWorktree });
    expect(gitOutputIn(refreshWorktree, ['rev-parse', 'HEAD'])).toBe(newTip);
    expect(gitOutputIn(refreshWorktree, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('HEAD');
  });

  test('a leftover refresh worktree away from the tip with uncommitted changes or a merge in progress is refused git-failed, naming it', () => {
    const { root, worktreesRoot } = scratchRepository();
    GroupWorktrees.prepareGroupWorktree(root, worktreesRoot, 'group-example', 'main');
    const olderTip = gitOutputIn(root, ['rev-parse', 'refs/heads/group-example']);
    const refreshWorktree = join(worktreesRoot, 'refresh-group-example');
    GroupWorktrees.prepareRefreshWorktree(root, worktreesRoot, 'group-example', olderTip);
    commitFile(join(worktreesRoot, 'group-example'), 'cart.ts', 'export const cart = 1;\n');
    const newTip = gitOutputIn(root, ['rev-parse', 'refs/heads/group-example']);

    writeFileSync(join(refreshWorktree, 'base.ts'), 'export const base = 2;\n');
    const dirty = GroupWorktrees.prepareRefreshWorktree(root, worktreesRoot, 'group-example', newTip);
    expect(dirty).toEqual({ verdict: 'git-failed', reason: expect.stringContaining(refreshWorktree) });
    expect(gitOutputIn(refreshWorktree, ['rev-parse', 'HEAD'])).toBe(olderTip);

    gitOutputIn(refreshWorktree, ['checkout', '-q', '--', 'base.ts']);
    commitFile(refreshWorktree, 'base.ts', 'export const base = 3;\n');
    commitFile(root, 'base.ts', 'export const base = 4;\n');
    Bun.spawnSync(['git', '-c', 'user.name=Alex Example', '-c', 'user.email=alex@example.com', 'merge', '-q', 'main'], { cwd: refreshWorktree });
    expect(gitOutputIn(refreshWorktree, ['rev-parse', '--verify', 'MERGE_HEAD'])).not.toBe('');
    const merging = GroupWorktrees.prepareRefreshWorktree(root, worktreesRoot, 'group-example', newTip);
    expect(merging).toEqual({ verdict: 'git-failed', reason: expect.stringContaining('merge in progress') });
    expect(merging.verdict === 'git-failed' ? merging.reason : '').toContain(refreshWorktree);
  });

  test('a group branch holding work main lacks is kept: branch -d refuses it and the reason comes back', () => {
    const { root, worktreesRoot } = scratchRepository();
    GroupWorktrees.prepareGroupWorktree(root, worktreesRoot, 'group-example', 'main');
    commitFile(join(worktreesRoot, 'group-example'), 'cart.ts', 'export const cart = 1;\n');
    expect(GroupWorktrees.removeGroup(root, worktreesRoot, 'group-example')).toContain('branch -d');
    expect(gitOutputIn(root, ['rev-parse', '--verify', 'refs/heads/group-example'])).not.toBe('');
  });
});
