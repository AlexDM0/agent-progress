/**
 * `agent-progress release`: fast-forward the main checkout to a reviewed branch and deliver its ticket, inside the tracker's lock hold, so
 * two releases are serialised and the second sees the main line the first one moved. The cleanup runs after the lock is released and
 * never turns a release that happened into a failure.
 */
import { resolve } from 'node:path';

import type { Task, Ticket }                                                       from '../../lib/constants/Types';
import type { BranchDeletionOutcome, FilesLeftInWorktree, WorktreeRemovalOutcome } from '../../lib/platform/BranchRelease';
import {
  deleteMergedBranch,
  fastForwardTo,
  readBranchDescent,
  readCurrentBranch,
  removeWorktree
}                                                                                            from '../../lib/platform/BranchRelease';
import { OperationRefusal, refusalIsOperationRefusal, type OperationRefusalStatus }          from '../../lib/platform/OperationRefusal';
import { readTicket }                                                                        from '../../lib/tickets/TicketStore';
import { LEGAL_SOURCE_STATUSES_FOR_TICKET_STATUS, applyTicketTransition, ticketMoveIsLegal } from '../../lib/tickets/TicketTransitions';
import type { CommandContext }                                                               from '../CommandContext';
import {
  closeRunningReviewRows,
  openTrackerForWritingThenReadNextLine,
  printEntity,
  printEntityThenNextLine,
  progressOperations
}                                                                                              from '../CommandSupport';
import type { CommandHandler } from '../CommandTable';
import type { ArgumentParser } from '../arguments/ArgumentParser';

const USAGE = 'agent-progress release <id> [<id>...] --branch <branch> [--worktree <path>] [--main <line>] [--json]';

const KNOWN_OPTION_NAMES = ['branch', 'worktree', 'main', 'json'];

const DEFAULT_MAIN_LINE = 'main';

const SHORT_COMMIT_LENGTH = 8;

const OPTION_PREFIX = '-';

export type ReleaseRefusalReason =
  | 'invalid-request'
  | 'unknown-ticket'
  | 'ticket-not-releasable'
  | 'unknown-branch'
  | 'not-on-main-line'
  | 'main-moved'
  | 'merge-refused'
  | 'git-failed'
  | 'tracker-failed';

class ReleaseRefusal extends OperationRefusal {
  readonly reason: ReleaseRefusalReason;

  constructor(status: OperationRefusalStatus, reason: ReleaseRefusalReason, message: string) {
    super(status, message);
    this.reason = reason;
  }
}

type CleanupStep =
  | { target: 'worktree'; path: string; outcome: 'removed' }
  | { target: 'worktree'; path: string; outcome: 'left'; reason: string; untrackedFiles: string[]; changedFiles: string[] }
  | { target: 'branch'; name: string; outcome: 'deleted' }
  | { target: 'branch'; name: string; outcome: 'left'; reason: string };

interface ReleaseRequest {
  references:    string[];
  branch:        string;
  mainLine:      string;
  worktreePath?: string;
}

interface Release {
  tickets:          Ticket[];
  commit:           string;
  mainCheckout:     string;
  closedReviewRows: Task[];
}

function shortCommit(commit: string): string {
  return commit.slice(0, SHORT_COMMIT_LENGTH);
}

function refuse(reason: ReleaseRefusalReason, message: string): never {
  throw new ReleaseRefusal('refused', reason, `${message} Nothing was changed.`);
}

function releaseRequestFrom(commandArguments: ArgumentParser, context: CommandContext): ReleaseRequest {
  commandArguments.rejectUnknownOptions(KNOWN_OPTION_NAMES, USAGE);

  // Several ids are the tickets of one bundle, which share the branch: they are released by the one fast-forward.
  const references = [...new Set(commandArguments.positionals())];
  const branch     = commandArguments.option('branch');
  if (references.length === 0 || branch === undefined || branch.trim() === '') {
    refuse('invalid-request', `agent-progress release needs a ticket id and --branch: ${USAGE}.`);
  }
  const mainLine = commandArguments.option('main') ?? DEFAULT_MAIN_LINE;
  // A name git would read as an option is refused here, since `git branch -d` is handed it verbatim.
  if (branch.startsWith(OPTION_PREFIX) || mainLine.startsWith(OPTION_PREFIX)) {
    refuse('invalid-request', `A branch name cannot begin with "${OPTION_PREFIX}".`);
  }
  if (branch === mainLine) {
    refuse('invalid-request', `--branch names the main line ${mainLine} itself; name the reviewed branch to release into it.`);
  }
  const worktreeOption = commandArguments.option('worktree');
  return {
    references,
    branch,
    mainLine,
    ...(worktreeOption === undefined ? {} : { worktreePath: resolve(context.currentDirectory, worktreeOption) }),
  };
}

