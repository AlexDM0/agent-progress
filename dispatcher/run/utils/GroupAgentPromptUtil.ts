/**
 * The prompts of a group run's agents: its survey, and the builder and reviewer of each bundle ticket, worked on a ticket branch forked off the one
 * before it and integrated onto the group branch, which only the group's release takes to the main line.
 */
import { DISPATCH_PROTOCOL }                                from '../../../src/shared/constants/DispatchProtocol.ts';
import { DispatcherClaimNoteUtil }                          from '../../../src/shared/utils/DispatcherClaimNoteUtil.ts';
import type { DispatchSettings }                            from '../../@types/DispatchSettings.ts';
import type { GroupPlacement }                              from '../../@types/DispatchWork.ts';
import { DISPATCH_POLICY }                                  from '../../constants/DispatchPolicy.ts';
import type { BuilderPromptRequest, ReviewerPromptRequest } from './AgentPromptUtil.ts';
import { AgentPromptUtil }                                  from './AgentPromptUtil.ts';

const INTEGRATED_LINE_OPENING = 'Integrated: ';

const GROUP_BRANCH_PREFIX = 'group-';

const {
  branchOf,
  worktreeOf,
  startReviewCommandOf,
  statusReturnText,
} = AgentPromptUtil;

function groupBranchOf(groupName: string): string {
  return `${GROUP_BRANCH_PREFIX}${groupName}`;
}

function groupWorktreeOf(settings: DispatchSettings, groupName: string): string {
  return `${settings.mainCheckout}/.claude/worktrees/${groupBranchOf(groupName)}`;
}

function integratedLineOf(groupName: string): string {
  return `${INTEGRATED_LINE_OPENING}${groupBranchOf(groupName)} fast-forwarded to <commit>`;
}

function integratedLineCheckCommandOf(groupName: string): string {
  return 'agent-progress ticket show <id> --json | jq -r .body | '
    + `awk '/^## Handoff/{found=0} /^${INTEGRATED_LINE_OPENING}${groupBranchOf(groupName)} fast-forwarded to /{found=1} END{exit !found}'`;
}

function headerLineOf(settings: DispatchSettings, ticketId: string, groupName: string): string {
  return `Worktree: ${worktreeOf(settings, ticketId)}   Branch: ${branchOf(ticketId)}   Group branch: ${groupBranchOf(groupName)}   `
    + `Group worktree: ${groupWorktreeOf(settings, groupName)}   Main checkout: ${settings.mainCheckout}   Main line: ${settings.mainLine}`;
}

function groupOverrideText(settings: DispatchSettings, placement: GroupPlacement): string {
  const groupBranch = groupBranchOf(placement.groupName);
  const orderText = placement.orderedTicketIds.map((groupTicketId) => `#${groupTicketId}`).join(', ');
  return `This ticket belongs to the group \`${groupBranch}\`, built and reviewed one ticket at a time in this order: ${orderText}. `
    + `Its code reaches ${settings.mainLine} once, when the reviewer of the release ticket #${placement.releaseTicketId} releases the whole group. `
    + 'This prompt supersedes the ticket body wherever the two differ: the ticket is worked in the worktree and on the branch named above, '
    + `never in ${groupWorktreeOf(settings, placement.groupName)} itself, and never on ${settings.mainLine} or ${groupBranch}.`;
}

// Until its reviewer fast-forwards the group branch, the predecessor's code exists only on its own branch, so that branch is what this one forks off.
function baseDefinitionText(placement: GroupPlacement): string {
  const groupBranch = groupBranchOf(placement.groupName);
  const { predecessorId } = placement;
  if (predecessorId === null) return `<base> is ${groupBranch}.`;
  return `This group runs as a pipeline, one builder and one reviewer at a time, so #${predecessorId}, the ticket before this one, may still be under review while you build. `
    + `<base> is \`${branchOf(predecessorId)}\` while that branch exists, and ${groupBranch} once it no longer does. `
    + `Never edit, commit on or rebase \`${branchOf(predecessorId)}\` or its worktree: that is #${predecessorId}'s reviewer's.`;
}

