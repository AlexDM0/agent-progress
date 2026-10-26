/** `ticket introduced-by`: names the delivered ticket whose change introduced a bug, or with an empty cause clears it. */
import { TicketJsonUtil }                                 from '../../src/adapters/utils/TicketJsonUtil.ts';
import { OperationRefusal }                               from '../../src/shared/OperationRefusal.ts';
import type { CommandContext }                            from '../CommandContext.ts';
import { openTrackerForWritingThenReadNextLine }          from '../OpenTrackerForWriting.ts';
import type { ArgumentParser }                            from '../arguments/ArgumentParser.ts';
import { SUBCOMMAND_WITH_TWO_ARGUMENTS_POSITIONAL_COUNT } from '../arguments/constants/SubcommandPositionalCounts.ts';
import { NextLineUtil }                                   from '../utils/NextLineUtil.ts';
import { OutputUtil }                                     from '../utils/OutputUtil.ts';
import { TICKET_USAGE }                                   from './constants/TicketUsage.ts';
import { TicketArgumentUtil }                             from './utils/TicketArgumentUtil.ts';
import { TicketLookupUtil }                               from './utils/TicketLookupUtil.ts';

const INTRODUCED_BY_OPTION_NAMES = ['at', 'json'];

export async function setTicketIntroducedBy(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(INTRODUCED_BY_OPTION_NAMES, TICKET_USAGE);
  commandArguments.rejectExtraPositionals(SUBCOMMAND_WITH_TWO_ARGUMENTS_POSITIONAL_COUNT, TICKET_USAGE);

  const [, reference, causeReference] = commandArguments.positionals();
  if (reference === undefined) {
    throw new OperationRefusal('refused', `agent-progress ticket introduced-by needs a bug's id, then the ticket that introduced it (empty clears it).\n  Usage: ${TICKET_USAGE}`);
  }
  const causeTicketId = TicketArgumentUtil.linkedTicketIdFrom(causeReference);

  const { result: changed, nextLine, dispatcherState } = await openTrackerForWritingThenReadNextLine(
    commandArguments,
    context,
    (change) => change.board.setTicketIntroducedBy(TicketLookupUtil.requireTicket(change, reference).frontmatter.id, causeTicketId, change.at),
  );

  const closingLines = NextLineUtil.endWithRunningDispatcherNotice(nextLine, dispatcherState);
  OutputUtil.printEntityThenNextLine(commandArguments, context, TicketJsonUtil.ticketAsJson(changed.ticket), OutputUtil.loggedSentencesOf(changed.logged), closingLines);
}
