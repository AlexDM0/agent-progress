/**
 * The ticket moves the runner's lifecycle service makes (a claim, a finish into review, an approval, a delivery) and the dispatcher state it
 * sets, applied to a scratch board for specs that need a ticket or the board in that state: the CLI no longer has those verbs. A spec's command
 * lines pass through here in the shape the retired verbs took; every other line reaches `runCommandLine` unchanged.
 */
import { OperationRefusalWordingUtil }               from '../../src/adapters/utils/OperationRefusalWordingUtil.ts';
import { TicketJsonUtil }                            from '../../src/adapters/utils/TicketJsonUtil.ts';
import type { TicketStatus }                         from '../../src/lib/tracker-model/@types/Ticket.ts';
import type { DispatcherState }                      from '../../src/lib/tracker-model/@types/TrackerProgress.ts';
import type { TrackerChange }                        from '../../src/services/tracker/TrackerPipeline.ts';
import { refusalIsOperationRefusal }                 from '../../src/shared/OperationRefusal.ts';
import type { CommandContext }                       from '../CommandContext.ts';
import { runCommandLine }                            from '../Main.ts';
import { openTrackerForWriting }                     from '../OpenTrackerForWriting.ts';
import { createArgumentParser, type ArgumentParser } from '../arguments/ArgumentParser.ts';
import { reviewBarStartedFor }                       from '../tickets/ReviewBarRequest.ts';
import { ReviewBarOutputUtil }                       from '../tickets/utils/ReviewBarOutputUtil.ts';
import { TicketLookupUtil }                          from '../tickets/utils/TicketLookupUtil.ts';
import { OptionValueUtil }                           from '../utils/OptionValueUtil.ts';

const STATUS_OF_RUNNER_MOVE: Readonly<Record<string, TicketStatus>> = {
  start:   'in-progress',
  finish:  'in-review',
  approve: 'reviewed',
  deliver: 'delivered',
};

const CLAIM_VERB = 'claim';

function optionalEntry<Key extends string>(key: Key, value: string | undefined): Partial<Record<Key, string>> {
  return value === undefined ? {} : { [key]: value } as Record<Key, string>;
}

function claimOnTheBoard(commandArguments: ArgumentParser, change: TrackerChange): unknown {
  const ticketIds      = commandArguments.positionals().slice(1).map((reference) => TicketLookupUtil.requireTicket(change, reference).frontmatter.id);
  const afterReference = commandArguments.option('after');
  const claimed        = change.board.claimTickets(ticketIds, {
    ...optionalEntry('owner', commandArguments.option('owner')),
    ...optionalEntry('note', commandArguments.option('note')),
    ...optionalEntry('afterTicketId', afterReference === undefined ? undefined : TicketLookupUtil.requireTicket(change, afterReference).frontmatter.id),
  }, change.at);
  const documents = claimed.tickets.map(TicketJsonUtil.ticketAsJson);
  return documents.length === 1 ? documents[0] : documents;
}

function moveOnTheBoard(targetStatus: TicketStatus, commandArguments: ArgumentParser, change: TrackerChange): unknown {
  const ticketId = TicketLookupUtil.requireTicket(change, commandArguments.positionals()[1] ?? '').frontmatter.id;
  const details  = { ...optionalEntry('branch', commandArguments.option('branch')), ...optionalEntry('commit', commandArguments.option('commit')) };
  const tokens   = OptionValueUtil.tokenCountFrom(commandArguments);
  const move     = change.board.moveTicket(ticketId, targetStatus, { checksLegality: true, ...details, ...(tokens === undefined ? {} : { tokens }) }, change.at);
  const reviewBarRequest = commandArguments.flag('start-review')
    ? { ...optionalEntry('owner', commandArguments.option('owner')), ...optionalEntry('note', commandArguments.option('note')) }
    : null;
  return ReviewBarOutputUtil.ticketWithReviewBarAsJson(move.ticket, reviewBarStartedFor(change, move.ticket, reviewBarRequest), move.closedReviewBars);
}

function boardMoveOf(commandLineArguments: readonly string[]): ((commandArguments: ArgumentParser, change: TrackerChange) => unknown) | null {
  const [command, word] = commandLineArguments;
  if (command === 'dispatcher' && word !== undefined) {
    return (_commandArguments, change) => change.board.setDispatcherState(word as DispatcherState, change.at).previousState;
  }
  if (command !== 'ticket' || word === undefined || commandLineArguments.includes('--by-hand')) return null;
  if (word === CLAIM_VERB) return claimOnTheBoard;
  const targetStatus = Object.hasOwn(STATUS_OF_RUNNER_MOVE, word) ? STATUS_OF_RUNNER_MOVE[word] : undefined;
  return targetStatus === undefined ? null : (commandArguments, change) => moveOnTheBoard(targetStatus, commandArguments, change);
}

/** Exits as `runCommandLine` would: 0 done, 1 a refusal, 2 anything else, the refusal worded on standard error; `--json` prints the ticket. */
export async function runCommandLineWithRunnerMoves(commandLineArguments: readonly string[], context: CommandContext): Promise<number> {
  const boardMove = boardMoveOf(commandLineArguments);
  if (boardMove === null) return runCommandLine(commandLineArguments, context);
  const commandArguments = createArgumentParser(commandLineArguments.slice(1));
  try {
    const document = await openTrackerForWriting(commandArguments, context, (change) => boardMove(commandArguments, change));
    if (commandArguments.flag('json')) context.standardOutput(`${JSON.stringify(document, null, 2)}\n`);
    return 0;
  } catch (error) {
    if (!refusalIsOperationRefusal(error)) throw error;
    context.standardError(OperationRefusalWordingUtil.messageOf(error));
    return error.status === 'refused' ? 1 : 2;
  }
}
