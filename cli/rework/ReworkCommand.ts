/**
 * `agent-progress rework`: how many lines of code a reviewing agent reworked on a branch, counted the same way
 * for every reviewer so that a threshold on it gives one verdict. It only counts; no threshold is built in.
 *
 * It reads the worktree it runs in, or `--worktree`, and never the tracker: the tracker is shared by every
 * worktree and resolves to the main checkout, whose HEAD is not the branch under review. It takes no lock,
 * writes nothing and needs no tracker at all.
 */
import { resolve } from 'node:path';

import { OperationRefusal }                                   from '../../lib/platform/OperationRefusal';
import { readCommitsDiff, readRebaseDiffs, readWorktreeHead } from '../../lib/platform/ReworkDiffs';
import type { FileRework, ReworkTotals }                      from '../../lib/utils/ReworkCountUtil';
import { ReworkCountUtil }                                    from '../../lib/utils/ReworkCountUtil';
import { printEntity }                                        from '../CommandSupport';
import type { CommandHandler }                                from '../CommandTable';

const USAGE = 'agent-progress rework [--since <commit>] [--rebased-from <old tip>] [--main <branch>] [--worktree <path>] [--files] [--json]';

const KNOWN_OPTION_NAMES = ['since', 'rebased-from', 'main', 'worktree', 'files', 'json'];

const DEFAULT_MAIN_LINE = 'main';

const SHORT_COMMIT_LENGTH = 8;

interface CommitsPart {
  sinceCommit: string;
  commitCount: number;
  files:       FileRework[];
}

interface RebasePart {
  oldTipCommit:     string;
  rebasedTipCommit: string;
  mainLine:         string;
  oldBaseCommit:    string;
  newBaseCommit:    string;
  files:            FileRework[];
}

function shortCommit(commit: string): string {
  return commit.slice(0, SHORT_COMMIT_LENGTH);
}

function countCommits(worktreeDirectory: string, since: string): CommitsPart {
  const reading = readCommitsDiff(worktreeDirectory, since);
  switch (reading.verdict) {
    case 'unknown-commit':
      throw new OperationRefusal('refused', `--since "${since}" does not name a commit in ${worktreeDirectory}.`);
    case 'not-an-ancestor':
      throw new OperationRefusal(
        'refused',
        `--since ${shortCommit(reading.sinceCommit)} is not an ancestor of HEAD in ${worktreeDirectory}, so there is no line of commits since it to count. `
          + 'A rebase rewrites the commits after it: count --since before rebasing, and the rebase itself with --rebased-from ORIG_HEAD after.',
      );
    case 'merge-found':
      throw new OperationRefusal(
        'refused',
        `The commits since ${shortCommit(since)} include the ${reading.mergeCommits.length === 1 ? 'merge' : 'merges'} ${reading.mergeCommits.map(shortCommit).join(', ')}. `
          + 'Work is rebased onto the main line rather than merged with it, and a merge would bring the main line\'s own commits into the count: '
          + 'rebase the branch, or name a --since after the merge.',
      );
    case 'git-failed':
      throw new OperationRefusal('unrepaired', reading.reason);
    case 'read':
      break;
  }
  const { combineFileReworks, readDiff, reworkOfFile } = ReworkCountUtil;
  return {
    sinceCommit: reading.sinceCommit,
    commitCount: reading.commits.length,
    files:       combineFileReworks([readDiff(reading.diffText).map(reworkOfFile)]),
  };
}

