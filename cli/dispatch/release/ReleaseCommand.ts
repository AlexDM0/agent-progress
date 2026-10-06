/**
 * `agent-progress release`: run the tracker's check command on a reviewed branch's tip, fast-forward the main checkout to it and deliver its
 * ticket, then clean up; with `--json` a refusal prints its reason too.
 */
import { LogUtil }                                          from '../../../src/adapters/utils/LogUtil.ts';
import { OperationRefusalWordingUtil }                      from '../../../src/adapters/utils/OperationRefusalWordingUtil.ts';
import { TicketPhraseUtil }                                 from '../../../src/adapters/utils/TicketPhraseUtil.ts';
import type { ReleaseRefusalReason }                        from '../../../src/shared/@types/ReleaseRefusalReason.ts';
import { refusalIsOperationRefusal, type OperationRefusal } from '../../../src/shared/OperationRefusal.ts';
import type { CommandHandler }                              from '../../CommandHandler.ts';
import { requireCurrentInstall }                            from '../../InstallVersionCheck.ts';
import { OutputUtil }                                       from '../../utils/OutputUtil.ts';
import { checkTheBranchTip, type CheckedTip }               from './ReleaseChecks.ts';
import { cleanUpAfterRelease, cleanupLine }                 from './ReleaseCleanup.ts';
import { ReleaseRefusal }                                   from './ReleaseRefusal.ts';
import { releaseRequestFrom, type ReleaseRequest }          from './ReleaseRequest.ts';
import { releaseUnderTheLock, type Release }                from './ReleaseUnderTheLock.ts';

function reasonOfRefusal(refusal: OperationRefusal): ReleaseRefusalReason {
  if (refusal instanceof ReleaseRefusal) return refusal.reason;
  return refusal.status === 'refused' ? 'invalid-request' : 'tracker-failed';
}

export const releaseCommand: CommandHandler = async (commandArguments, context) => {
  let release: Release;
  let nextLine: string;
  let request: ReleaseRequest;
  let checkedTip: CheckedTip | null;
  try {
    requireCurrentInstall(context.currentDirectory);
    request    = releaseRequestFrom(commandArguments, context);
    checkedTip = await checkTheBranchTip(request, commandArguments, context);
    ({ release, nextLine } = await releaseUnderTheLock(request, checkedTip, commandArguments, context));
  } catch (error) {
    if (refusalIsOperationRefusal(error) && commandArguments.flag('json')) {
      const refusalDocument = {
        released:      false,
        reason:        reasonOfRefusal(error),
        detail:        OperationRefusalWordingUtil.messageOf(error),
        blockingFiles: error instanceof ReleaseRefusal ? error.blockingFiles : [],
        cleanup:       [],
      };
      OutputUtil.printEntity(commandArguments, context, refusalDocument, '');
    }
    throw error;
  }

  const {
    mainCheckout,
    tickets,
    commit,
    closedReviewRows,
    logged,
  } = release;
  const cleanup = cleanUpAfterRelease(request, mainCheckout);

  const ticketIds    = tickets.map(({ frontmatter }) => frontmatter.id);
  const ticketsNamed = ticketIds.length === 1 ? `ticket #${ticketIds.join('')}` : `tickets ${TicketPhraseUtil.ticketReferencesText(ticketIds)}`;
  const headline     = `Released ${ticketsNamed}: ${request.mainLine} fast-forwarded to ${OutputUtil.shortCommitOf(commit)} from ${request.branch}, and delivered.`;
  const checksLines  = checkedTip === null ? [] : [`The check command passed on it first: ${checkedTip.checkCommand}`];
  const reviewLines  = logged.filter((record) => record.kind === 'review-bar-closed').map(LogUtil.sentenceOf);
  const document     = {
    released:         true,
    tickets:          ticketIds,
    branch:           request.branch,
    mainLine:         request.mainLine,
    commit,
    checkCommand:     checkedTip?.checkCommand ?? null,
    closedReviewRows: closedReviewRows.map(({ id }) => id),
    cleanup,
  };
  OutputUtil.printEntityThenNextLine(commandArguments, context, document, [headline, ...checksLines, ...reviewLines, ...cleanup.map(cleanupLine)].join('\n'), nextLine);
};
