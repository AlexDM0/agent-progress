/**
 * Before the lock: the tracker must store a check command, the branch's worktree must stand exactly at the branch's tip with nothing beside
 * it, and the command runs there, outside the lock so other releases do not wait on it. What it hands on is what the lock must find again.
 */
import { readWorktreeCheckout, type FilesLeftInWorktree } from '../../../src/lib/git/BranchIntegration.ts';
import { readingBoardOf }                                 from '../../../src/lib/tracker-model/ReadingBoard.ts';
import { requireProgressFile, requireTracker }            from '../../../src/services/tracker/TrackerReader.ts';
import { requireWorkspace }                               from '../../../src/services/tracker/Workspace.ts';
import { PRODUCT_NAMES }                                  from '../../../src/shared/constants/ProductNames.ts';
import type { CommandContext }                            from '../../CommandContext.ts';
import type { ArgumentParser }                            from '../../arguments/ArgumentParser.ts';
import { OutputUtil }                                     from '../../utils/OutputUtil.ts';
import {
  CHECK_OUTPUT_TAIL_LINES,
  checkRunOutcomeText,
  checkRunPassed,
  lastLinesOf,
  runCheckCommand
} from '../CheckCommandRun.ts';
import {
  branchCommitToRelease,
  releasableTickets,
  requireEveryAcceptanceItemAccountedFor,
  requireMainCheckoutOnMainLine,
  requireStampsMatchingTheCheckCommand
} from './ReleaseReadings.ts';
import { ReleaseRefusal, refuseTheRelease } from './ReleaseRefusal.ts';
import type { ReleaseRequest }              from './ReleaseRequest.ts';

export interface CheckedTip {
  commit:       string;
  checkCommand: string;
}

function filesText({ untrackedFiles, changedFiles }: FilesLeftInWorktree): string {
  return [
    ...(untrackedFiles.length === 0 ? [] : [`untracked: ${untrackedFiles.join(', ')}`]),
    ...(changedFiles.length === 0 ? [] : [`changed: ${changedFiles.join(', ')}`]),
  ].join('; ');
}

function readCheckout(worktreePath: string): { headCommit: string; filesBeside: FilesLeftInWorktree } {
  const reading = readWorktreeCheckout(worktreePath);
  if (reading.verdict === 'not-a-directory') refuseTheRelease('invalid-request', `--worktree ${worktreePath} is not a directory.`);
  if (reading.verdict === 'git-failed') throw new ReleaseRefusal('unrepaired', 'git-failed', `The worktree ${worktreePath} could not be read: ${reading.reason}`);
  return reading;
}

function requireCheckoutAtTheTip(request: ReleaseRequest, worktreePath: string, tip: string): void {
  const { headCommit, filesBeside } = readCheckout(worktreePath);
  if (headCommit !== tip) {
    refuseTheRelease(
      'worktree-not-at-tip',
      `The worktree ${worktreePath} is at ${OutputUtil.shortCommitOf(headCommit)}, not at the tip of ${request.branch} (${OutputUtil.shortCommitOf(tip)}): `
      + 'the checks run on the commit the release fast-forwards to, so check that commit out there and release again.',
    );
  }
  if (filesBeside.untrackedFiles.length > 0 || filesBeside.changedFiles.length > 0) {
    refuseTheRelease(
      'worktree-dirty',
      `The worktree ${worktreePath} holds files its commit does not (${filesText(filesBeside)}), and the checks would judge them too: `
      + 'commit or remove them and release again.',
    );
  }
}

/** Files a check run leaves untracked are its output; a moved HEAD or a changed tracked file means what passed is not the commit. */
function requireCheckoutUnchangedByTheChecks(worktreePath: string, tip: string): void {
  const { headCommit, filesBeside } = readCheckout(worktreePath);
  if (headCommit !== tip) {
    refuseTheRelease('worktree-not-at-tip', `The checks moved the worktree ${worktreePath} from ${OutputUtil.shortCommitOf(tip)} to ${OutputUtil.shortCommitOf(headCommit)}.`);
  }
  if (filesBeside.changedFiles.length > 0) {
    refuseTheRelease(
      'worktree-dirty',
      `The checks changed tracked files in ${worktreePath} (${filesBeside.changedFiles.join(', ')}), so what passed is not the commit: `
      + 'make the check command leave tracked files alone, or commit what it changes, and release again.',
    );
  }
}

/** A tracker that stores no check command is refused: a merge never lands ungated. */
export async function checkTheBranchTip(request: ReleaseRequest, commandArguments: ArgumentParser, context: CommandContext): Promise<CheckedTip> {
  const workspace = requireWorkspace(context.currentDirectory);
  // Everything here is read again under the lock, which refuses a check command, a stamp or a tip that changed meanwhile.
  const checkCommand = readingBoardOf(requireProgressFile(workspace), [], []).checkCommand();
  if (checkCommand === undefined) {
    refuseTheRelease(
      'checks-not-set',
      `This tracker stores no check command, and a release never lands a branch ungated: set one with \`${PRODUCT_NAMES.PROGRAM} checks "<command>"\` `
      + `(\`${PRODUCT_NAMES.PROGRAM} checks "<command>" --restamp\` when tickets are in flight) and release again.`,
    );
  }
  const { progress, listing, epicListing } = requireTracker(workspace);
  const board                              = readingBoardOf(progress, listing.tickets, epicListing.epics);
  const tickets                            = releasableTickets(board, request.references);
  requireStampsMatchingTheCheckCommand(board, tickets);
  requireEveryAcceptanceItemAccountedFor(tickets);
  const mainCheckout = workspace.rootDirectory;
  requireMainCheckoutOnMainLine(mainCheckout, request.mainLine);
  const tip = branchCommitToRelease(mainCheckout, request.branch, request.mainLine);
  const { worktreePath } = request;
  if (worktreePath === undefined) {
    refuseTheRelease('invalid-request', 'This tracker stores a check command, which a release runs in the branch\'s worktree: name it with --worktree <path>.');
  }
  requireCheckoutAtTheTip(request, worktreePath, tip);

  if (!commandArguments.flag('json')) context.standardError(`Running the checks on ${request.branch} (${OutputUtil.shortCommitOf(tip)}) in ${worktreePath}: ${checkCommand}`);
  const checkRun = await runCheckCommand(checkCommand, worktreePath);
  if (!checkRunPassed(checkRun)) {
    throw new ReleaseRefusal(
      'refused',
      'checks-failed',
      `The check command \`${checkCommand}\` ${checkRunOutcomeText(checkRun)} on ${request.branch} (${OutputUtil.shortCommitOf(tip)}) in ${worktreePath}: `
      + `fix what it reports, commit, and release again. Nothing was changed. Its last ${CHECK_OUTPUT_TAIL_LINES} lines:\n${lastLinesOf(checkRun.output)}`,
    );
  }
  requireCheckoutUnchangedByTheChecks(worktreePath, tip);
  return { commit: tip, checkCommand };
}
