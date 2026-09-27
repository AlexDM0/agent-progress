/**
 * The named verbs enforce the legality matrix of `src/lib/tracker-model/constants/TicketMoveLegality.ts`; `ticket status` is the
 * documented override that skips it.
 */
import { StatusWordingUtil }                      from '../../src/adapters/utils/StatusWordingUtil.ts';
import { TicketBodyUtil }                         from '../../src/adapters/utils/TicketBodyUtil.ts';
import { TicketPhraseUtil }                       from '../../src/adapters/utils/TicketPhraseUtil.ts';
import type { AgentAssignment, ReviewBarStarted } from '../../src/lib/tracker-model/@types/BoardChanges.ts';
import type { LogRecord }                         from '../../src/lib/tracker-model/@types/LogRecord.ts';
import type { Task }                              from '../../src/lib/tracker-model/@types/Task.ts';
import type { Ticket, TicketStatus }              from '../../src/lib/tracker-model/@types/Ticket.ts';
import { VocabularyUtil }                         from '../../src/lib/tracker-model/utils/VocabularyUtil.ts';
import type { TrackerChange }                     from '../../src/services/tracker/TrackerPipeline.ts';
import { OperationRefusal }                       from '../../src/shared/OperationRefusal.ts';
import type { CommandContext }                    from '../CommandContext.ts';
import { openTrackerForWritingThenReadNextLine }  from '../OpenTrackerForWriting.ts';
import type { ArgumentParser }                    from '../arguments/ArgumentParser.ts';
import { RetiredWordRefusalUtil }                 from '../legacy/utils/RetiredWordRefusalUtil.ts';
import { NextLineUtil }                           from '../utils/NextLineUtil.ts';
import { OptionValueUtil }                        from '../utils/OptionValueUtil.ts';
import { OutputUtil }                             from '../utils/OutputUtil.ts';
import type { TicketSubcommandHandler }           from './@types/TicketSubcommandHandler.ts';
import { TICKET_USAGE }                           from './constants/TicketUsage.ts';
import { TicketArgumentUtil }                     from './utils/TicketArgumentUtil.ts';
import { TicketLookupUtil }                       from './utils/TicketLookupUtil.ts';
import { TicketOutputUtil }                       from './utils/TicketOutputUtil.ts';

const TRANSITION_TARGET_STATUSES: Record<string, TicketStatus> = {
  [StatusWordingUtil.verbFor('in-progress')]: 'in-progress',
  [StatusWordingUtil.verbFor('in-review')]:   'in-review',
  [StatusWordingUtil.verbFor('reviewed')]:    'reviewed',
  [StatusWordingUtil.verbFor('delivered')]:   'delivered',
  [StatusWordingUtil.verbFor('abandoned')]:   'abandoned',
  [StatusWordingUtil.verbFor('pending')]:     'pending',
};

const TRANSITION_OPTION_NAMES = ['branch', 'commit', 'reason', 'at', 'tokens', 'json'];
const REVIEW_BAR_OPTION_NAMES = ['start-review', 'owner', 'note'];
const REVIEW_OPTION_NAMES     = [...TRANSITION_OPTION_NAMES, ...REVIEW_BAR_OPTION_NAMES];
const REREVIEW_OPTION_NAMES   = ['at', 'json', ...REVIEW_BAR_OPTION_NAMES];

