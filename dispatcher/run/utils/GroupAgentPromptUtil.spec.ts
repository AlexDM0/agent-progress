/**
 * The group prompts' contract: each carries the marker the hook and the harness read its kind by, the group worktree, branch and role, so a
 * ticket's `## Brief` never has to state them; a successor claims with `--after` its predecessor; and no reviewer but the release ticket's is ever
 * told to release, which it does for the whole group in one call.
 */
import { describe, expect, test } from 'bun:test';

import type { DispatchSettings } from '../../@types/DispatchSettings.ts';
import type { GroupPlacement }   from '../../@types/DispatchWork.ts';
import { GroupAgentPromptUtil }  from './GroupAgentPromptUtil.ts';

const GROUP_SETTINGS: DispatchSettings = {
  mainCheckout:          '/scratch/example-repository',
  mainLine:              'main',
  checkCommand:          'example-check',
  installCommand:        '',
  lowPriorityIsIncluded: false,
  ticketIds:             null,
  readyTickets:          [],
  runLabel:              'group-example-group',
  groupName:             'example-group',
};

function placementOf(predecessorId: string | null): GroupPlacement {
  return {
    groupName:        'example-group',
    orderedTicketIds: ['101', '102', '103'],
    releaseTicketId:  '103',
    predecessorId,
  };
}

const BUILD_REQUEST = {
  ticketId:                    '102',
  previousPass:                null,
  owner:                       'opus',
  pausedBuildWasFoundBySurvey: false,
};

const REVIEW_REQUEST = {
  ticketId:            '102',
  expectedRound:       1,
  rereviewRunsFirst:   false,
  earlierReviewerDied: false,
  owner:               'opus',
};

const GROUP_WORKTREE = '/scratch/example-repository/.claude/worktrees/group-example-group';

describe('the group builder prompt', () => {
  const prompt = GroupAgentPromptUtil.groupBuilderPrompt(GROUP_SETTINGS, placementOf('101'), BUILD_REQUEST);

  test('names its ticket by the builder marker, and the group branch and worktree it forks off', () => {
    expect(prompt).toStartWith('agent-progress ticket: 102\n');
    expect(prompt).toContain('Group branch: group-example-group');
    expect(prompt).toContain(`Group worktree: ${GROUP_WORKTREE}`);
  });

  test('claims a pipelined successor with --after its predecessor, and forks off the predecessor\'s branch while it exists', () => {
    expect(prompt).toContain('adding `--after 101` when `agent-progress ticket show 101` says `in-review`');
    expect(prompt).toContain('<base> is `ticket-101` while that branch exists, and group-example-group once it no longer does.');
  });

  test('the first ticket claims plainly and forks off the group branch', () => {
    const firstPrompt = GroupAgentPromptUtil.groupBuilderPrompt(GROUP_SETTINGS, placementOf(null), { ...BUILD_REQUEST, ticketId: '101' });
    expect(firstPrompt).not.toContain('--after');
    expect(firstPrompt).toContain('<base> is group-example-group.');
  });

  test('waits for a free slot by a background poll rather than failing', () => {
    expect(prompt).toContain('as a background command and wait on it, never as a foreground sleep');
  });

  test('closes by skipping, merging or rebasing against <base>, merging when the branch carries a merge <base> lacks', () => {
    const worktree = '/scratch/example-repository/.claude/worktrees/ticket-102';
    expect(prompt).toContain(`when \`git -C ${worktree} merge-base --is-ancestor <base> HEAD\` succeeds, the branch already holds <base>: change nothing`);
    expect(prompt).toContain(`\`git -C ${worktree} rev-list --merges <base>..HEAD\` prints a commit`);
    expect(prompt).toContain(`\`git -C ${worktree} merge --no-edit <base>\``);
    expect(prompt).toContain(`otherwise \`git -C ${worktree} rebase <base>\``);
  });
});