/** With --since as well, the rebase is measured up to the review's start: the commits after it are the review's, and are counted there once. */
function countRebase(worktreeDirectory: string, oldTip: string, mainLine: string, rebasedTipCommit: string): RebasePart {
  const reading = readRebaseDiffs(worktreeDirectory, oldTip, mainLine, rebasedTipCommit);
  switch (reading.verdict) {
    case 'unknown-commit':
      throw new OperationRefusal(
        'refused',
        reading.role === 'old-tip'
          ? `--rebased-from "${oldTip}" does not name a commit in ${worktreeDirectory}.`
          : `--main "${mainLine}" does not name a commit in ${worktreeDirectory}: name the branch the work was rebased onto with --main.`,
      );
    case 'no-common-base':
      throw new OperationRefusal(
        'refused',
        `${reading.role === 'old-tip' ? `--rebased-from "${oldTip}"` : shortCommit(rebasedTipCommit)} shares no history with --main "${mainLine}", `
          + 'so there is no patch of the branch\'s own to compare.',
      );
    case 'git-failed':
      throw new OperationRefusal('unrepaired', reading.reason);
    case 'read':
      break;
  }
  const {
    addedLinesInOnlyOne,
    combineFileReworks,
    readDiff,
    reworkOfFile,
  } = ReworkCountUtil;
  const changedByTheRebase = addedLinesInOnlyOne(readDiff(reading.beforeDiffText), readDiff(reading.afterDiffText));
  return {
    oldTipCommit:  reading.oldTipCommit,
    rebasedTipCommit,
    mainLine,
    oldBaseCommit: reading.oldBaseCommit,
    newBaseCommit: reading.newBaseCommit,
    files:         combineFileReworks([changedByTheRebase.map(reworkOfFile)]),
  };
}

function worktreeHeadCommit(worktreeDirectory: string): string {
  const reading = readWorktreeHead(worktreeDirectory);
  switch (reading.verdict) {
    case 'not-a-repository':
      throw new OperationRefusal('refused', `${worktreeDirectory} is not inside a git working tree. Run this in the worktree under review, or name it with --worktree.`);
    case 'no-commits':
      throw new OperationRefusal('refused', `${worktreeDirectory} has no commits yet, so nothing has been reworked.`);
    case 'git-unavailable':
      throw new OperationRefusal('unrepaired', 'git could not be started, and rework is counted from git\'s history.');
    case 'read':
      return reading.headCommit;
  }
}

interface CountedScope {
  scope:  string;
  totals: ReworkTotals;
}

function commitsScope(part: CommitsPart): CountedScope {
  const commitWord = part.commitCount === 1 ? 'commit' : 'commits';
  return { scope: `in ${part.commitCount} ${commitWord} since ${shortCommit(part.sinceCommit)}`, totals: ReworkCountUtil.totalReworkOf(part.files) };
}

function rebaseScope(part: RebasePart): CountedScope {
  return { scope: `in the rebase from ${shortCommit(part.oldTipCommit)} onto ${part.mainLine}`, totals: ReworkCountUtil.totalReworkOf(part.files) };
}

function addedAndRemovedOf(totals: ReworkTotals): string {
  return `${totals.addedCodeLines} added, ${totals.removedCodeLines} removed`;
}

function linesOfCode(count: number): string {
  return `${count} ${count === 1 ? 'line' : 'lines'} of code`;
}

/** One scope reads as one sentence; two name each part's share of the total. */
function summaryLine(totals: ReworkTotals, scopes: readonly CountedScope[]): string {
  const [onlyScope] = scopes;
  if (scopes.length === 1 && onlyScope !== undefined) {
    return `Reworked ${linesOfCode(totals.reworkedCodeLines)} ${onlyScope.scope}: ${addedAndRemovedOf(totals)}.`;
  }
  const parts = scopes.map(({ scope, totals: partTotals }) => `${partTotals.reworkedCodeLines} ${scope} (${addedAndRemovedOf(partTotals)})`);
  return `Reworked ${linesOfCode(totals.reworkedCodeLines)}: ${parts.join(' and ')}.`;
}

