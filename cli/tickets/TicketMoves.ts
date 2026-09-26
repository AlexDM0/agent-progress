/**
 * The named verbs enforce the legality matrix of `src/lib/tracker-model/constants/TicketMoveLegality.ts`; `ticket status` is the
 * documented override that skips it.
 */
import { StatusWordingUtil }                      from '../../src/adapters/utils/StatusWordingUtil';
import { TicketBodyUtil }                         from '../../src/adapters/utils/TicketBodyUtil';
import { TicketPhraseUtil }                       from '../../src/adapters/utils/TicketPhraseUtil';
import type { AgentAssignment, ReviewBarStarted } from '../../src/lib/tracker-model/@types/BoardChanges';
import type { LogRecord }                         from '../../src/lib/tracker-model/@types/LogRecord';
import type { Task }                              from '../../src/lib/tracker-model/@types/Task';
import type { Ticket, TicketStatus }              from '../../src/lib/tracker-model/@types/Ticket';
import { VocabularyUtil }                         from '../../src/lib/tracker-model/utils/VocabularyUtil';
import type { TrackerChange }                     from '../../src/services/tracker/TrackerPipeline';
import { OperationRefusal }                       from '../../src/shared/OperationRefusal';
import type { CommandContext }                    from '../CommandContext';
import { openTrackerForWritingThenReadNextLine }  from '../TrackerWriting';
import type { ArgumentParser }                    from '../arguments/ArgumentParser';
import { NextLineUtil }                           from '../utils/NextLineUtil';
import { OptionValueUtil }                        from '../utils/OptionValueUtil';
import { OutputUtil }                             from '../utils/OutputUtil';
import type { TicketSubcommandHandler }           from './@types/TicketSubcommandHandler';
import { TICKET_USAGE }                           from './constants/TicketUsage';
import { TicketArgumentUtil }                     from './utils/TicketArgumentUtil';
import { TicketLookupUtil }                       from './utils/TicketLookupUtil';
import { TicketOutputUtil }                       from './utils/TicketOutputUtil';

const TRANSITION_TARGET_STATUSES: Record<string, TicketStatus> = {
  [StatusWordingUtil.verbFor('in-progress')]: 'in-progress',
  [StatusWordingUtil.verbFor('in-review')]:   'in-review',
  [StatusWordingUtil.verbFor('reviewed')]:    'reviewed',
  [StatusWordingUtil.verbFor('delivered')]:   'delivered',
  [StatusWordingUtil.verbFor('abandoned')]:   'abandoned',
  [StatusWordingUtil.verbFor('pending')]:     'pending',
};

/** A verb that was renamed is refused naming its replacement, rather than read as an unknown word. */
const RETIRED_SUBCOMMAND_REPLACEMENTS: Record<string, string> = {
  review: 'finish',
  done:   'approve',
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
  return closedBars.map((bar) => `\nClosed the review row #${bar.id}, delivered`).join('');
}

function reviewBarText(started: ReviewBarStarted | null): string {
  if (started === null) return '';
  return `${closedReviewBarsText(started.closedBars)}\n${TicketOutputUtil.loggedSentencesOf(started.logged.filter(recordClosesNoBar))}`;
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
  const humanText    = `${TicketOutputUtil.loggedSentencesOf(move.logged.filter(recordClosesNoBar))}${closedReviewBarsText(move.closedReviewBars)}`
    + reviewBarText(startedReviewBar);
  const document     = ticketWithReviewBarAsJson(move.ticket, startedReviewBar, move.closedReviewBars);
  OutputUtil.printEntityThenNextLine(commandArguments, context, document, humanText, closingLines);

  // A warning, not a refusal: the order is advice to whoever picks work up, and the user may know better.
  if (targetStatus === 'in-progress' && moved.unsettled.length > 0) {
    const notSettledYetText = moved.unsettled.length === 1 ? 'which is not reviewed or delivered yet' : 'which are not reviewed or delivered yet';
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
    const reviewBarRequest = sendsToReview ? reviewBarRequestFrom(commandArguments, 'finish') : null;
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
    return TicketArgumentUtil.refuseAnUnknownTicketStatus(writtenStatus, (renamedStatus) => `run \`agent-progress ticket status ${reference} ${renamedStatus}\``);
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
  const humanText                      = `${TicketOutputUtil.loggedSentencesOf(rereview.logged)}${reviewBarText(startedReviewBar)}`;
  OutputUtil.printEntityThenNextLine(commandArguments, context, ticketWithReviewBarAsJson(rereview.ticket, startedReviewBar), humanText, nextLine);
}

async function refuseARetiredSubcommand(commandArguments: ArgumentParser, _context: CommandContext, subcommand: string): Promise<never> {
  const replacement              = RETIRED_SUBCOMMAND_REPLACEMENTS[subcommand] ?? subcommand;
  const targetStatus             = Object.hasOwn(TRANSITION_TARGET_STATUSES, replacement) ? TRANSITION_TARGET_STATUSES[replacement] : undefined;
  const ticketId                 = commandArguments.positionals()[1] ?? '<id>';
  const startReviewCarryOverText = targetStatus === 'in-review' ? ', and takes --start-review the same way' : '';
  throw new OperationRefusal(
    'refused',
    `\`agent-progress ticket ${subcommand}\` was renamed: \`agent-progress ticket ${replacement} ${ticketId}\` moves a ticket to ${targetStatus ?? replacement}`
    + `${startReviewCarryOverText}. Nothing was written.`,
  );
}

const TRANSITION_HANDLERS: Record<string, TicketSubcommandHandler> = Object.fromEntries(
  Object.entries(TRANSITION_TARGET_STATUSES).map(([verb, targetStatus]) => [verb, transitionHandlerFor(targetStatus)]),
);

const RETIRED_SUBCOMMAND_HANDLERS: Record<string, TicketSubcommandHandler> = Object.fromEntries(
  Object.keys(RETIRED_SUBCOMMAND_REPLACEMENTS).map((retiredVerb) => [retiredVerb, refuseARetiredSubcommand]),
);

export const TICKET_MOVE_SUBCOMMANDS: Readonly<Record<string, TicketSubcommandHandler>> = {
  ...TRANSITION_HANDLERS,
  status:   setTicketStatus,
  rereview: rereviewOneTicket,
  ...RETIRED_SUBCOMMAND_HANDLERS,
};
