/** Moves one ticket to a status, prints the move and any review bar it opened, and warns when a start ignores the dispatch order. */
import { TicketPhraseUtil }                      from '../../src/adapters/utils/TicketPhraseUtil.ts';
import type { AgentAssignment }                  from '../../src/lib/tracker-model/@types/BoardChanges.ts';
import type { TicketStatus }                     from '../../src/lib/tracker-model/@types/Ticket.ts';
import type { CommandContext }                   from '../CommandContext.ts';
import { openTrackerForWritingThenReadNextLine } from '../OpenTrackerForWriting.ts';
import type { ArgumentParser }                   from '../arguments/ArgumentParser.ts';
import { NextLineUtil }                          from '../utils/NextLineUtil.ts';
import { OptionValueUtil }                       from '../utils/OptionValueUtil.ts';
import { OutputUtil }                            from '../utils/OutputUtil.ts';
import { reviewBarStartedFor }                   from './ReviewBarRequest.ts';
import { ReviewBarOutputUtil }                   from './utils/ReviewBarOutputUtil.ts';
import { TicketLookupUtil }                      from './utils/TicketLookupUtil.ts';

export const TRANSITION_OPTION_NAMES = ['branch', 'commit', 'reason', 'at', 'tokens', 'json'];

export async function transitionOneTicket(
  targetStatus: TicketStatus,
  reference: string,
  commandArguments: ArgumentParser,
  context: CommandContext,
  checksLegality: boolean,
  reviewBarRequest: AgentAssignment | null = null,
): Promise<void> {
  const branch = commandArguments.option('branch');
  const commit = commandArguments.option('commit');
  const reason = commandArguments.option('reason');
  const tokens = OptionValueUtil.tokenCountFrom(commandArguments);

  const { result: moved, nextLine, dispatcherState } = await openTrackerForWritingThenReadNextLine(commandArguments, context, (change) => {
    const { board }  = change;
    const ticketId   = TicketLookupUtil.requireTicket(change, reference).frontmatter.id;
    const move       = board.moveTicket(ticketId, targetStatus, {
      checksLegality,
      ...(branch === undefined ? {} : { branch }),
      ...(commit === undefined ? {} : { commit }),
      ...(reason === undefined ? {} : { reason }),
      ...(tokens === undefined ? {} : { tokens }),
    }, change.at);
    return {
      move,
      startedReviewBar:     reviewBarStartedFor(change, move.ticket, reviewBarRequest),
      unsettled:            board.unsettledDependenciesOf(ticketId),
      holdingBackTicketIds: board.ticketIdsHoldingBack(ticketId),
    };
  });

  const { move, startedReviewBar } = moved;
  const { id }                     = move.ticket.frontmatter;
  // A reopened ticket goes back into the queue a running dispatcher takes from, so it is intake like `ticket add`.
  const closingLines = targetStatus === 'pending' ? NextLineUtil.endWithRunningDispatcherNotice(nextLine, dispatcherState) : nextLine;
  const humanText    = `${OutputUtil.loggedSentencesOf(move.logged.filter(ReviewBarOutputUtil.recordClosesNoBar))}`
    + `${ReviewBarOutputUtil.closedReviewBarsText(move.closedReviewBars)}${ReviewBarOutputUtil.reviewBarText(startedReviewBar)}`;
  const document     = ReviewBarOutputUtil.ticketWithReviewBarAsJson(move.ticket, startedReviewBar, move.closedReviewBars);
  OutputUtil.printEntityThenNextLine(commandArguments, context, document, humanText, closingLines);

  // A warning, not a refusal: the order is advice to whoever picks work up, and the user may know better.
  if (targetStatus !== 'in-progress') return;
  if (moved.unsettled.length > 0) {
    const notSettledYetText = `${moved.unsettled.length === 1 ? 'which is' : 'which are'} not reviewed yet`;
    context.standardError(`Ticket #${id} is ${TicketPhraseUtil.waitingOnText(moved.unsettled)}, ${notSettledYetText}.`);
  }
  if (move.ticket.frontmatter.hold !== undefined) {
    context.standardError(`Ticket #${id} is held; it was started anyway, and \`agent-progress ticket unhold ${id}\` lifts the hold.`);
  }
  if (moved.holdingBackTicketIds.length > 0) {
    context.standardError(`${TicketPhraseUtil.lowPriorityHeldBackText(id, moved.holdingBackTicketIds)}; it was started anyway.`);
  }
}
