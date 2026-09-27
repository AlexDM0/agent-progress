/** Every prompt the dispatcher hands an agent, worded from the run's settings and what the run knows of the ticket. */
import { DISPATCH_PROTOCOL }       from '../../../src/shared/constants/DispatchProtocol.ts';
import { DispatcherClaimNoteUtil } from '../../../src/shared/utils/DispatcherClaimNoteUtil.ts';
import type { DispatchSettings }   from '../../@types/DispatchSettings.ts';
import type { PreviousPass }       from '../../@types/DispatchWork.ts';
import { DISPATCH_POLICY }         from '../../constants/DispatchPolicy.ts';

export interface BuilderPromptRequest {
  ticketId:                    string;
  previousPass:                PreviousPass;
  owner:                       string;
  pausedBuildWasFoundBySurvey: boolean;
}

export interface ReviewerPromptRequest {
  ticketId:            string;
  expectedRound:       number;
  rereviewRunsFirst:   boolean;
  earlierReviewerDied: boolean;
  owner:               string;
}

const READY_TICKETS_ADDITION_TEXT = 'adding `readyTickets` (the same document\'s top-level `readyTickets` list, verbatim)';

const STATUS_RETURN_TEXT = `As your very last act run \`agent-progress status --json\` and return its \`concurrency\` block as \`status\`, ${READY_TICKETS_ADDITION_TEXT}, `
  + 'so the dispatcher acts on the newest board.';

function branchOf(ticketId: string): string {
  return `ticket-${ticketId}`;
}

function worktreeOf(settings: DispatchSettings, ticketId: string): string {
  return `${settings.mainCheckout}/.claude/worktrees/${branchOf(ticketId)}`;
}

function briefPlaceholdersText(settings: DispatchSettings, ticketId: string): string {
  return `with <worktree> = ${worktreeOf(settings, ticketId)}, <branch> = ${branchOf(ticketId)}, <main line> = ${settings.mainLine}, `
    + `<main checkout> = ${settings.mainCheckout} and <full check command> = \`${settings.checkCommand}\``;
}

function reviewNoteOf(settings: DispatchSettings, ticketId: string): string {
  return `Reviewed by the ${settings.runLabel} dispatcher run on ticket-${ticketId}`;
}

function startReviewCommandOf(settings: DispatchSettings, verb: 'finish' | 'rereview', ticketId: string, owner: string): string {
  return `agent-progress ticket ${verb} ${ticketId} --start-review --owner ${owner} --note "${reviewNoteOf(settings, ticketId)}"`;
}

function surveyPrompt(settings: DispatchSettings): string {
  return [
    `Run \`agent-progress status --json\` once, in ${settings.mainCheckout}, then \`test -d\` once per entry of its \`pausedBuilds\`, and make no other call. `
      + 'Judge nothing; return:',
    '- `status`: its `concurrency` block as printed (limit, agentsInFlight, freeSlots, readyTicketIds, dispatcherState, heldTicketIds, inProgressTicketIds, '
      + `inProgressReviewOfIds), ${READY_TICKETS_ADDITION_TEXT};`,
    '- `reviewWaitingTickets`: the document\'s top-level `reviewWaitingTickets` list, verbatim;',
    '- `pausedBuilds`: each entry of the document\'s top-level `pausedBuilds` list, verbatim, with `worktreeExists` added: whether '
      + `\`test -d ${worktreeOf(settings, '<id>')}\` succeeds.`,
  ].join('\n');
}

function ticketSettingsLookupPrompt(settings: DispatchSettings, ticketIds: readonly string[]): string {
  return [
    `agent-progress settings: ${ticketIds.join(',')}`,
    `For each of the tickets ${ticketIds.join(', ')}, run \`agent-progress ticket show <id> --json\` once, in ${settings.mainCheckout}, and make no other call. `
      + 'Judge nothing; return `tickets`: one `{ id, model, effort }` per ticket, with `model` and `effort` copied from its document and left out where it has none.',
  ].join('\n');
}