function slotWaitText(): string {
  const pollCommand = `for attempt in $(seq ${DISPATCH_POLICY.SLOT_WAIT_LIMIT_MINUTES * 60 / DISPATCH_POLICY.SLOT_POLL_INTERVAL_SECONDS}); do `
    + '[ "$(agent-progress status --json | jq \'.concurrency.freeSlots\')" -gt 0 ] && break; '
    + `sleep ${DISPATCH_POLICY.SLOT_POLL_INTERVAL_SECONDS}; done`;
  return 'A group builder waits for a slot rather than failing: when `agent-progress status --json` shows `concurrency.freeSlots` of 0 before your claim, '
    + `run \`${pollCommand}\` as a background command (Bash with run_in_background, or the Monitor tool), never as a foreground sleep, and claim once it ends; `
    + `it gives up by itself after ${DISPATCH_POLICY.SLOT_WAIT_LIMIT_MINUTES} minutes.`;
}

function claimCommandOf(settings: DispatchSettings, ticketId: string, owner: string, predecessorId: string | null): string {
  const claimNote = DispatcherClaimNoteUtil.claimNoteFor(settings.runLabel, ticketId);
  const claimCommand = `\`agent-progress ticket claim ${ticketId} --owner ${owner} --note "${claimNote}"\``;
  if (predecessorId === null) return claimCommand;
  return `${claimCommand}, adding \`--after ${predecessorId}\` when \`agent-progress ticket show ${predecessorId}\` says \`in-review\``;
}

