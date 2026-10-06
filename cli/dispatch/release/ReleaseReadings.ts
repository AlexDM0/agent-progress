/** What a release reads of the board, the main checkout and the branch, before its checks run and again inside the lock, refused in the same words. */
import { readBranchDescent, readCurrentBranch }    from '../../../src/lib/git/BranchIntegration.ts';
import type { Ticket }                             from '../../../src/lib/tracker-model/@types/Ticket.ts';
import type { Board }                              from '../../../src/lib/tracker-model/Board.ts';
import { LEGAL_SOURCE_STATUSES_FOR_TICKET_STATUS } from '../../../src/lib/tracker-model/constants/TicketMoveLegality.ts';
import { OutputUtil }                              from '../../utils/OutputUtil.ts';
import { ReleaseRefusal, refuseTheRelease }        from './ReleaseRefusal.ts';

function namedTicket(board: Board, reference: string): Readonly<Ticket> {
  const ticket = board.ticketByReference(reference);
  if (ticket === undefined) {
    refuseTheRelease('unknown-ticket', `There is no readable ticket ${reference}. Run \`agent-progress ticket list\` to see what this tracker holds.`);
  }
  return ticket;
}

/** Judged against every ticket named, since a reviewed bundle ticket is releasable only beside its group's release ticket. */
export function releasableTickets(board: Board, references: readonly string[]): Readonly<Ticket>[] {
  const namedTickets      = references.map((reference) => namedTicket(board, reference));
  const tickets           = namedTickets.filter((ticket, index) => namedTickets.findIndex(({ frontmatter }) => frontmatter.id === ticket.frontmatter.id) === index);
  const releasedTicketIds = tickets.map(({ frontmatter }) => frontmatter.id);
  for (const ticket of tickets) {
    if (board.ticketIsReleasable(ticket, releasedTicketIds)) continue;
    const { id, status }         = ticket.frontmatter;
    const releasableStatusesText = LEGAL_SOURCE_STATUSES_FOR_TICKET_STATUS.reviewed.join(' or ');
    refuseTheRelease(
      'ticket-not-releasable',
      `Ticket #${id} is ${status}, and a release takes a ticket that is ${releasableStatusesText}, `
      + 'or a reviewed ticket of a release bundle released together with its group\'s release ticket.',
    );
  }
  return tickets;
}

export function requireMainCheckoutOnMainLine(mainCheckout: string, mainLine: string): void {
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

export function branchCommitToRelease(mainCheckout: string, branch: string, mainLine: string): string {
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
        `Main moved: ${branch} (${OutputUtil.shortCommitOf(reading.branchCommit)}) `
        + `does not descend from ${mainLine} (${OutputUtil.shortCommitOf(reading.mainLineCommit)}), `
        + `so it cannot be fast-forwarded. Rebase ${branch} onto ${mainLine}, run the checks again, and run \`agent-progress release\` again.`,
      );
    case 'descendant':
      return reading.branchCommit;
  }
}
