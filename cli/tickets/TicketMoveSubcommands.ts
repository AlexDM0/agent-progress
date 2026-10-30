/**
 * The named verbs enforce the legality matrix of `src/lib/tracker-model/constants/TicketMoveLegality.ts`; `ticket status` is the
 * documented override that skips it.
 */
import { TicketJsonUtil }                                                     from '../../src/adapters/utils/TicketJsonUtil.ts';
import type { TicketStatus }                                                  from '../../src/lib/tracker-model/@types/Ticket.ts';
import { VocabularyUtil }                                                     from '../../src/lib/tracker-model/utils/VocabularyUtil.ts';
import { ControlService }                                                     from '../../src/services/control/ControlService.ts';
import { runnerFilesIn }                                                      from '../../src/services/runner/RunnerFiles.ts';
import { RunnerLease }                                                        from '../../src/services/runner/RunnerLease.ts';
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
import { parkTicket }                                                         from './TicketPark.ts';
import { TRANSITION_OPTION_NAMES, transitionOneTicket }                       from './TicketTransition.ts';
import { triageTickets }                                                      from './TicketTriage.ts';
import { TICKET_USAGE }                                                       from './constants/TicketUsage.ts';
import { ReviewBarOutputUtil }                                                from './utils/ReviewBarOutputUtil.ts';
import { TicketArgumentUtil }                                                 from './utils/TicketArgumentUtil.ts';
import { TicketLookupUtil }                                                   from './utils/TicketLookupUtil.ts';

const TRANSITION_VERBS: readonly (readonly [string, TicketStatus])[] = [
  ['abandon', 'abandoned'],
  ['reopen', 'pending'],
];

const REREVIEW_OPTION_NAMES = ['at', 'json', ...REVIEW_BAR_OPTION_NAMES];
const READY_OPTION_NAMES    = ['at', 'json', 'incident'];
const BY_HAND_FLAG          = 'by-hand';
const BY_HAND_OPTION_NAMES  = [BY_HAND_FLAG, 'branch', 'commit', 'at', 'json'];

function requireTicketReference(commandArguments: ArgumentParser, subcommand: string): string {
  commandArguments.rejectExtraPositionals(2, TICKET_USAGE);
  const reference = commandArguments.positionals()[1];
  if (reference === undefined) throw new OperationRefusal('refused', `${PRODUCT_NAMES.PROGRAM} ticket ${subcommand} needs a ticket id.\n  Usage: ${TICKET_USAGE}`);
  return reference;
}

/**
 * The one record-only lifecycle verb: a ticket User finished and landed outside the runner is recorded delivered in one hold, merging,
 * landing and spawning nothing. Both refusals are judged inside the hold, so a runner starting meanwhile reads the ticket delivered or not at all.
 */
async function deliverByHand(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(BY_HAND_OPTION_NAMES, TICKET_USAGE);
  if (!commandArguments.flag(BY_HAND_FLAG)) {
    throw new OperationRefusal('refused', `"deliver" without --by-hand is not a ${PRODUCT_NAMES.PROGRAM} ticket subcommand.\n  Usage: ${TICKET_USAGE}`);
  }
  const reference = requireTicketReference(commandArguments, 'deliver');
  const branch    = commandArguments.option('branch');
  const commit    = commandArguments.option('commit');
  const { result: move, nextLine } = await openTrackerForWritingThenReadNextLine(commandArguments, context, (change) => {
    const { runnerDirectory } = runnerFilesIn(change.workspace.trackerDirectory);
    const newestLease     = RunnerLease.newestLeaseOf(runnerDirectory);
    if (newestLease.verdict === 'live') {
      const leaseFilePath = RunnerLease.leaseFilePathFor(runnerDirectory, newestLease.generation);
      throw new OperationRefusal('refused', { kind: 'runner-owns-the-lifecycle', url: newestLease.record.url, leaseFilePath });
    }
    const ticketId = TicketLookupUtil.requireTicket(change, reference).frontmatter.id;
    const liveJob  = change.board.jobs().find((job) => job.ticketIds.includes(ticketId));
    if (liveJob !== undefined) throw new OperationRefusal('refused', {
      kind: 'ticket-has-live-job', ticketId, jobId: liveJob.id, state: liveJob.state
    });
    return change.board.moveTicket(ticketId, 'delivered', {
      checksLegality: false, byHand: true, ...(branch === undefined ? {} : { branch }), ...(commit === undefined ? {} : { commit }),
    }, change.at);
  });
  const humanText = `${OutputUtil.loggedSentencesOf(move.logged.filter(ReviewBarOutputUtil.recordClosesNoBar))}${ReviewBarOutputUtil.closedReviewBarsText(move.closedReviewBars)}`;
  OutputUtil.printEntityThenNextLine(commandArguments, context, ReviewBarOutputUtil.ticketWithReviewBarAsJson(move.ticket, null, move.closedReviewBars), humanText, nextLine);
}

function transitionHandlerFor(targetStatus: TicketStatus): TicketSubcommandHandler {
  return async (commandArguments, context, subcommand) => {
    commandArguments.rejectUnknownOptions(TRANSITION_OPTION_NAMES, TICKET_USAGE);
    const reference = requireTicketReference(commandArguments, subcommand);
    return transitionOneTicket(targetStatus, reference, commandArguments, context, true);
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

  const incidentId = commandArguments.option('incident')?.toUpperCase();
  const command: ControlCommandOf<'ticket-ready'> = { kind: 'ticket-ready', ticketReferences: references, ...(incidentId === undefined ? {} : { incidentId }) };
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
  deliver:  deliverByHand,
  status:   setTicketStatus,
  rereview: rereviewOneTicket,
  ready:    readyTheNamedTickets,
  triage:   triageTickets,
  park:     parkTicket,
};
