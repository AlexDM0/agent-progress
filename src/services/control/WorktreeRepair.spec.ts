/**
 * The git side of `worktree repair` (design section 8.3). What matters: `recreate` first saves `git diff HEAD` and every untracked file to
 * the job folder's next `recreate-<n>.patch`, then removes the worktree; it refuses to remove a worktree whose changes it could not save;
 * `unlock` removes a stale `index.lock` and nothing else; `prune` drops the record of a worktree folder that is gone.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';

import { afterEach, expect, test } from 'bun:test';

import {
  commitFile,
  createScratchGitRepository,
  gitOutputIn,
  removeScratchDirectory
}                                   from '../../testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent } from '../../testing/ToolGuard.ts';
import { WorktreeRepair }           from './WorktreeRepair.ts';

let repository: string | null = null;

afterEach(() => {
  if (repository === null) return;
  removeScratchDirectory(`${repository}-worktrees`);
  removeScratchDirectory(repository);
  repository = null;
});

function repositoryWithWorktree(): { root: string; worktree: string; jobFolder: string } {
  const root = createScratchGitRepository('worktree-repair');
  repository = root;
  gitOutputIn(root, ['checkout', '-q', '-B', 'main']);
  commitFile(root, 'basket.ts', 'export const total = 1;\n');
  const worktree = join(`${root}-worktrees`, 'ticket-012');
  gitOutputIn(root, ['worktree', 'add', '-q', '-b', 'ticket-012', worktree, 'main']);
  return { root, worktree, jobFolder: join(`${root}-worktrees`, 'jobs', 'J4') };
}

describeWhenGitIsPresent('recreate', () => {
  test('saves tracked and untracked changes to recreate-<n>.patch, numbered on, then removes the worktree', () => {
    const { root, worktree, jobFolder } = repositoryWithWorktree();
    mkdirSync(jobFolder, { recursive: true });
    writeFileSync(join(jobFolder, 'recreate-1.patch'), 'an earlier save\n');
    writeFileSync(join(worktree, 'basket.ts'), 'export const total = 2;\n');
    writeFileSync(join(worktree, 'coupon.ts'), 'export const coupon = 3;\n');

    const repaired = WorktreeRepair.repair({
      repositoryRoot: root, worktreePath: worktree, step: 'recreate', jobFolder
    });

    expect(repaired).toEqual({ verdict: 'repaired', patchPath: join(jobFolder, 'recreate-2.patch') });
    const patch = readFileSync(join(jobFolder, 'recreate-2.patch'), 'utf8');
    expect(patch).toContain('+export const total = 2;');
    expect(patch).toContain('+export const coupon = 3;');
    expect(existsSync(worktree)).toBe(false);
  });

  test('a clean worktree is removed with no patch', () => {
    const { root, worktree, jobFolder } = repositoryWithWorktree();
    expect(WorktreeRepair.repair({
      repositoryRoot: root, worktreePath: worktree, step: 'recreate', jobFolder
    })).toEqual({ verdict: 'repaired', patchPath: null });
    expect(existsSync(worktree)).toBe(false);
  });

  test('changes it cannot save keep the worktree: uncommitted-work-not-saved', () => {
    const { root, worktree } = repositoryWithWorktree();
    writeFileSync(join(worktree, 'basket.ts'), 'export const total = 2;\n');

    expect(WorktreeRepair.repair({
      repositoryRoot: root, worktreePath: worktree, step: 'recreate', jobFolder: null
    })).toEqual({ verdict: 'uncommitted-work-not-saved' });
    expect(readFileSync(join(worktree, 'basket.ts'), 'utf8')).toBe('export const total = 2;\n');
  });

  test('an untracked file git cannot diff keeps the worktree: uncommitted-work-not-saved', () => {
    const { root, worktree, jobFolder } = repositoryWithWorktree();
    writeFileSync(join(worktree, 'coupon.ts'), 'export const coupon = 3;\n');
    chmodSync(join(worktree, 'coupon.ts'), 0o000);

    const repaired = WorktreeRepair.repair({
      repositoryRoot: root, worktreePath: worktree, step: 'recreate', jobFolder
    });
    chmodSync(join(worktree, 'coupon.ts'), 0o644);

    expect(repaired).toEqual({ verdict: 'uncommitted-work-not-saved' });
    expect(readFileSync(join(worktree, 'coupon.ts'), 'utf8')).toBe('export const coupon = 3;\n');
  });
});

describeWhenGitIsPresent('unlock and prune', () => {
  test('unlock removes the worktree\'s stale index.lock and leaves its changes', () => {
    const { root, worktree } = repositoryWithWorktree();
    writeFileSync(join(worktree, 'basket.ts'), 'export const total = 2;\n');
    const lockPath = gitOutputIn(worktree, ['rev-parse', '--path-format=absolute', '--git-path', 'index.lock']);
    writeFileSync(lockPath, '');

    expect(WorktreeRepair.repair({
      repositoryRoot: root, worktreePath: worktree, step: 'unlock', jobFolder: null
    })).toEqual({ verdict: 'repaired', patchPath: null });
    expect(existsSync(lockPath)).toBe(false);
    expect(readFileSync(join(worktree, 'basket.ts'), 'utf8')).toBe('export const total = 2;\n');
  });

  test('prune drops the record of a worktree whose folder is gone', () => {
    const { root, worktree } = repositoryWithWorktree();
    removeScratchDirectory(`${root}-worktrees`);

    expect(WorktreeRepair.repair({
      repositoryRoot: root, worktreePath: worktree, step: 'prune', jobFolder: null
    })).toEqual({ verdict: 'repaired', patchPath: null });
    expect(gitOutputIn(root, ['worktree', 'list'])).not.toContain('ticket-012');
  });
});