function groupBuilderPrompt(settings: DispatchSettings, placement: GroupPlacement, request: BuilderPromptRequest): string {
  const { ticketId, previousPass, owner } = request;
  const worktree = worktreeOf(settings, ticketId);
  const groupBranch = groupBranchOf(placement.groupName);
  const groupWorktree = groupWorktreeOf(settings, placement.groupName);
  const claimNote = DispatcherClaimNoteUtil.claimNoteFor(settings.runLabel, ticketId);
  const lines = [
    `agent-progress ticket: ${ticketId}`,
    headerLineOf(settings, ticketId, placement.groupName),
    `You build ticket #${ticketId} for the agent-progress group dispatcher, alone: one ticket, one agent.`,
    groupOverrideText(settings, placement),
    baseDefinitionText(placement),
    slotWaitText(),
    `FIRST write: ${claimCommandOf(settings, ticketId, owner, placement.predecessorId)}. `
      + 'If it exits 1 saying the ticket is in-progress, read the `note` of the `row` in the ticket\'s `ticketRows` entry of `agent-progress status --json`. '
      + `When that note is exactly "${claimNote}" and ${worktree} exists, the claim is this run's own: an earlier run of this group made it, `
      + 'or this very builder before the runtime restarted or resumed it. Carry on in that worktree, keeping every uncommitted edit it holds. '
      + 'When the row you carry on past is `paused` rather than `in-progress`, '
      + `resume it first with \`agent-progress task start <that row> --note "${claimNote}"\`, so your build holds its slot under this run's claim. `
      + 'On any other refusal, stop at once and return outcome `claim-refused` with its message verbatim as `detail` and, when it was refused as in-progress, '
      + 'that row\'s note as `claimNote`.',
    `Then the group worktree, which you never edit or commit in: when ${groupWorktree} does not exist, create it with `
      + `\`git -C ${settings.mainCheckout} worktree add ${groupWorktree} ${groupBranch}\` when the branch exists, otherwise `
      + `\`git -C ${settings.mainCheckout} worktree add ${groupWorktree} -b ${groupBranch} ${settings.mainLine}\`.`,
    `Then the ticket worktree: when ${worktree} exists, reuse it as it stands; start from \`git -C ${worktree} status\`. `
      + `Otherwise \`git -C ${settings.mainCheckout} worktree add ${worktree} -b ${branchOf(ticketId)} <base>\`, dropping \`-b\` when the branch already exists. `
      + `The ticket branch forks off the tip of <base>, never off ${settings.mainLine}.`,
  ];
  if (settings.installCommand !== '') {
    lines.push(`In a worktree you just created, the group worktree included, run \`${settings.installCommand}\` in it once before anything else there.`);
  }
  lines.push(
    'Everything you do happens in the ticket worktree: every edit, every command, every commit, git as `git -C <worktree>`. '
      + 'Your working directory may be the main checkout; it is not yours to touch.',
    `The task is the ticket: \`agent-progress ticket show ${ticketId}\` prints it. Its \`## Brief\` section, when it has one, is your brief, read through the paragraphs above; `
      + 'otherwise Report, Wanted and Acceptance are, and the files they name are where the work belongs.',
  );
  if (previousPass === 'review') lines.push('A reviewer found that the previous pass does not hold: the last `## Review` in the ticket says why, and your work starts there.');
  if (previousPass === 'builder') {
    lines.push('An earlier builder of this group stopped before review: the worktree holds whatever it committed, and your work continues from there.');
  }
  lines.push(
    `Read \`${settings.mainCheckout}/${DISPATCH_PROTOCOL.BUILDER_BRIEF_PATH_IN_REPOSITORY}\` once and follow its fenced blocks under Call discipline, Stop conditions, `
      + `Find and fix, Ready to merge and Report, with <worktree> = ${worktree}, <branch> = ${branchOf(ticketId)}, <main line> = <base>, `
      + `<main checkout> = ${settings.mainCheckout} and <full check command> = \`${settings.checkCommand}\`.`,
    'Do not `cat` any CLAUDE.md.',
    `Stop when the Acceptance block is satisfied, or at about ${DISPATCH_PROTOCOL.BUILDER_API_CALL_BUDGET} API calls, whichever is first.`,
    `Close as Ready to merge says, its rebase being \`git -C ${worktree} rebase <base>\` with <base> read again at that moment, append the \`## Handoff\`, `
      + `then run \`${startReviewCommandOf(settings, 'finish', ticketId, owner)}\`. Never merge ${branchOf(ticketId)} into ${groupBranch} or ${settings.mainLine}, `
      + 'and never release or version anything: the fast-forward of the group branch is your reviewer\'s, the release the release ticket\'s.',
    'Return outcome `in-review` when `ticket finish` succeeded and `failed` otherwise, with your report as `detail` and `claimNote` empty unless your claim '
      + `was refused as in-progress. ${statusReturnText()}`,
  );
  return lines.join('\n');
}

function reviewBarLinesOf(settings: DispatchSettings, request: ReviewerPromptRequest): string[] {
  const {
    ticketId,
    rereviewRunsFirst,
    earlierReviewerDied,
    owner,
  } = request;
  const lines: string[] = [];
  if (rereviewRunsFirst) {
    lines.push(
      `Then, before anything else: read your round from \`agent-progress ticket show ${ticketId}\`, and the ticket's \`ticketRows\` entry `
        + 'from `agent-progress status --json`. When its `reviewBars` list an `in-progress` bar whose `round` is your round, the rereview of your round already ran: '
        + 'skip the rereview and take that row as your bar. '
        + `Otherwise run \`${startReviewCommandOf(settings, 'rereview', ticketId, owner)}\` as your next command; it starts your bar.`,
    );
  }
  if (earlierReviewerDied) lines.push('An earlier reviewer of this group returned nothing, and its bar may still be running.');
  lines.push(
    `Then your bar. When the \`ticketRows\` entry for ${ticketId} in \`agent-progress status --json\` lists an \`in-progress\` review bar, it is this review's own, `
      + 'left by an earlier reviewer of this group, by the builder\'s `--start-review` or by this very reviewer before the runtime restarted or resumed it: '
      + 'take it as your bar and add none. '
      + `Otherwise add your own: \`agent-progress task add "Review <round> #${ticketId} — <ticket title>" --review-of ${ticketId} --owner ${owner} `
      + `--note "${AgentPromptUtil.reviewNoteOf(settings, ticketId)}" --start\`, the title from \`agent-progress ticket show ${ticketId}\`.`,
  );
  return lines;
}

