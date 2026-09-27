/**
 * `agent-progress release`: fast-forward the main checkout to a reviewed branch and deliver its ticket, then clean up; with `--json` a
 * refusal prints its reason too.
 */
import { LogUtil }                                          from '../../../src/adapters/utils/LogUtil.ts';
import { OperationRefusalWordingUtil }                      from '../../../src/adapters/utils/OperationRefusalWordingUtil.ts';
import { TicketPhraseUtil }                                 from '../../../src/adapters/utils/TicketPhraseUtil.ts';
import type { ReleaseRefusalReason }                        from '../../../src/shared/@types/ReleaseRefusalReason.ts';
import { refusalIsOperationRefusal, type OperationRefusal } from '../../../src/shared/OperationRefusal.ts';
import type { CommandHandler }                              from '../../CommandHandler.ts';
import { requireCurrentInstall }                            from '../../InstallVersionCheck.ts';
import { OutputUtil }                                       from '../../utils/OutputUtil.ts';
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
  try {
    requireCurrentInstall(context.currentDirectory);
    request = releaseRequestFrom(commandArguments, context);
    ({ release, nextLine } = await releaseUnderTheLock(request, commandArguments, context));
  } catch (error) {
    if (refusalIsOperationRefusal(error) && commandArguments.flag('json')) {
      const refusalDocument = {
        released: false,
        reason:   reasonOfRefusal(error),
        detail:   OperationRefusalWordingUtil.messageOf(error),
        cleanup:  [],
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
  const reviewLines  = logged.filter((record) => record.kind === 'review-bar-closed').map(LogUtil.sentenceOf);
  const document     = {
    released:         true,
    tickets:          ticketIds,
    branch:           request.branch,
    mainLine:         request.mainLine,
    commit,
    closedReviewRows: closedReviewRows.map(({ id }) => id),
    cleanup,
  };
  OutputUtil.printEntityThenNextLine(commandArguments, context, document, [headline, ...reviewLines, ...cleanup.map(cleanupLine)].join('\n'), nextLine);
};