// A build a hold or a stop left paused is taken over by a whole-board run whose survey found it, or by a run launched for that ticket alone.
function pausedBuildTakeoverText(settings: DispatchSettings, ticketId: string, pausedBuildWasFoundBySurvey: boolean): string {
  if (settings.ticketIds === null && !pausedBuildWasFoundBySurvey) return '';
  const whyThisRunTakesItOver = settings.ticketIds === null ? 'This run found this ticket\'s build paused' : 'This run was launched for this ticket alone';
  const { opening, ending } = DispatcherClaimNoteUtil.claimNoteBoundsFor(ticketId);
  return `${whyThisRunTakesItOver}: when the note is instead another dispatcher run's claim, beginning "${opening}" and ending `
    + `"${ending}", the row is \`paused\` and ${worktreeOf(settings, ticketId)} exists, a hold or a stop left that build paused, `
    + 'and it is this run\'s to take over in the same way. ';
}

// A first pass of a ready ticket finds its own claim at most, left running by a restart or a resume, never a paused row. `task start` keeps the
// row's note unless given one, and another run's note would make a later builder of this run read the row as that run's and leave it running.
function pausedRowResumptionText(settings: DispatchSettings, ticketId: string, previousPass: PreviousPass, takeoverText: string): string {
  if (previousPass === null && takeoverText === '') return '';
  const claimNote = DispatcherClaimNoteUtil.claimNoteFor(settings.runLabel, ticketId);
  return 'When the row you carry on past is `paused` rather than `in-progress`, '
    + `resume it first with \`agent-progress task start <that row> --note "${claimNote}"\`, so your build holds its slot under this run's claim. `;
}

function builderPrompt(settings: DispatchSettings, request: BuilderPromptRequest): string {
  const {
    ticketId,
    previousPass,
    owner,
    pausedBuildWasFoundBySurvey,
  } = request;
  const worktree = worktreeOf(settings, ticketId);
  const claimNote = DispatcherClaimNoteUtil.claimNoteFor(settings.runLabel, ticketId);
  const takeoverText = pausedBuildTakeoverText(settings, ticketId, pausedBuildWasFoundBySurvey);
  // A restarted or resumed builder repeats its prompt and finds its first attempt's claim, which `ticket claim` refuses as in-progress; another
  // dispatcher run may hold the ticket too, so the row's note decides.
  const claimRefusalText = 'If it exits 1 saying the ticket is in-progress, read the `note` of the `row` in the ticket\'s `ticketRows` entry '
    + `of \`agent-progress status --json\`. When that note is exactly "${claimNote}" and ${worktree} exists, `
    + 'the claim is this run\'s own: an earlier attempt at this ticket made it, a builder of this run that stopped short, or this very builder before the runtime '
    + 'restarted or resumed it. Carry on in that worktree, keeping every uncommitted edit it holds. '
    + takeoverText
    + pausedRowResumptionText(settings, ticketId, previousPass, takeoverText)
    + 'On any other refusal, stop at once and return outcome '
    + '`claim-refused` with its message verbatim as `detail` and, when it was refused as in-progress, that row\'s note as `claimNote`.';
  const lines = [
    `agent-progress ticket: ${ticketId}`,
    `Worktree: ${worktree}   Branch: ${branchOf(ticketId)}   Main checkout: ${settings.mainCheckout}   Main line: ${settings.mainLine}`,
    `You build ticket #${ticketId} for the agent-progress dispatcher, alone: one ticket, one agent.`,
    `FIRST command, before anything else: \`agent-progress ticket claim ${ticketId} --owner ${owner} --note "${claimNote}"\`. `
      + claimRefusalText,
    `Then the worktree: when ${worktree} exists, reuse it as it stands, since it holds an earlier pass's commits and edits; start from \`git -C ${worktree} status\`. `
      + `Otherwise \`git -C ${settings.mainCheckout} worktree add ${worktree} -b ${branchOf(ticketId)} ${settings.mainLine}\`, dropping \`-b\` when the branch already exists.`,
  ];
  if (settings.installCommand !== '') lines.push(`In a worktree you just created, run \`${settings.installCommand}\` in it once before anything else there.`);
  lines.push(
    'Everything you do happens in that worktree: every edit, every command, every commit, git as `git -C <worktree>`. '
      + 'Your working directory may be the main checkout; it is not yours to touch.',
    `The task is the ticket: \`agent-progress ticket show ${ticketId}\` prints it. Its \`## Brief\` section, when it has one, is your brief; `
      + 'otherwise Report, Wanted and Acceptance are, and the files they name are where the work belongs.',
  );
  if (previousPass === 'review') lines.push('A reviewer found that the previous pass does not hold: the last `## Review` in the ticket says why, and your work starts there.');
  if (previousPass === 'builder') lines.push('An earlier builder of this run stopped before review: the worktree holds whatever it committed, and your work continues from there.');
  if (previousPass === 'paused') {
    lines.push('An earlier dispatcher run left this build paused: the worktree holds whatever its builder committed or left uncommitted, and your work continues from there.');
  }
  lines.push(
    `Read \`${settings.mainCheckout}/${DISPATCH_PROTOCOL.AGENT_BRIEF_PATH_IN_REPOSITORY}\` once and follow its fenced blocks under Call discipline, Stop conditions, `
      + `Find and fix, Ready to merge and Report, ${briefPlaceholdersText(settings, ticketId)}. The Scope, Contract, Browser loop and Review brief blocks are not yours.`,
    'Do not `cat` any CLAUDE.md.',
    `Stop when the Acceptance block is satisfied, or at about ${DISPATCH_PROTOCOL.BUILDER_API_CALL_BUDGET} API calls, whichever is first.`,
    // One lock hold moves the ticket to review and starts its reviewer's bar, so no status block between builder and reviewer shows the slot free.
    `Close as Ready to merge says, append the \`## Handoff\`, then run \`${startReviewCommandOf(settings, 'finish', ticketId, owner)}\`. `
      + `Never merge ${branchOf(ticketId)} into ${settings.mainLine} and never run \`agent-progress release\`: the release is the reviewer's.`,
    'Return outcome `in-review` when `ticket finish` succeeded and `failed` otherwise, with your report as `detail` and `claimNote` empty unless your claim '
      + `was refused as in-progress. ${STATUS_RETURN_TEXT}`,
  );
  return lines.join('\n');
}