/** Only the files with code in them are listed; what was left out is summed on the line after them. */
function fileBreakdownLines(files: readonly FileRework[], totals: ReworkTotals): string[] {
  const filesWithCode = files.filter((file) => file.addedCodeLines + file.removedCodeLines > 0);
  const columnWidth   = Math.max(...filesWithCode.map((file) => Math.max(String(file.addedCodeLines).length, String(file.removedCodeLines).length)), 1) + 1;
  const lines         = filesWithCode.map((file) => `  ${`+${file.addedCodeLines}`.padStart(columnWidth)} ${`-${file.removedCodeLines}`.padStart(columnWidth)}  ${file.path}`);
  lines.push(`Not counted: ${totals.commentLines} comment, ${totals.blankLines} blank and ${totals.documentationLines} documentation lines.`);
  return lines;
}

function partReworkOf(files: readonly FileRework[]): Pick<ReworkTotals, 'reworkedCodeLines' | 'addedCodeLines' | 'removedCodeLines'> {
  const { addedCodeLines, removedCodeLines, reworkedCodeLines } = ReworkCountUtil.totalReworkOf(files);
  return { reworkedCodeLines, addedCodeLines, removedCodeLines };
}

export const reworkCommand: CommandHandler = (commandArguments, context) => {
  commandArguments.rejectUnknownOptions(KNOWN_OPTION_NAMES, USAGE);
  commandArguments.rejectExtraPositionals(0, USAGE);

  const since       = commandArguments.option('since');
  const rebasedFrom = commandArguments.option('rebased-from');
  const mainOption  = commandArguments.option('main');
  if (since === undefined && rebasedFrom === undefined) {
    throw new OperationRefusal(
      'refused',
      `Name what to count: --since <commit> for the commits a review made, --rebased-from <old tip> for what a rebase changed, or both.\n  Usage: ${USAGE}`,
    );
  }
  if (mainOption !== undefined && rebasedFrom === undefined) {
    throw new OperationRefusal('refused', `--main names the branch a rebase went onto, and only applies with --rebased-from.\n  Usage: ${USAGE}`);
  }

  const worktreeDirectory = resolve(context.currentDirectory, commandArguments.option('worktree') ?? '.');
  const headCommit        = worktreeHeadCommit(worktreeDirectory);
  const commitsPart       = since === undefined ? undefined : countCommits(worktreeDirectory, since);
  const rebasedTipCommit  = commitsPart?.sinceCommit ?? headCommit;
  const rebasePart        = rebasedFrom === undefined ? undefined : countRebase(worktreeDirectory, rebasedFrom, mainOption ?? DEFAULT_MAIN_LINE, rebasedTipCommit);

  const files  = ReworkCountUtil.combineFileReworks([commitsPart?.files ?? [], rebasePart?.files ?? []]);
  const totals = ReworkCountUtil.totalReworkOf(files);

  const document = {
    worktree:          worktreeDirectory,
    headCommit,
    reworkedCodeLines: totals.reworkedCodeLines,
    addedCodeLines:    totals.addedCodeLines,
    removedCodeLines:  totals.removedCodeLines,
    notCounted:        { commentLines: totals.commentLines, blankLines: totals.blankLines, documentationLines: totals.documentationLines },
    ...(commitsPart === undefined ? {} : {
      since: {
        commit:      commitsPart.sinceCommit,
        commitCount: commitsPart.commitCount,
        ...partReworkOf(commitsPart.files),
      },
    }),
    ...(rebasePart === undefined ? {} : {
      rebasedFrom: {
        oldTipCommit:     rebasePart.oldTipCommit,
        rebasedTipCommit: rebasePart.rebasedTipCommit,
        mainLine:         rebasePart.mainLine,
        oldBaseCommit:    rebasePart.oldBaseCommit,
        newBaseCommit:    rebasePart.newBaseCommit,
        ...partReworkOf(rebasePart.files),
      },
    }),
    files,
  };

  const scopes = [
    ...(commitsPart === undefined ? [] : [commitsScope(commitsPart)]),
    ...(rebasePart === undefined ? [] : [rebaseScope(rebasePart)]),
  ];
  const lines = [summaryLine(totals, scopes)];
  if (commandArguments.flag('files')) lines.push(...fileBreakdownLines(files, totals));
  printEntity(commandArguments, context, document, lines.join('\n'));
  return Promise.resolve();
};
