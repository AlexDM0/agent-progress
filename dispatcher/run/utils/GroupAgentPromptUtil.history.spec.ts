/**
 * The group prompts' git steps run as written on a scratch repository: a sync ticket forked off its predecessor's branch merges the
 * main line, then the builder's close, the reviewer's P, the fast-forward and the release reviewer's R2 run, each the command its
 * prompt names. What matters is the history they leave: the sync merge commit survives every step under its own commit, and the
 * main line is an ancestor of the group tip, so the release fast-forwards. A rebase anywhere on the way would flatten that merge.
 */
import { mkdirSync }         from 'node:fs';
import { afterEach, expect } from 'bun:test';

import {
  commitFile,
  createScratchGitRepository,
  currentBranchOf,
  gitOutputIn,
  removeScratchDirectory,
  SCRATCH_COMMIT_IDENTITY_ARGUMENTS
} from '../../../src/testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent, testWhenGitIsPresent } from '../../../src/testing/ToolGuard.ts';
import type { DispatchSettings }                          from '../../@types/DispatchSettings.ts';
import type { GroupPlacement }                            from '../../@types/DispatchWork.ts';
import { GroupAgentPromptUtil }                           from './GroupAgentPromptUtil.ts';

type CatchUpOutcome = 'skipped' | 'merged' | 'rebased';

const BACKTICKED_SPAN_PATTERN = /`([^`]+)`/g;

function gitCommandsOf(prompt: string, worktree: string): string[] {
  return [...prompt.matchAll(BACKTICKED_SPAN_PATTERN)].map(([, span]) => span ?? '').filter((span) => span.startsWith(`git -C ${worktree} `));
}

function onlyCommandOf(prompt: string, worktree: string, operation: string): string {
  const matching = [...new Set(gitCommandsOf(prompt, worktree).filter((command) => command.startsWith(`git -C ${worktree} ${operation}`)))];
  expect(matching, `the prompt names exactly one \`git -C ${worktree} ${operation}…\``).toHaveLength(1);
  return matching[0] ?? '';
}

function runGitCommand(command: string, placeholderValues: Record<string, string> = {}): { exitCode: number; output: string } {
  const filledCommand = Object.entries(placeholderValues).reduce((text, [placeholder, value]) => text.replaceAll(placeholder, value), command);
  const [, ...gitArguments] = filledCommand.split(' ');
  const finished = Bun.spawnSync(['git', ...SCRATCH_COMMIT_IDENTITY_ARGUMENTS, ...gitArguments], { stdout: 'pipe', stderr: 'pipe' });
  return { exitCode: finished.exitCode, output: new TextDecoder().decode(finished.stdout).trim() };
}

function followCatchUpRule(prompt: string, worktree: string, placeholderValues: Record<string, string> = {}): CatchUpOutcome {
  const runOrFail = (operation: string): string => {
    const { exitCode, output } = runGitCommand(onlyCommandOf(prompt, worktree, operation), placeholderValues);
    expect(exitCode, `\`${operation}\` succeeds`).toBe(0);
    return output;
  };
  if (runGitCommand(onlyCommandOf(prompt, worktree, 'merge-base --is-ancestor'), placeholderValues).exitCode === 0) return 'skipped';
  if (runOrFail('rev-list --merges') !== '') {
    runOrFail('merge --no-edit');
    return 'merged';
  }
  runOrFail('rebase');
  return 'rebased';
}

function isAncestor(directory: string, ancestor: string, descendant: string): boolean {
  return Bun.spawnSync(['git', 'merge-base', '--is-ancestor', ancestor, descendant], { cwd: directory }).exitCode === 0;
}