function reviewerPrompt(settings: DispatchSettings, request: ReviewerPromptRequest): string {
  const {
    ticketId,
    expectedRound,
    rereviewRunsFirst,
    earlierReviewerDied,
    owner,
  } = request;
  const lines = [
    `agent-progress review: ${ticketId}`,
    `Worktree: ${worktreeOf(settings, ticketId)}   Branch: ${branchOf(ticketId)}   Main checkout: ${settings.mainCheckout}   Main line: ${settings.mainLine}`,
    `You are a clean reviewer of ticket #${ticketId} for the agent-progress dispatcher, round ${expectedRound} as the dispatcher counts it. `
      + 'Your round is the number of `## Review` sections already in the ticket plus one; return it as `round`.',
  ];
  // `rereview` counts a round each time it runs, and a restarted or resumed reviewer repeats its prompt; the bar it opened for this round is its trace.
  if (rereviewRunsFirst) {
    lines.push(
      `FIRST, before anything else: read your round from \`agent-progress ticket show ${ticketId}\`, and the ticket's \`ticketRows\` entry `
        + 'from `agent-progress status --json`. When its `reviewBars` list an `in-progress` bar whose `round` is your round, the rereview of your round already ran: '
        + 'skip the rereview and take that row as your bar. '
        + `Otherwise run \`${startReviewCommandOf(settings, 'rereview', ticketId, owner)}\` as your next command; it starts your bar.`,
    );
  }
  if (earlierReviewerDied) lines.push('An earlier reviewer of this run returned nothing, and its bar may still be running.');
  // A second bar would leave the first running, holding one of the board's slots for the rest of the run, and any reviewer may find its own first
  // attempt's bar, since a restart or a resume repeats its prompt.
  lines.push(
    `Then your bar. When the \`ticketRows\` entry for ${ticketId} in \`agent-progress status --json\` lists an \`in-progress\` review bar, it is this review's own, `
      + 'left by an earlier reviewer '
      + 'of this run, by the builder\'s `--start-review` or by this very reviewer before the runtime restarted or resumed it: take it as your bar and add none. '
      + `Otherwise add your own: \`agent-progress task add "Review <round> #${ticketId} — <ticket title>" --review-of ${ticketId} --owner ${owner} `
      + `--note "${reviewNoteOf(settings, ticketId)}" --start\`, `
      + `the title from \`agent-progress ticket show ${ticketId}\`. Your bar takes the place of the brief's \`agent-progress row:\` line; `
      + 'the review line above carries your tokens to it.',
    `Read \`${settings.mainCheckout}/${DISPATCH_PROTOCOL.AGENT_BRIEF_PATH_IN_REPOSITORY}\` once and follow the fenced block under \`## Review brief\` as your whole procedure, `
      + `steps 0 to 8, ${briefPlaceholdersText(settings, ticketId)}. Step 0 reads the diff first; you fix only what you review.`,
    `You may use up to about ${DISPATCH_PROTOCOL.REVIEWER_API_CALL_BUDGET} API calls.`,
    'Every finding you would hand on instead of fixing, you file yourself: '
      + '`agent-progress ticket add "<what and where>" --priority low --body "<what you saw and what you would do>"`; '
      + 'return the ids it printed as `filedTicketIds`.',
    `Step 7b is a count: request the next round only when over ${DISPATCH_PROTOCOL.REWORK_ROUND_THRESHOLD_LINES} lines of code were reworked. `
      + 'Whether that round runs is the dispatcher\'s decision.',
    'A release refused with `main-moved` is yours to handle, as step 8 says. On `round-requested`, and on `not-released` for `main-moved`, leave your bar running: '
      + 'the next round\'s `ticket rereview --start-review` closes it, so the ticket\'s slot stays held. On every other verdict than released, close your own bar: '
      + '`agent-progress task finish <bar>`, then `agent-progress task deliver <bar>`.',
    'Return `verdict` (released, round-requested, does-not-hold or not-released), `releaseReason` (the release\'s reason when not-released, empty otherwise), '
      + '`reworkedLines` (both rework counts together), `findings` (every finding of this round, each with a one-word `class`, its `file` and a one-line `summary`), '
      + `and \`filedTicketIds\`. ${STATUS_RETURN_TEXT}`,
  );
  return lines.join('\n');
}

