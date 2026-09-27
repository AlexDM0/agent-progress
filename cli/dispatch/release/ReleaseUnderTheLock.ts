/**
 * The release itself, inside the tracker's lock hold, so two releases are serialised and the second sees the main line the first one
 * moved. Every check comes before the merge, and the merge before the ticket moves: a refusal at any step leaves main and the tracker as
 * they were.
 */
import { fastForwardTo, readBranchDescent, readCurrentBranch } from '../../../src/lib/git/BranchIntegration.ts';
import type { LogRecord }                                      from '../../../src/lib/tracker-model/@types/LogRecord.ts';
import type { Task }                                           from '../../../src/lib/tracker-model/@types/Task.ts';
import type { Ticket }                                         from '../../../src/lib/tracker-model/@types/Ticket.ts';
import type { Board }                                          from '../../../src/lib/tracker-model/Board.ts';
import { LEGAL_SOURCE_STATUSES_FOR_TICKET_STATUS }             from '../../../src/lib/tracker-model/constants/TicketMoveLegality.ts';
import type { CommandContext }                                 from '../../CommandContext.ts';
import { openTrackerForWritingThenReadNextLine }               from '../../OpenTrackerForWriting.ts';
import type { ArgumentParser }                                 from '../../arguments/ArgumentParser.ts';
import { CommitTextUtil }                                      from '../../utils/CommitTextUtil.ts';
import { ReleaseRefusal, refuseTheRelease }                    from './ReleaseRefusal.ts';
import type { ReleaseRequest }                                 from './ReleaseRequest.ts';

export interface Release {
  tickets:          readonly Readonly<Ticket>[];
  commit:           string;
  mainCheckout:     string;
  closedReviewRows: readonly Readonly<Task>[];
  logged:           readonly LogRecord[];
}

function releasableTicket(board: Board, reference: string): Readonly<Ticket> {
  const ticket = board.ticketByReference(reference);
  if (ticket === undefined) {
    refuseTheRelease('unknown-ticket', `There is no readable ticket ${reference}. Run \`agent-progress ticket list\` to see what this tracker holds.`);
  }
  const { id, status } = ticket.frontmatter;
  if (!board.ticketIsReleasable(ticket)) {
    const releasableStatusesText = LEGAL_SOURCE_STATUSES_FOR_TICKET_STATUS.reviewed.join(' or ');
    refuseTheRelease('ticket-not-releasable', `Ticket #${id} is ${status}, and a release takes a ticket that is ${releasableStatusesText}.`);
  }
  return ticket;
}

function requireMainCheckoutOnMainLine(mainCheckout: string, mainLine: string): void {
  const reading = readCurrentBranch(mainCheckout);
  if (reading.verdict === 'git-failed') throw new ReleaseRefusal('unrepaired', 'git-failed', `The main checkout's branch could not be read: ${reading.reason}`);
  const currentBranch = reading.verdict === 'on-branch' ? reading.branch : 'a detached HEAD';
  if (currentBranch !== mainLine) {
    refuseTheRelease(
      'not-on-main-line',
      `The main checkout ${mainCheckout} is on ${currentBranch}, not ${mainLine}: a release fast-forwards ${mainLine} there, so check it out first.`,
    );
  }
}

function branchCommitToRelease(mainCheckout: string, branch: string, mainLine: string): string {
  const reading = readBranchDescent(mainCheckout, branch, mainLine);
  switch (reading.verdict) {
    case 'unknown-branch':
      return refuseTheRelease('unknown-branch', `--branch "${branch}" is not a local branch of the repository at ${mainCheckout}.`);
    case 'unknown-main-line':
      return refuseTheRelease('not-on-main-line', `--main "${mainLine}" is not a local branch of the repository at ${mainCheckout}.`);
    case 'git-failed':
      throw new ReleaseRefusal('unrepaired', 'git-failed', reading.reason);
    case 'not-a-descendant':
      return refuseTheRelease(
        'main-moved',
        `Main moved: ${branch} (${CommitTextUtil.shortCommitOf(reading.branchCommit)}) `
        + `does not descend from ${mainLine} (${CommitTextUtil.shortCommitOf(reading.mainLineCommit)}), `
        + `so it cannot be fast-forwarded. Rebase ${branch} onto ${mainLine}, run the checks again, and run \`agent-progress release\` again.`,
      );
    case 'descendant':
      return reading.branchCommit;
  }
}

export async function releaseUnderTheLock(
  request: ReleaseRequest,
  commandArguments: ArgumentParser,
  context: CommandContext,
): Promise<{ release: Release; nextLine: string }> {
  const { result, nextLine } = await openTrackerForWritingThenReadNextLine(commandArguments, context, (change) => {
    const namedTickets = request.references.map((reference) => releasableTicket(change.board, reference));
    const tickets      = namedTickets.filter((ticket, index) => namedTickets.findIndex(({ frontmatter }) => frontmatter.id === ticket.frontmatter.id) === index);
    const mainCheckout = change.workspace.rootDirectory;
    requireMainCheckoutOnMainLine(mainCheckout, request.mainLine);
    const branchCommit = branchCommitToRelease(mainCheckout, request.branch, request.mainLine);

    const merge = fastForwardTo(mainCheckout, branchCommit);
    if (merge.verdict === 'refused') refuseTheRelease('merge-refused', `git would not fast-forward ${request.mainLine} to ${request.branch}: ${merge.reason}`);

    const released = change.board.releaseTickets(tickets.map(({ frontmatter }) => frontmatter.id), { branch: request.branch, commit: merge.commit }, change.at);
    return {
      tickets:          released.tickets,
      commit:           merge.commit,
      mainCheckout,
      closedReviewRows: released.closedReviewBars,
      logged:           released.logged,
    };
  });
  return { release: result, nextLine };
}
