/** The review bar `ticket finish --start-review` and `ticket rereview` open for the ticket's next reviewer. */
import { TicketBodyUtil }                         from '../../src/adapters/utils/TicketBodyUtil.ts';
import type { AgentAssignment, ReviewBarStarted } from '../../src/lib/tracker-model/@types/BoardChanges.ts';
import type { Ticket }                            from '../../src/lib/tracker-model/@types/Ticket.ts';
import type { TrackerChange }                     from '../../src/services/tracker/TrackerPipeline.ts';
import { OperationRefusal }                       from '../../src/shared/OperationRefusal.ts';
import type { ArgumentParser }                    from '../arguments/ArgumentParser.ts';
import { TICKET_USAGE }                           from './constants/TicketUsage.ts';

export const REVIEW_BAR_OPTION_NAMES = ['start-review', 'owner', 'note'];

export function reviewBarRequestFrom(commandArguments: ArgumentParser, subcommand: string): AgentAssignment | null {
  const owner = commandArguments.option('owner');
  const note  = commandArguments.option('note');
  if (!commandArguments.flag('start-review')) {
    if (owner !== undefined || note !== undefined) {
      throw new OperationRefusal(
        'refused',
        `--owner and --note name the review bar, so \`agent-progress ticket ${subcommand}\` takes them only with --start-review.\n  Usage: ${TICKET_USAGE}`,
      );
    }
    return null;
  }
  return {
    ...(owner === undefined ? {} : { owner }),
    ...(note === undefined ? {} : { note }),
  };
}

/**
 * A builder's `ticket finish` hands the ticket's slot to its reviewer, a reviewer's `rereview` to the next. The round is the one a reviewer
 * states for itself: the `## Review` sections already in the ticket, plus one.
 */
export function reviewBarStartedFor(change: TrackerChange, ticket: Readonly<Ticket>, request: AgentAssignment | null): ReviewBarStarted | null {
  if (request === null) return null;
  const round = TicketBodyUtil.nextReviewRoundOf(ticket.body);
  return change.board.startReviewBar(ticket.frontmatter.id, { round, ...request }, change.at);
}