function groupReviewerPrompt(settings: DispatchSettings, placement: GroupPlacement, request: ReviewerPromptRequest): string {
  const { ticketId, expectedRound } = request;
  const worktree = worktreeOf(settings, ticketId);
  const groupBranch = groupBranchOf(placement.groupName);
  const groupWorktree = groupWorktreeOf(settings, placement.groupName);
  const { predecessorId } = placement;
  const predecessorGate = predecessorId === null ? '' : `\`agent-progress ticket show ${predecessorId}\` must say \`reviewed\`, \`delivered\` or \`abandoned\`; otherwise change nothing more, `
    + 'close your bar, and return `not-released` with releaseReason `predecessor-not-integrated`. Then ';
  return [
    `agent-progress review: ${ticketId}`,
    headerLineOf(settings, ticketId, placement.groupName),
    `You are a clean reviewer of ticket #${ticketId} for the agent-progress group dispatcher, round ${expectedRound} as the dispatcher counts it. `
      + 'Your round is the number of `## Review` sections already in the ticket plus one; return it as `round`.',
    groupOverrideText(settings, placement),
    `You integrate this ticket onto ${groupBranch}; you never release or version it, and never write ${settings.mainLine}: only the release ticket's reviewer does.`,
    `FIRST, \`agent-progress ticket show ${ticketId}\`. When it says \`reviewed\` and a \`## Review\` after its last \`## Handoff\` holds the `
      + `\`${INTEGRATED_LINE_OPENING}\` line, an earlier reviewer integrated it: run only I4 below, close any \`in-progress\` review bar of it `
      + '(`agent-progress task finish <bar>`, then `agent-progress task deliver <bar>`), and return verdict `integrated`. When it says `in-review` and that line is '
      + 'already there, an earlier reviewer fast-forwarded the group branch and stopped: take your bar as below, then go straight to I3.',
    ...reviewBarLinesOf(settings, request),
    `Read \`${settings.mainCheckout}/${DISPATCH_PROTOCOL.REVIEW_BRIEF_PATH_IN_REPOSITORY}\` once and follow its fenced block as your procedure, steps 0 to 7, `
      + `with <worktree> = ${worktree}, <branch> = ${branchOf(ticketId)}, <main line> = ${groupBranch}, <main checkout> = ${settings.mainCheckout} and `
      + `<full check command> = \`${settings.checkCommand}\`. Step 8 is not yours: where the brief takes the branch to the main line, run I1 to I4 below instead. `
      + 'Before step 0, run P below.',
    `P. ${predecessorGate}bring the branch onto ${groupBranch}: record \`git -C ${worktree} rev-parse HEAD\` as <pipeline tip>, run \`git -C ${worktree} rebase ${groupBranch}\` `
      + '(resolve a conflict with Edit, `git add`, `GIT_EDITOR=true git rebase --continue`, never `--abort`), then '
      + `\`agent-progress rework --rebased-from <pipeline tip> --main ${groupBranch} --worktree ${worktree}\`, whose count joins your total and your \`## Review\`.`,
    `You may use up to about ${DISPATCH_PROTOCOL.REVIEWER_API_CALL_BUDGET} API calls for the review; the rebase and the integration steps are exempt.`,
    'Every finding you would hand on instead of fixing, you file yourself: '
      + '`agent-progress ticket add "<what and where>" --priority low --body "<what you saw and what you would do>"`; return the ids it printed as `filedTicketIds`.',
    `Step 7b is a count: request the next round only when over ${DISPATCH_PROTOCOL.REWORK_ROUND_THRESHOLD_LINES} lines of code were reworked. `
      + 'Whether that round runs is the dispatcher\'s decision.',
    `I1. \`git -C ${groupWorktree} branch --show-current\` must print ${groupBranch} and \`git -C ${groupWorktree} status --porcelain\` nothing; `
      + 'otherwise change nothing and return `not-released` with releaseReason `group-worktree-unclean`.',
    `I2. \`git -C ${groupWorktree} merge --ff-only ${branchOf(ticketId)}\`; when git refuses because ${groupBranch} moved, rebase again as P says and retry once, `
      + 'and a second refusal returns `not-released` with releaseReason `group-moved`. '
      + `Once it succeeds, append the line \`${integratedLineOf(placement.groupName)}\` at the end of your \`## Review\`, with the full commit `
      + `\`git -C ${groupWorktree} rev-parse HEAD\` prints.`,
    `I3. In ${settings.mainCheckout}: \`agent-progress ticket approve ${ticketId}\`, which moves the ticket to \`reviewed\` and closes its in-progress review bar; `
      + 'a review bar of it still `in-progress` in `agent-progress status --json` is yours, so `agent-progress task finish <bar>`, then `agent-progress task deliver <bar>`.',
    `I4. \`git -C ${settings.mainCheckout} worktree remove ${worktree}\`, never \`--force\`, then \`git -C ${groupWorktree} branch -d ${branchOf(ticketId)}\`. `
      + 'Name anything git declines, with its reason, and leave it.',
    'Return verdict `integrated` only once I3 succeeded. On `round-requested`, leave your bar running: the next round\'s `ticket rereview --start-review` closes it, '
      + 'so the ticket\'s slot stays held. On every other verdict than integrated, close your own bar: '
      + '`agent-progress task finish <bar>`, then `agent-progress task deliver <bar>`.',
    'Return `verdict` (integrated, round-requested, does-not-hold or not-released), `releaseReason` (the reason when not-released, empty otherwise), '
      + '`integratedCommit` (the commit of your `Integrated:` line when integrated, empty otherwise), `reworkedLines` (every rework count together), '
      + '`findings` (every finding of this round, each with a one-word `class`, its `file` and a one-line `summary`), '
      + `and \`filedTicketIds\`. ${statusReturnText()}`,
  ].join('\n');
}