describe('the group reviewer prompt', () => {
  const prompt = GroupAgentPromptUtil.groupReviewerPrompt(GROUP_SETTINGS, placementOf('101'), REVIEW_REQUEST);

  test('names its ticket by the review marker, and integrates onto the group branch in its worktree', () => {
    expect(prompt).toStartWith('agent-progress review: 102\n');
    expect(prompt).toContain(`\`git -C ${GROUP_WORKTREE} merge --ff-only ticket-102\``);
    expect(prompt).toContain('`agent-progress ticket approve 102`');
  });

  test('never names the release command', () => {
    expect(prompt).not.toContain('agent-progress release');
  });

  test('refuses to integrate before the ticket before it is settled, a delivered or abandoned one passing as a reviewed one does', () => {
    expect(prompt).toContain('`agent-progress ticket show 101` must say `reviewed`, `delivered` or `abandoned`');
  });

  test('replaces the review brief\'s step-5 rebase by P\'s three-way rule against the group branch, counting a merge with rework --merge', () => {
    const worktree = '/scratch/example-repository/.claude/worktrees/ticket-102';
    expect(prompt).toContain('Step 5\'s `git rebase <main line>` is replaced by P\'s rule below');
    expect(prompt).toContain(`\`git -C ${worktree} merge-base --is-ancestor group-example-group HEAD\` succeeds`);
    expect(prompt).toContain(`\`git -C ${worktree} merge --no-edit group-example-group\``);
    expect(prompt).toContain(`\`agent-progress rework --merge HEAD --worktree ${worktree}\``);
    expect(prompt).toContain(`\`agent-progress rework --rebased-from <pipeline tip> --main group-example-group --worktree ${worktree}\``);
  });
});

describe('the release ticket\'s reviewer prompt', () => {
  const prompt = GroupAgentPromptUtil.groupReviewerPrompt(GROUP_SETTINGS, placementOf('102'), { ...REVIEW_REQUEST, ticketId: '103' });

  test('integrates the ticket onto the group branch, then releases every ticket of the group in one call from the group worktree', () => {
    expect(prompt).toStartWith('agent-progress review: 103\n');
    expect(prompt).toContain(`\`git -C ${GROUP_WORKTREE} merge --ff-only ticket-103\``);
    expect(prompt).toContain(`\`agent-progress release 101 102 103 --branch group-example-group --worktree ${GROUP_WORKTREE} --main main --json\``);
  });

  test('merges the main line into the group branch, never rebasing it, and runs the full checks and the pre-release step there first', () => {
    expect(prompt).toContain(`\`git -C ${GROUP_WORKTREE} merge --no-edit main\``);
    expect(prompt).not.toContain(`\`git -C ${GROUP_WORKTREE} rebase main\``);
    expect(prompt).toContain(`\`agent-progress rework --merge <the merge commit> --worktree ${GROUP_WORKTREE}\``);
    expect(prompt).toContain(`Run \`example-check 2>&1 | tail -20\` in ${GROUP_WORKTREE}`);
    expect(prompt).toContain('names a step for just before `agent-progress release`');
  });

  test('handles main-moved inside its pass and leaves its bar for the next round, never moving a ticket\'s status by hand', () => {
    expect(prompt).toContain('`"reason": "main-moved"`');
    expect(prompt).toContain('on `not-released` for `main-moved`, leave your bar running');
    expect(prompt).not.toContain('ticket status');
    expect(prompt).not.toContain('ticket approve');
  });

  test('is the release prompt only for the release ticket', () => {
    expect(GroupAgentPromptUtil.reviewsTheRelease(placementOf('102'), '103')).toBe(true);
    expect(GroupAgentPromptUtil.reviewsTheRelease(placementOf('101'), '102')).toBe(false);
  });
});

describe('the group survey prompt', () => {
  // No decision reads an earlier integration off the survey: each group reviewer's first step finds it itself.
  test('runs no integrated-line check', () => {
    expect(GroupAgentPromptUtil.groupSurveyPrompt(GROUP_SETTINGS)).not.toContain('Integrated:');
  });

  // An agent narrowing the list misread a worktree condition as a ticket filter and emptied a run; the run picks the group and the statuses in code.
  test('copies every ticket, ticket row and worktree name of the board, naming no group and no status to narrow them by', () => {
    const prompt = GroupAgentPromptUtil.groupSurveyPrompt(GROUP_SETTINGS);
    expect(prompt).toContain('- `tickets`: every entry of the status document\'s top-level `tickets` list, each with its `id`, `status`');
    expect(prompt).toContain('- `ticketRows`: every entry of the document\'s top-level `ticketRows` list');
    expect(prompt).toContain('`ls -1 /scratch/example-repository/.claude/worktrees` once');
    expect(prompt).toContain('Judge nothing and leave out no entry');
    for (const narrowingWord of ['whose', 'example-group', '`pending`', '`in-progress`', '`in-review`', 'test -d']) expect(prompt).not.toContain(narrowingWord);
  });
});
