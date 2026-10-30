/**
 * A resolver under the real Seatbelt sandbox, its write rules the resolver profile's denies over the linked-worktree carve-out (the worktree
 * and the shared `.git` writable). What matters: the merge commit a conflicting Airlock merge needs goes through in a linked worktree, and
 * the same confined child cannot move the target branch's ref. Skipped through `src/testing/ToolGuard.ts` where `sandbox-exec` does not apply.
 */
import { realpathSync, writeFileSync }   from 'node:fs';
import { join }                          from 'node:path';
import { afterEach, beforeEach, expect } from 'bun:test';

import {
  SCRATCH_COMMIT_IDENTITY_ARGUMENTS,
  commitFile,
  createScratchGitRepository,
  currentBranchOf,
  gitOutputIn,
  removeScratchDirectory
} from '../../testing/ScratchWorkspace.ts';
import { testWhenSandboxExecApplies }   from '../../testing/ToolGuard.ts';
import { createProcessWatcherSandbox }  from './ProcessWatcherSandbox.ts';
import { NO_TOOLCHAIN, WorkerProfiles } from './WorkerProfiles.ts';

const CONFLICTED_FILE = 'example.txt';

let repository = '';

beforeEach(() => {
  repository = realpathSync(createScratchGitRepository('resolver-sandbox'));
});

afterEach(() => {
  removeScratchDirectory(`${repository}-worktrees`);
  removeScratchDirectory(repository);
});

/** The ticket worktree mid-merge: the target and the ticket branch changed the same line. */
function conflictedTicketWorktree(mainLine: string): string {
  commitFile(repository, CONFLICTED_FILE, 'base\n');
  const worktree = join(`${repository}-worktrees`, 'ticket-007');
  gitOutputIn(repository, ['worktree', 'add', '-q', '-b', 'ticket-007', worktree]);
  commitFile(worktree, CONFLICTED_FILE, 'ticket\n');
  commitFile(repository, CONFLICTED_FILE, 'main\n');
  const merge = Bun.spawnSync(['git', ...SCRATCH_COMMIT_IDENTITY_ARGUMENTS, 'merge', '-q', mainLine], { cwd: worktree, stdout: 'ignore', stderr: 'ignore' });
  expect(merge.exitCode).not.toBe(0);
  return worktree;
}

testWhenSandboxExecApplies('a sandboxed resolver commits its merge in a linked worktree and cannot move the target branch', () => {
  const mainLine = currentBranchOf(repository);
  const worktree = conflictedTicketWorktree(mainLine);
  const mainTip  = gitOutputIn(repository, ['rev-parse', mainLine]);
  const facts = WorkerProfiles.sandboxFactsOf({
    repositoryRoot: repository,
    dataFolder:     join(repository, '.agent-progress-v2'),
    monitorFolder:  join(repository, 'monitor'),
    homeDirectory:  join(repository, 'home'),
    worktree,
    ownBranch:      'ticket-007',
    mainLine,
    groupPrefix:    'group-',
    hatchDirectory: join(repository, 'hatch'),
  });
  const profile = WorkerProfiles.profileOf('resolver', facts, NO_TOOLCHAIN);
  const sandbox = createProcessWatcherSandbox();
  const profilePath = join(repository, 'resolver.sb');
  writeFileSync(profilePath, sandbox.profileTextOf({
    worktree,
    worktreeAdminFolder:  facts.commonGitDirectory,
    homeDirectory:        facts.homeDirectory,
    temporaryDirectory:   null,
    cachePaths:           [],
    executableSearchPath: [],
    deniedWritableRoots:  profile.deniedWritableRoots,
    deniedReadableRoots:  profile.deniedReadableRoots,
    network:              false,
  }));
  const identity = SCRATCH_COMMIT_IDENTITY_ARGUMENTS.map((argument) => `'${argument}'`).join(' ');
  const fakeResolverScript = [
    `printf 'resolved\\n' > ${CONFLICTED_FILE} && git add ${CONFLICTED_FILE} && git ${identity} commit -q --no-edit && echo merge-committed`,
    `git update-ref refs/heads/${mainLine} HEAD 2>/dev/null && echo target-moved`,
  ].join('; ');
  const run = Bun.spawnSync({ cmd: sandbox.sandboxedArgvOf(profilePath, ['/bin/sh', '-c', fakeResolverScript]), cwd: worktree, stderr: 'ignore' });
  expect(run.stdout.toString().split('\n').filter((line) => line !== '')).toEqual(['merge-committed']);
  expect(gitOutputIn(worktree, ['rev-list', '--parents', '-n', '1', 'HEAD']).split(' ')).toHaveLength(3);
  expect(gitOutputIn(repository, ['rev-parse', mainLine])).toBe(mainTip);
});
