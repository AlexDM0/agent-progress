/**
 * `agent-progress review record` stores one review pass as a `review-recorded` log record on the ticket's in-progress review bar: the
 * reviewer's findings file, the rework counted here rather than added by the reviewer, and the builder's change size, which is lost once
 * the branch is released.
 */
import { resolve } from 'node:path';

import { OperationRefusal }      from '../../../src/shared/OperationRefusal.ts';
import type { CommandHandler }   from '../../CommandHandler.ts';
import { openTrackerForWriting } from '../../OpenTrackerForWriting.ts';
import { DEFAULT_MAIN_LINE }     from '../../constants/GitDefaults.ts';
import { TicketLookupUtil }      from '../../tickets/utils/TicketLookupUtil.ts';
import { OutputUtil }            from '../../utils/OutputUtil.ts';
import { readFindingsFile }      from './FindingsFileReading.ts';
import { measureReviewPass }     from './ReviewPassMeasurement.ts';
import type { RebaseRequest }    from './ReviewPassMeasurement.ts';
import { recordedLine }          from './ReviewRecordText.ts';

const USAGE = 'agent-progress review record <id> --worktree <path> --since <review start> --findings-file <path|-> '
  + '[--rebased-from <pre-rebase tip> ...] [--main <main line> ...] [--json]';

const RECORD_SUBCOMMAND = 'record';

const KNOWN_OPTION_NAMES = ['worktree', 'since', 'findings-file', 'rebased-from', 'main', 'json'];

function requiredOption(value: string | undefined, name: string): string {
  if (value === undefined || value.trim() === '') throw new OperationRefusal('refused', `agent-progress review record needs --${name}.\n  Usage: ${USAGE}`);
  return value;
}

/** One `--main` names the main line of every rebase; otherwise each `--rebased-from` takes the `--main` given in the same place. */
function rebaseRequestsOf(oldTips: readonly string[], mainLines: readonly string[]): RebaseRequest[] {
  if (mainLines.length > 1 && mainLines.length !== oldTips.length) {
    throw new OperationRefusal(
      'refused',
      `agent-progress review record takes one --main for every rebase, or one --main per --rebased-from; it was given ${mainLines.length} --main for `
        + `${oldTips.length} --rebased-from.\n  Usage: ${USAGE}`,
    );
  }
  return oldTips.map((oldTip, i) => ({ oldTip, mainLine: mainLines[mainLines.length === 1 ? 0 : i] ?? DEFAULT_MAIN_LINE }));
}

export const reviewCommand: CommandHandler = async (commandArguments, context) => {
  commandArguments.rejectUnknownOptions(KNOWN_OPTION_NAMES, USAGE);
  const [subcommand, ticketReference] = commandArguments.positionals();
  if (subcommand !== RECORD_SUBCOMMAND) {
    const named = subcommand === undefined ? 'no subcommand' : `"${subcommand}"`;
    throw new OperationRefusal('refused', `agent-progress review takes the subcommand record and was given ${named}.\n  Usage: ${USAGE}`);
  }
  if (ticketReference === undefined) throw new OperationRefusal('refused', `agent-progress review record needs the ticket id.\n  Usage: ${USAGE}`);
  commandArguments.rejectExtraPositionals(2, USAGE);

  const worktreeDirectory = resolve(context.currentDirectory, requiredOption(commandArguments.option('worktree'), 'worktree'));
  const reviewStart       = requiredOption(commandArguments.option('since'), 'since');
  const findingsFile      = requiredOption(commandArguments.option('findings-file'), 'findings-file');
  const mainLines         = commandArguments.optionValues('main');
  const rebases           = rebaseRequestsOf(commandArguments.optionValues('rebased-from'), mainLines);

  // Read and counted before the lock: `--findings-file -` waits on a pipe, and git may take a while.
  const reviewFindings = await readFindingsFile(findingsFile, context);
  const measured       = measureReviewPass({
    worktreeDirectory, reviewStart, rebases, builderMainLine: mainLines[0] ?? DEFAULT_MAIN_LINE,
  });

  const recorded = await openTrackerForWriting(commandArguments, context, (change) => {
    const ticketId = TicketLookupUtil.requireTicket(change, ticketReference).frontmatter.id;
    const review   = change.board.recordReview(ticketId, {
      verdict:                 reviewFindings.verdict,
      reviewStartCommit:       measured.reviewStartCommit,
      fixReworkedCodeLines:    measured.fixReworkedCodeLines,
      rebaseReworkedCodeLines: measured.rebaseReworkedCodeLines,
      totalReworkedCodeLines:  measured.totalReworkedCodeLines,
      builderChangedFiles:     measured.builderChange.changedFiles,
      builderInsertions:       measured.builderChange.insertions,
      builderDeletions:        measured.builderChange.deletions,
      claims:                  reviewFindings.claims,
      findings:                reviewFindings.findings,
    }, change.at);
    return { ticketId, taskId: review.taskId, round: review.round };
  });

  const document = {
    ticketId:                recorded.ticketId,
    taskId:                  recorded.taskId,
    round:                   recorded.round,
    verdict:                 reviewFindings.verdict,
    headCommit:              measured.headCommit,
    reviewStartCommit:       measured.reviewStartCommit,
    reworkedLines:           measured.totalReworkedCodeLines,
    fixReworkedCodeLines:    measured.fixReworkedCodeLines,
    rebaseReworkedCodeLines: measured.rebaseReworkedCodeLines,
    builderChange:           measured.builderChange,
    claimCount:              reviewFindings.claims.length,
    findingCount:            reviewFindings.findings.length,
  };
  OutputUtil.printEntity(commandArguments, context, document, recordedLine(document));
};