function releasableTicket(ticket: Ticket | null, reference: string): Ticket {
  if (ticket === null) {
    refuse('unknown-ticket', `There is no readable ticket ${reference}. Run \`agent-progress ticket list\` to see what this tracker holds.`);
  }
  const { id, status } = ticket.frontmatter;
  if (!ticketMoveIsLegal(status, 'done')) {
    refuse('ticket-not-releasable', `Ticket #${id} is ${status}, and a release takes a ticket that is ${LEGAL_SOURCE_STATUSES_FOR_TICKET_STATUS.done.join(' or ')}.`);
  }
  return ticket;
}

function requireMainCheckoutOnMainLine(mainCheckout: string, mainLine: string): void {
  const reading = readCurrentBranch(mainCheckout);
  if (reading.verdict === 'git-failed') throw new ReleaseRefusal('unrepaired', 'git-failed', `The main checkout's branch could not be read: ${reading.reason}`);
  const currentBranch = reading.verdict === 'on-branch' ? reading.branch : 'a detached HEAD';
  if (currentBranch !== mainLine) {
    refuse('not-on-main-line', `The main checkout ${mainCheckout} is on ${currentBranch}, not ${mainLine}: a release fast-forwards ${mainLine} there, so check it out first.`);
  }
}

function branchCommitToRelease(mainCheckout: string, branch: string, mainLine: string): string {
  const reading = readBranchDescent(mainCheckout, branch, mainLine);
  switch (reading.verdict) {
    case 'unknown-branch':
      return refuse('unknown-branch', `--branch "${branch}" is not a local branch of the repository at ${mainCheckout}.`);
    case 'unknown-main-line':
      return refuse('not-on-main-line', `--main "${mainLine}" is not a local branch of the repository at ${mainCheckout}.`);
    case 'git-failed':
      throw new ReleaseRefusal('unrepaired', 'git-failed', reading.reason);
    case 'not-a-descendant':
      return refuse(
        'main-moved',
        `Main moved: ${branch} (${shortCommit(reading.branchCommit)}) does not descend from ${mainLine} (${shortCommit(reading.mainLineCommit)}), `
        + `so it cannot be fast-forwarded. Rebase ${branch} onto ${mainLine}, run the checks again, and run \`agent-progress release\` again.`,
      );
    case 'descendant':
      return reading.branchCommit;
  }
}

/** Every check comes before the merge, and the merge before the ticket moves: a refusal at any step leaves main and the tracker as they were. */
async function releaseUnderTheLock(
  request: ReleaseRequest,
  commandArguments: ArgumentParser,
  context: CommandContext,
): Promise<{ release: Release; nextLine: string }> {
  const { result, nextLine } = await openTrackerForWritingThenReadNextLine(commandArguments, context, (change) => {
    const namedTickets = request.references.map((reference) => releasableTicket(readTicket(change.workspace, reference), reference));
    const tickets      = namedTickets.filter((ticket, index) => namedTickets.findIndex(({ frontmatter }) => frontmatter.id === ticket.frontmatter.id) === index);
    const mainCheckout = change.workspace.rootDirectory;
    requireMainCheckoutOnMainLine(mainCheckout, request.mainLine);
    const branchCommit = branchCommitToRelease(mainCheckout, request.branch, request.mainLine);

    const merge = fastForwardTo(mainCheckout, branchCommit);
    if (merge.verdict === 'refused') refuse('merge-refused', `git would not fast-forward ${request.mainLine} to ${request.branch}: ${merge.reason}`);

    const common = { progress: change.progress, at: change.at, operations: progressOperations };
    for (const ticket of tickets) {
      applyTicketTransition({ ...common, ticket, targetStatus: 'done' });
      applyTicketTransition({
        ...common,
        ticket,
        targetStatus: 'delivered',
        branch:       request.branch,
        commit:       merge.commit,
      });
      change.writeTicketAfterwards(ticket);
    }

    // The reviewer releases as the last step of its pass, so its bar is closed here rather than left running until the orchestrator reads the verdict.
    const closedReviewRows = closeRunningReviewRows(change.progress, tickets.map(({ frontmatter }) => frontmatter.id), change.at);
    return {
      tickets,
      commit: merge.commit,
      mainCheckout,
      closedReviewRows,
    };
  });
  return { release: result, nextLine };
}

