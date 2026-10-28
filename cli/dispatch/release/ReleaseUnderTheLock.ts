/**
 * The release itself, inside the tracker's lock hold, so two releases are serialised and the second sees the main line the first one
 * moved. Every check comes before the landing, and the landing before the ticket moves: a refusal at any step leaves main and the tracker
 * as they were. The checked tip is held to the branch's tip and the tracker's check command as they stand inside the lock.
 */
import { GitProcess }                            from '../../../src/lib/git/GitProcess.ts';
import type { LogRecord }                        from '../../../src/lib/tracker-model/@types/LogRecord.ts';
import type { Task }                             from '../../../src/lib/tracker-model/@types/Task.ts';
import type { Ticket }                           from '../../../src/lib/tracker-model/@types/Ticket.ts';
import { Landing, type LandingVerdict }          from '../../../src/services/lifecycle/Landing.ts';
import type { TrackerChange }                    from '../../../src/services/tracker/TrackerPipeline.ts';
import type { CommandContext }                   from '../../CommandContext.ts';
import { openTrackerForWritingThenReadNextLine } from '../../OpenTrackerForWriting.ts';
import type { ArgumentParser }                   from '../../arguments/ArgumentParser.ts';
import { OutputUtil }                            from '../../utils/OutputUtil.ts';
import type { CheckedTip }                       from './ReleaseChecks.ts';
import {
  branchCommitToRelease,
  releasableTickets,
  requireEveryAcceptanceItemAccountedFor,
  requireMainCheckoutOnMainLine,
  requireStampsMatchingTheCheckCommand
} from './ReleaseReadings.ts';
import { ReleaseRefusal, refuseTheRelease } from './ReleaseRefusal.ts';
import type { ReleaseRequest }              from './ReleaseRequest.ts';

export interface Release {
  tickets:          readonly Readonly<Ticket>[];
  commit:           string;
  mainCheckout:     string;
  closedReviewRows: readonly Readonly<Task>[];
  logged:           readonly LogRecord[];
}

function requireTheCheckedTip(change: TrackerChange, checkedTip: CheckedTip, branch: string, branchCommit: string): void {
  const storedCheckCommand = change.board.checkCommand() ?? null;
  if (storedCheckCommand !== checkedTip.checkCommand) {
    refuseTheRelease(
      'check-command-changed',
      `The tracker's check command changed while this release was getting ready (now ${storedCheckCommand === null ? 'none' : `\`${storedCheckCommand}\``}), `
      + 'so what it checked is not what the tracker asks for: release again.',
    );
  }
  if (checkedTip.commit !== branchCommit) {
    refuseTheRelease(
      'branch-moved',
      `${branch} moved from ${OutputUtil.shortCommitOf(checkedTip.commit)}, the commit the checks passed on, to ${OutputUtil.shortCommitOf(branchCommit)} `
      + 'while they ran: release again to check the new tip.',
    );
  }
}

/** The main line's tip is read here, under the lock, and the landing compares it again just before it fast-forwards. */
function requireLandedOnTheMainLine(request: ReleaseRequest, mainCheckout: string, branchCommit: string): string {
  const mainLineTip = GitProcess.resolvedCommitOf(mainCheckout, `refs/heads/${request.mainLine}`);
  if (mainLineTip === null) throw new ReleaseRefusal('unrepaired', 'git-failed', `The tip of ${request.mainLine} could not be read in ${mainCheckout}.`);
  const landing: LandingVerdict = Landing.landOnTarget({
    target:            { branch: request.mainLine, directory: mainCheckout },
    mergedCommit:      branchCommit,
    expectedTargetTip: mainLineTip,
    recordedLandings:  [],
    hookPolicy:        'repository-hooks',
  });
  if (landing.verdict === 'landed') return landing.commit;
  if (landing.verdict === 'already-landed') return refuseTheRelease('main-moved', `${request.mainLine} already holds ${OutputUtil.shortCommitOf(branchCommit)}.`);
  const blockingFiles     = landing.facts.blockingFiles ?? [];
  const blockingFilesText = blockingFiles.length > 0
    ? ` Commit or stash the main checkout's uncommitted changes to ${blockingFiles.join(', ')}, which the merge would overwrite.`
    : '';
  return refuseTheRelease(
    'merge-refused',
    `git would not fast-forward ${request.mainLine} to ${request.branch}: ${landing.facts.gitFailure ?? landing.reason}${blockingFilesText}`,
    blockingFiles,
  );
}

export async function releaseUnderTheLock(
  request: ReleaseRequest,
  checkedTip: CheckedTip,
  commandArguments: ArgumentParser,
  context: CommandContext,
): Promise<{ release: Release; nextLine: string }> {
  const { result, nextLine } = await openTrackerForWritingThenReadNextLine(commandArguments, context, (change) => {
    const tickets      = releasableTickets(change.board, request.references);
    const mainCheckout = change.workspace.rootDirectory;
    requireMainCheckoutOnMainLine(mainCheckout, request.mainLine);
    const branchCommit = branchCommitToRelease(mainCheckout, request.branch, request.mainLine);
    requireTheCheckedTip(change, checkedTip, request.branch, branchCommit);
    requireStampsMatchingTheCheckCommand(change.board, tickets);
    requireEveryAcceptanceItemAccountedFor(tickets);

    const commit   = requireLandedOnTheMainLine(request, mainCheckout, branchCommit);
    const released = change.board.releaseTickets(tickets.map(({ frontmatter }) => frontmatter.id), { branch: request.branch, commit }, change.at);
    return {
      tickets:          released.tickets,
      commit,
      mainCheckout,
      closedReviewRows: released.closedReviewBars,
      logged:           released.logged,
    };
  });
  return { release: result, nextLine };
}
