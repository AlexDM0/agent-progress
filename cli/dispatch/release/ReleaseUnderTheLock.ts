/**
 * The release itself, inside the tracker's lock hold, so two releases are serialised and the second sees the main line the first one
 * moved. Every check comes before the merge, and the merge before the ticket moves: a refusal at any step leaves main and the tracker as
 * they were. A checked tip is held to the branch's tip and the tracker's check command as they stand inside the lock.
 */
import { fastForwardTo }                                                           from '../../../src/lib/git/BranchIntegration.ts';
import type { LogRecord }                                                          from '../../../src/lib/tracker-model/@types/LogRecord.ts';
import type { Task }                                                               from '../../../src/lib/tracker-model/@types/Task.ts';
import type { Ticket }                                                             from '../../../src/lib/tracker-model/@types/Ticket.ts';
import type { TrackerChange }                                                      from '../../../src/services/tracker/TrackerPipeline.ts';
import type { CommandContext }                                                     from '../../CommandContext.ts';
import { openTrackerForWritingThenReadNextLine }                                   from '../../OpenTrackerForWriting.ts';
import type { ArgumentParser }                                                     from '../../arguments/ArgumentParser.ts';
import { OutputUtil }                                                              from '../../utils/OutputUtil.ts';
import type { CheckedTip }                                                         from './ReleaseChecks.ts';
import { branchCommitToRelease, releasableTickets, requireMainCheckoutOnMainLine } from './ReleaseReadings.ts';
import { refuseTheRelease }                                                        from './ReleaseRefusal.ts';
import type { ReleaseRequest }                                                     from './ReleaseRequest.ts';

export interface Release {
  tickets:          readonly Readonly<Ticket>[];
  commit:           string;
  mainCheckout:     string;
  closedReviewRows: readonly Readonly<Task>[];
  logged:           readonly LogRecord[];
}

function requireTheCheckedTip(change: TrackerChange, checkedTip: CheckedTip | null, branch: string, branchCommit: string): void {
  const storedCheckCommand = change.board.checkCommand() ?? null;
  if (storedCheckCommand !== (checkedTip?.checkCommand ?? null)) {
    refuseTheRelease(
      'check-command-changed',
      `The tracker's check command changed while this release was getting ready (now ${storedCheckCommand === null ? 'none' : `\`${storedCheckCommand}\``}), `
      + 'so what it checked is not what the tracker asks for: release again.',
    );
  }
  if (checkedTip !== null && checkedTip.commit !== branchCommit) {
    refuseTheRelease(
      'branch-moved',
      `${branch} moved from ${OutputUtil.shortCommitOf(checkedTip.commit)}, the commit the checks passed on, to ${OutputUtil.shortCommitOf(branchCommit)} `
      + 'while they ran: release again to check the new tip.',
    );
  }
}

export async function releaseUnderTheLock(
  request: ReleaseRequest,
  checkedTip: CheckedTip | null,
  commandArguments: ArgumentParser,
  context: CommandContext,
): Promise<{ release: Release; nextLine: string }> {
  const { result, nextLine } = await openTrackerForWritingThenReadNextLine(commandArguments, context, (change) => {
    const tickets      = releasableTickets(change.board, request.references);
    const mainCheckout = change.workspace.rootDirectory;
    requireMainCheckoutOnMainLine(mainCheckout, request.mainLine);
    const branchCommit = branchCommitToRelease(mainCheckout, request.branch, request.mainLine);
    requireTheCheckedTip(change, checkedTip, request.branch, branchCommit);

    const merge = fastForwardTo(mainCheckout, branchCommit);
    if (merge.verdict === 'refused') {
      const blockingFilesText = merge.blockingFiles.length > 0
        ? ` Commit or stash the main checkout's uncommitted changes to ${merge.blockingFiles.join(', ')}, which the merge would overwrite.`
        : '';
      refuseTheRelease('merge-refused', `git would not fast-forward ${request.mainLine} to ${request.branch}: ${merge.reason.trim()}${blockingFilesText}`, merge.blockingFiles);
    }

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