function reviewBarRequestFrom(commandArguments: ArgumentParser, subcommand: string): AgentAssignment | null {
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
function reviewBarStartedFor(change: TrackerChange, ticket: Readonly<Ticket>, request: AgentAssignment | null): ReviewBarStarted | null {
  if (request === null) return null;
  const round = TicketBodyUtil.nextReviewRoundOf(ticket.body);
  return change.board.startReviewBar(ticket.frontmatter.id, { round, ...request }, change.at);
}

/** A closed bar is printed by its id alone, not as the sentence the log holds for it. */
function recordClosesNoBar(record: LogRecord): boolean {
  return record.kind !== 'review-bar-closed';
}

function idsOf(bars: readonly Readonly<Task>[]): number[] {
  return bars.map((bar) => bar.id);
}

function closedReviewBarsText(closedBars: readonly Readonly<Task>[]): string {
  return closedBars.map((bar) => `\nClosed the review row #${bar.id}, ${StatusWordingUtil.movedPhraseFor('delivered')}`).join('');
}

function reviewBarText(started: ReviewBarStarted | null): string {
  if (started === null) return '';
  return `${closedReviewBarsText(started.closedBars)}\n${OutputUtil.loggedSentencesOf(started.logged.filter(recordClosesNoBar))}`;
}

function ticketWithReviewBarAsJson(ticket: Ticket, started: ReviewBarStarted | null, closedBars: readonly Readonly<Task>[] = []): Record<string, unknown> {
  if (started !== null) return { ...TicketOutputUtil.ticketAsJson(ticket), reviewRow: started.bar, closedReviewRows: idsOf(started.closedBars) };
  if (closedBars.length > 0) return { ...TicketOutputUtil.ticketAsJson(ticket), closedReviewRows: idsOf(closedBars) };
  return TicketOutputUtil.ticketAsJson(ticket);
}

async function transitionOneTicket(
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
  const humanText    = `${OutputUtil.loggedSentencesOf(move.logged.filter(recordClosesNoBar))}${closedReviewBarsText(move.closedReviewBars)}`
    + reviewBarText(startedReviewBar);
  const document     = ticketWithReviewBarAsJson(move.ticket, startedReviewBar, move.closedReviewBars);
  OutputUtil.printEntityThenNextLine(commandArguments, context, document, humanText, closingLines);

  // A warning, not a refusal: the order is advice to whoever picks work up, and the user may know better.
  if (targetStatus === 'in-progress' && moved.unsettled.length > 0) {
    const notSettledYetText = `${moved.unsettled.length === 1 ? 'which is' : 'which are'} not ${StatusWordingUtil.statusWordFor('reviewed')} yet`;
    context.standardError(`Ticket #${id} is ${TicketPhraseUtil.waitingOnText(moved.unsettled)}, ${notSettledYetText}.`);
  }
  if (targetStatus === 'in-progress' && move.ticket.frontmatter.hold !== undefined) {
    context.standardError(`Ticket #${id} is held; it was started anyway, and \`agent-progress ticket unhold ${id}\` lifts the hold.`);
  }
  if (targetStatus === 'in-progress' && moved.holdingBackTicketIds.length > 0) {
    context.standardError(`${TicketPhraseUtil.lowPriorityHeldBackText(id, moved.holdingBackTicketIds)}; it was started anyway.`);
  }
}

function transitionHandlerFor(targetStatus: TicketStatus): TicketSubcommandHandler {
  return async (commandArguments, context, subcommand) => {
    const sendsToReview = targetStatus === 'in-review';
    commandArguments.rejectUnknownOptions(sendsToReview ? REVIEW_OPTION_NAMES : TRANSITION_OPTION_NAMES, TICKET_USAGE);
    commandArguments.rejectExtraPositionals(2, TICKET_USAGE);
    const reference = commandArguments.positionals()[1];
    if (reference === undefined) {
      throw new OperationRefusal('refused', `agent-progress ticket ${subcommand} needs a ticket id.\n  Usage: ${TICKET_USAGE}`);
    }
    const reviewBarRequest = sendsToReview ? reviewBarRequestFrom(commandArguments, subcommand) : null;
    return transitionOneTicket(targetStatus, reference, commandArguments, context, true, reviewBarRequest);
  };
}

async function setTicketStatus(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(TRANSITION_OPTION_NAMES, TICKET_USAGE);
  commandArguments.rejectExtraPositionals(3, TICKET_USAGE);

  const [, reference, writtenStatus] = commandArguments.positionals();
  if (reference === undefined || writtenStatus === undefined) {
    throw new OperationRefusal('refused', `agent-progress ticket status needs a ticket id and a status.\n  Usage: ${TICKET_USAGE}`);
  }
  if (!VocabularyUtil.ticketStatusIsKnown(writtenStatus)) {
    // The seam to the retired words; dropping `cli/legacy/` leaves only the unknown-status refusal below.
    RetiredWordRefusalUtil.refuseARetiredTicketStatus(writtenStatus, (renamedStatus) => `run \`agent-progress ticket status ${reference} ${renamedStatus}\``);
    return TicketArgumentUtil.refuseAnUnknownTicketStatus(writtenStatus);
  }
  return transitionOneTicket(writtenStatus, reference, commandArguments, context, false);
}

/** The one verb that may be run on the status the ticket already has: a further review pass is still review. */
async function rereviewOneTicket(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(REREVIEW_OPTION_NAMES, TICKET_USAGE);
  commandArguments.rejectExtraPositionals(2, TICKET_USAGE);
  const reference = commandArguments.positionals()[1];
  if (reference === undefined) {
    throw new OperationRefusal('refused', `agent-progress ticket rereview needs a ticket id.\n  Usage: ${TICKET_USAGE}`);
  }
  const reviewBarRequest = reviewBarRequestFrom(commandArguments, 'rereview');

  const { result: rereviewed, nextLine } = await openTrackerForWritingThenReadNextLine(commandArguments, context, (change) => {
    const rereview = change.board.rereviewTicket(TicketLookupUtil.requireTicket(change, reference).frontmatter.id, change.at);
    return { rereview, startedReviewBar: reviewBarStartedFor(change, rereview.ticket, reviewBarRequest) };
  });

  const { rereview, startedReviewBar } = rereviewed;
  const humanText                      = `${OutputUtil.loggedSentencesOf(rereview.logged)}${reviewBarText(startedReviewBar)}`;
  OutputUtil.printEntityThenNextLine(commandArguments, context, ticketWithReviewBarAsJson(rereview.ticket, startedReviewBar), humanText, nextLine);
}

const TRANSITION_HANDLERS: Record<string, TicketSubcommandHandler> = Object.fromEntries(
  Object.entries(TRANSITION_TARGET_STATUSES).map(([verb, targetStatus]) => [verb, transitionHandlerFor(targetStatus)]),
);

export const TICKET_MOVE_SUBCOMMANDS: Readonly<Record<string, TicketSubcommandHandler>> = {
  ...TRANSITION_HANDLERS,
  status:   setTicketStatus,
  rereview: rereviewOneTicket,
};