// The line goes inside a double-quoted shell argument, so nothing in it may end the quotes or expand.
function boardLogLineText(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/["`$\\]/g, '\'').slice(0, DISPATCH_POLICY.PARKING_LOG_REASON_LIMIT_CHARACTERS);
}

function parkingPrompt(settings: DispatchSettings, ticketId: string, boardLogLine: string): string {
  return [
    `agent-progress park: ${ticketId}`,
    `You close the rows of ticket #${ticketId} that no agent of the agent-progress dispatcher works on any more, in ${settings.mainCheckout}. `
      + 'Judge nothing and change no file.',
    `1. In \`agent-progress status --json\`, take the \`ticketRows\` entry for ${ticketId}: when its \`row\` is \`in-progress\`, `
      + 'run `agent-progress task pause <that row>`.',
    '2. Each of that entry\'s `reviewBars` that is `in-progress` is a review bar nobody works on: close it with `agent-progress task finish <that row>`, '
      + 'then `agent-progress task deliver <that row>`.',
    `3. \`agent-progress log "${boardLogLineText(boardLogLine)}"\`.`,
    STATUS_RETURN_TEXT,
  ].join('\n');
}

export const AgentPromptUtil = {
  builderPrompt,
  reviewerPrompt,
  surveyPrompt,
  ticketSettingsLookupPrompt,
  parkingPrompt,
} as const;