function groupSurveyPrompt(settings: DispatchSettings, groupName: string): string {
  return [
    `Run \`agent-progress status --json\` once, in ${settings.mainCheckout}; then \`test -d ${worktreeOf(settings, '<id>')}\` once for each ticket of the group `
      + `\`${groupName}\` whose status is \`in-progress\` or \`in-review\`, and \`${integratedLineCheckCommandOf(groupName)}\` once for each whose status is `
      + '`in-review`. Make no other call. Judge nothing; return:',
    '- `status`: its `concurrency` block as printed (limit, agentsInFlight, freeSlots, readyTicketIds, dispatcherState, heldTicketIds, inProgressTicketIds, '
      + `inProgressReviewOfIds), ${AgentPromptUtil.readyTicketsAdditionText()};`,
    `- \`tickets\`: every entry of the status document's top-level \`tickets\` list whose \`group\` is \`${groupName}\`, each with its \`id\`, \`status\`, `
      + '`dependsOn` (the ids it names, an empty list without any), `releasesGroup` (false when absent), and `model` and `effort` where it names them; '
      + '`rowNote`, the `note` of the `row` in that ticket\'s `ticketRows` entry (empty when there is none); `openReviewBar`, whether any of that entry\'s '
      + '`reviewBars` is `in-progress`; `worktreeExists`, whether its `test -d` succeeded (false when not run); and `integratedLineAfterLastHandoff`, '
      + 'whether its check command exited 0 (false when not run).',
  ].join('\n');
}

export const GroupAgentPromptUtil = {
  groupBranchOf,
  groupSurveyPrompt,
  groupBuilderPrompt,
  groupReviewerPrompt,
} as const;
