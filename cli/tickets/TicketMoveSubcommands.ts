/**
 * The named verbs enforce the legality matrix of `src/lib/tracker-model/constants/TicketMoveLegality.ts`; `ticket status` is the
 * documented override that skips it.
 */
import { TicketJsonUtil }                                                     from '../../src/adapters/utils/TicketJsonUtil.ts';
import type { TicketStatus }                                                  from '../../src/lib/tracker-model/@types/Ticket.ts';
import { VocabularyUtil }                                                     from '../../src/lib/tracker-model/utils/VocabularyUtil.ts';
import { ControlService }                                                     from '../../src/services/control/ControlService.ts';
import type { ControlCommandOf }                                              from '../../src/shared/@types/ControlCommand.ts';
import { OperationRefusal }                                                   from '../../src/shared/OperationRefusal.ts';
import { PRODUCT_NAMES }                                                      from '../../src/shared/constants/ProductNames.ts';
import type { CommandContext }                                                from '../CommandContext.ts';
import { openTrackerForWritingThenReadNextLine }                              from '../OpenTrackerForWriting.ts';
import { relayWhenUnderJob }                                                  from '../RelayUnderJob.ts';
import type { ArgumentParser }                                                from '../arguments/ArgumentParser.ts';
import { SUBCOMMAND_WITH_TWO_ARGUMENTS_POSITIONAL_COUNT }                     from '../arguments/constants/SubcommandPositionalCounts.ts';
import { OutputUtil }                                                         from '../utils/OutputUtil.ts';
import type { TicketSubcommandHandler }                                       from './@types/TicketSubcommandHandler.ts';
import { REVIEW_BAR_OPTION_NAMES, reviewBarRequestFrom, reviewBarStartedFor } from './ReviewBarRequest.ts';
import { TRANSITION_OPTION_NAMES, transitionOneTicket }                       from './TicketTransition.ts';
import { TICKET_USAGE }                                                       from './constants/TicketUsage.ts';
import { ReviewBarOutputUtil }                                                from './utils/ReviewBarOutputUtil.ts';
import { TicketArgumentUtil }                                                 from './utils/TicketArgumentUtil.ts';
import { TicketLookupUtil }                                                   from './utils/TicketLookupUtil.ts';

const TRANSITION_VERBS: readonly (readonly [string, TicketStatus])[] = [
  ['start', 'in-progress'],
  ['finish', 'in-review'],
  ['approve', 'reviewed'],
  ['deliver', 'delivered'],
  ['abandon', 'abandoned'],
  ['reopen', 'pending'],
];

const REVIEW_OPTION_NAMES   = [...TRANSITION_OPTION_NAMES, ...REVIEW_BAR_OPTION_NAMES];
const REREVIEW_OPTION_NAMES = ['at', 'json', ...REVIEW_BAR_OPTION_NAMES];
const READY_OPTION_NAMES    = ['at', 'json'];

function requireTicketReference(commandArguments: ArgumentParser, subcommand: string): string {
  commandArguments.rejectExtraPositionals(2, TICKET_USAGE);
  const reference = commandArguments.positionals()[1];
  if (reference === undefined) throw new OperationRefusal('refused', `${PRODUCT_NAMES.PROGRAM} ticket ${subcommand} needs a ticket id.\n  Usage: ${TICKET_USAGE}`);
  return reference;
}

function transitionHandlerFor(targetStatus: TicketStatus): TicketSubcommandHandler {
  return async (commandArguments, context, subcommand) => {
    const sendsToReview = targetStatus === 'in-review';
    commandArguments.rejectUnknownOptions(sendsToReview ? REVIEW_OPTION_NAMES : TRANSITION_OPTION_NAMES, TICKET_USAGE);
    const reference        = requireTicketReference(commandArguments, subcommand);
    const reviewBarRequest = sendsToReview ? reviewBarRequestFrom(commandArguments, subcommand) : null;
    return transitionOneTicket(targetStatus, reference, commandArguments, context, true, reviewBarRequest);
  };
}

async function setTicketStatus(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(TRANSITION_OPTION_NAMES, TICKET_USAGE);
  commandArguments.rejectExtraPositionals(SUBCOMMAND_WITH_TWO_ARGUMENTS_POSITIONAL_COUNT, TICKET_USAGE);

  const [, reference, writtenStatus] = commandArguments.positionals();
  if (reference === undefined || writtenStatus === undefined) {
    throw new OperationRefusal('refused', `${PRODUCT_NAMES.PROGRAM} ticket status needs a ticket id and a status.\n  Usage: ${TICKET_USAGE}`);
  }
  if (!VocabularyUtil.ticketStatusIsKnown(writtenStatus)) {
    return TicketArgumentUtil.refuseAnUnknownTicketStatus(writtenStatus);
  }
  return transitionOneTicket(writtenStatus, reference, commandArguments, context, false);
}

/** The one verb that may be run on the status the ticket already has: a further review pass is still review. */
async function rereviewOneTicket(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(REREVIEW_OPTION_NAMES, TICKET_USAGE);
  const reference        = requireTicketReference(commandArguments, 'rereview');
  const reviewBarRequest = reviewBarRequestFrom(commandArguments, 'rereview');

  const { result: rereviewed, nextLine } = await openTrackerForWritingThenReadNextLine(commandArguments, context, (change) => {
    const rereview = change.board.rereviewTicket(TicketLookupUtil.requireTicket(change, reference).frontmatter.id, change.at);
    return { rereview, startedReviewBar: reviewBarStartedFor(change, rereview.ticket, reviewBarRequest) };
  });

  const { rereview, startedReviewBar } = rereviewed;
  const humanText                      = `${OutputUtil.loggedSentencesOf(rereview.logged)}${ReviewBarOutputUtil.reviewBarText(startedReviewBar)}`;
  const document                       = ReviewBarOutputUtil.ticketWithReviewBarAsJson(rereview.ticket, startedReviewBar);
  OutputUtil.printEntityThenNextLine(commandArguments, context, document, humanText, nextLine);
}

/** Every named draft moves on in one hold or none does; `3`, `003` and `#3` ready one ticket once. */
async function readyTheNamedTickets(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(READY_OPTION_NAMES, TICKET_USAGE);
  const references = commandArguments.positionals().slice(1);
  if (references.length === 0) throw new OperationRefusal('refused', `${PRODUCT_NAMES.PROGRAM} ticket ready needs a ticket id.\n  Usage: ${TICKET_USAGE}`);

  const command: ControlCommandOf<'ticket-ready'> = { kind: 'ticket-ready', ticketReferences: references };
  await relayWhenUnderJob(context, command);
  const { result: readied, nextLine } = await openTrackerForWritingThenReadNextLine(
    commandArguments,
    context,
    (change) => ControlService.apply(command, change).result,
  );

  const [onlyTicket] = readied.tickets;
  const document     = readied.tickets.length === 1 && onlyTicket !== undefined
    ? TicketJsonUtil.ticketAsJson(onlyTicket)
    : readied.tickets.map(TicketJsonUtil.ticketAsJson);
  OutputUtil.printEntityThenNextLine(commandArguments, context, document, OutputUtil.loggedSentencesOf(readied.logged), nextLine);
}

export const TICKET_MOVE_SUBCOMMANDS: Readonly<Record<string, TicketSubcommandHandler>> = {
  ...Object.fromEntries(TRANSITION_VERBS.map(([verb, targetStatus]) => [verb, transitionHandlerFor(targetStatus)])),
  status:   setTicketStatus,
  rereview: rereviewOneTicket,
  ready:    readyTheNamedTickets,
};