function worktreeStep(path: string, outcome: WorktreeRemovalOutcome): CleanupStep {
  if (outcome.verdict === 'removed') return { target: 'worktree', path, outcome: 'removed' };
  return {
    target:         'worktree',
    path,
    outcome:        'left',
    reason:         outcome.reason,
    untrackedFiles: outcome.filesLeft.untrackedFiles,
    changedFiles:   outcome.filesLeft.changedFiles,
  };
}

function branchStep(name: string, outcome: BranchDeletionOutcome): CleanupStep {
  if (outcome.verdict === 'deleted') return { target: 'branch', name, outcome: 'deleted' };
  return {
    target:  'branch',
    name,
    outcome: 'left',
    reason:  outcome.reason,
  };
}

function filesLeftText({ untrackedFiles, changedFiles }: FilesLeftInWorktree): string {
  const parts = [
    ...(untrackedFiles.length === 0 ? [] : [`untracked: ${untrackedFiles.join(', ')}`]),
    ...(changedFiles.length === 0 ? [] : [`changed: ${changedFiles.join(', ')}`]),
  ];
  return parts.length === 0 ? '' : ` It holds files git would lose (${parts.join('; ')}).`;
}

function cleanupLine(step: CleanupStep): string {
  if (step.target === 'worktree') {
    if (step.outcome === 'removed') return `Removed the worktree ${step.path}.`;
    return `The worktree ${step.path} is still there: ${step.reason}.${filesLeftText(step)} It was not forced; remove it once they are dealt with.`;
  }
  if (step.outcome === 'deleted') return `Deleted the branch ${step.name}.`;
  return `The branch ${step.name} is still there: ${step.reason}.`;
}

function reasonOfRefusal(refusal: OperationRefusal): ReleaseRefusalReason {
  if (refusal instanceof ReleaseRefusal) return refusal.reason;
  return refusal.status === 'refused' ? 'invalid-request' : 'tracker-failed';
}

export const releaseCommand: CommandHandler = async (commandArguments, context) => {
  let release: Release;
  let nextLine: string;
  let request: ReleaseRequest;
  try {
    request = releaseRequestFrom(commandArguments, context);
    ({ release, nextLine } = await releaseUnderTheLock(request, commandArguments, context));
  } catch (error) {
    if (refusalIsOperationRefusal(error) && commandArguments.flag('json')) {
      const refusalDocument = {
        released: false,
        reason:   reasonOfRefusal(error),
        detail:   error.message,
        cleanup:  [],
      };
      printEntity(commandArguments, context, refusalDocument, '');
    }
    throw error;
  }

  const {
    mainCheckout,
    tickets,
    commit,
    closedReviewRows,
  } = release;
  const cleanup: CleanupStep[] = [];
  if (request.worktreePath !== undefined) cleanup.push(worktreeStep(request.worktreePath, removeWorktree(mainCheckout, request.worktreePath)));
  cleanup.push(branchStep(request.branch, deleteMergedBranch(mainCheckout, request.branch)));

  const ticketIds    = tickets.map(({ frontmatter }) => frontmatter.id);
  const ticketsNamed = ticketIds.length === 1 ? `ticket #${ticketIds.join('')}` : `tickets ${ticketIds.map((identifier) => `#${identifier}`).join(', ')}`;
  const headline     = `Released ${ticketsNamed}: ${request.mainLine} fast-forwarded to ${shortCommit(commit)} from ${request.branch}, and delivered.`;
  const reviewLines  = closedReviewRows.map(({ id, name }) => `Closed the review row #${id}, delivered: ${name}`);
  const document     = {
    released:         true,
    tickets:          ticketIds,
    branch:           request.branch,
    mainLine:         request.mainLine,
    commit,
    closedReviewRows: closedReviewRows.map(({ id }) => id),
    cleanup,
  };
  printEntityThenNextLine(commandArguments, context, document, [headline, ...reviewLines, ...cleanup.map(cleanupLine)].join('\n'), nextLine);
};