describeWhenGitIsPresent('the group prompts\' git steps on a sync ticket\'s history', () => {
  let repositoryDirectory = '';

  afterEach(() => {
    removeScratchDirectory(repositoryDirectory);
  });

  testWhenGitIsPresent('keep the sync merge commit through the builder\'s close, P, the fast-forward and R2, with main an ancestor of the group tip', () => {
    repositoryDirectory = createScratchGitRepository('group-sync-history');
    const mainLine = currentBranchOf(repositoryDirectory);
    commitFile(repositoryDirectory, 'base.txt', 'base\n');
    const settings: DispatchSettings = {
      mainCheckout:          repositoryDirectory,
      mainLine,
      checkCommand:          'example-check',
      installCommand:        '',
      lowPriorityIsIncluded: false,
      ticketIds:             null,
      readyTickets:          [],
      runLabel:              'group-example-group',
      groupName:             'example-group',
    };
    const placement: GroupPlacement = {
      groupName: 'example-group', orderedTicketIds: ['101', '102'], releaseTicketId: '102', predecessorId: '101'
    };
    const groupBranch       = GroupAgentPromptUtil.groupBranchOf('example-group');
    const worktreesFolder   = `${repositoryDirectory}/.claude/worktrees`;
    const groupWorktree     = `${worktreesFolder}/${groupBranch}`;
    const predecessorTree   = `${worktreesFolder}/ticket-101`;
    const syncTicketTree    = `${worktreesFolder}/ticket-102`;
    mkdirSync(worktreesFolder, { recursive: true });
    gitOutputIn(repositoryDirectory, ['worktree', 'add', '-q', '-b', groupBranch, groupWorktree, mainLine]);
    gitOutputIn(repositoryDirectory, ['worktree', 'add', '-q', '-b', 'ticket-101', predecessorTree, groupBranch]);
    commitFile(predecessorTree, 'predecessor.txt', 'predecessor\n');
    gitOutputIn(repositoryDirectory, ['worktree', 'add', '-q', '-b', 'ticket-102', syncTicketTree, 'ticket-101']);

    commitFile(repositoryDirectory, 'main-before-sync.txt', 'main moved\n');
    gitOutputIn(syncTicketTree, [...SCRATCH_COMMIT_IDENTITY_ARGUMENTS, 'merge', '-q', '--no-edit', mainLine]);
    const syncMergeCommit = gitOutputIn(syncTicketTree, ['rev-parse', 'HEAD']);
    commitFile(syncTicketTree, 'sync.txt', 'sync work\n');
    gitOutputIn(predecessorTree, [...SCRATCH_COMMIT_IDENTITY_ARGUMENTS, 'commit', '-q', '--allow-empty', '-m', 'Review round 1 of #101: no changes']);

    const builderPrompt = GroupAgentPromptUtil.groupBuilderPrompt(settings, placement, {
      ticketId: '102', previousPass: null, owner: 'opus', pausedBuildWasFoundBySurvey: false
    });
    expect(followCatchUpRule(builderPrompt, syncTicketTree, { '<base>': 'ticket-101' }), 'the builder\'s close merges its moved base').toBe('merged');

    gitOutputIn(groupWorktree, ['merge', '-q', '--ff-only', 'ticket-101']);
    const reviewerPrompt = GroupAgentPromptUtil.groupReviewerPrompt(settings, placement, {
      ticketId: '102', expectedRound: 1, rereviewRunsFirst: false, earlierReviewerDied: false, owner: 'opus'
    });
    expect(followCatchUpRule(reviewerPrompt, syncTicketTree), 'P finds the group branch already held').toBe('skipped');
    expect(runGitCommand(onlyCommandOf(reviewerPrompt, groupWorktree, 'merge --ff-only')).exitCode, 'I2 fast-forwards').toBe(0);

    commitFile(repositoryDirectory, 'main-before-release.txt', 'main moved again\n');
    expect(runGitCommand(onlyCommandOf(reviewerPrompt, groupWorktree, 'merge --no-edit')).exitCode, 'R2 merges the main line').toBe(0);

    const groupTip = gitOutputIn(groupWorktree, ['rev-parse', 'HEAD']);
    expect(isAncestor(repositoryDirectory, mainLine, groupTip), 'main is an ancestor of the group tip').toBe(true);
    expect(isAncestor(repositoryDirectory, syncMergeCommit, groupTip), 'the sync merge commit is kept under its own commit').toBe(true);
    expect(gitOutputIn(repositoryDirectory, ['rev-list', '--merges', `${mainLine}..${groupTip}`]).split('\n')).toContain(syncMergeCommit);
  });
});
