/**
 * `agent-progress rework` counts the lines of code a reviewer reworked on a branch, the same way for every reviewer, with no threshold
 * built in. It reads the worktree it runs in, or `--worktree`, and never the tracker, whose main checkout's HEAD is not the branch under review.
 */
import { resolve } from 'node:path';

import { OperationRefusal }    from '../../../src/shared/OperationRefusal.ts';
import { PRODUCT_NAMES }       from '../../../src/shared/constants/ProductNames.ts';
import type { CommandHandler } from '../../CommandHandler.ts';
import { DEFAULT_MAIN_LINE }   from '../../constants/GitDefaults.ts';
import { OutputUtil }          from '../../utils/OutputUtil.ts';
import {
  countCommits,
  countMerge,
  countRebase,
  worktreeHeadCommit
} from '../ReworkReading.ts';
import { ReworkCountUtil }                 from '../utils/ReworkCountUtil.ts';
import { fileBreakdownLines, summaryLine } from './ReworkText.ts';

const { partReworkOf } = ReworkCountUtil;

const USAGE = `${PRODUCT_NAMES.PROGRAM} rework`
  + ' [--since <commit>] [--rebased-from <old tip>] [--main <branch>] [--merge <commit>] [--worktree <path>] [--files] [--json]';

const KNOWN_OPTION_NAMES = ['since', 'rebased-from', 'main', 'merge', 'worktree', 'files', 'json'];

export const reworkCommand: CommandHandler = (commandArguments, context) => {
  commandArguments.rejectUnknownOptions(KNOWN_OPTION_NAMES, USAGE);
  commandArguments.rejectExtraPositionals(0, USAGE);

  const since       = commandArguments.option('since');
  const rebasedFrom = commandArguments.option('rebased-from');
  const mainOption  = commandArguments.option('main');
  const merge       = commandArguments.option('merge');
  if (since === undefined && rebasedFrom === undefined && merge === undefined) {
    throw new OperationRefusal(
      'refused',
      'Name what to count: --since <commit> for the commits a review made, --rebased-from <old tip> for what a rebase changed, '
        + `--merge <commit> for what a merge's resolution changed, or several.\n  Usage: ${USAGE}`,
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
  const mergePart         = merge === undefined ? undefined : countMerge(worktreeDirectory, merge);

  const files  = ReworkCountUtil.combineFileReworks([commitsPart?.files ?? [], rebasePart?.files ?? [], mergePart?.files ?? []]);
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
    ...(mergePart === undefined ? {} : {
      merge: {
        mergeCommit:              mergePart.mergeCommit,
        parentCommits:            mergePart.parentCommits,
        automaticMergeConflicted: mergePart.automaticMergeConflicted,
        ...partReworkOf(mergePart.files),
      },
    }),
    files,
  };

  const lines = [summaryLine(totals, commitsPart, rebasePart, mergePart)];
  if (commandArguments.flag('files')) lines.push(...fileBreakdownLines(files, totals));
  OutputUtil.printEntity(commandArguments, context, document, lines.join('\n'));
  return Promise.resolve();
};
