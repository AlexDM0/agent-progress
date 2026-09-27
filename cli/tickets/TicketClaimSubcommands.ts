import { TicketJsonUtil }                        from '../../src/adapters/utils/TicketJsonUtil.ts';
import { TicketPhraseUtil }                      from '../../src/adapters/utils/TicketPhraseUtil.ts';
import { OperationRefusal }                      from '../../src/shared/OperationRefusal.ts';
import type { CommandContext }                   from '../CommandContext.ts';
import { openTrackerForWritingThenReadNextLine } from '../OpenTrackerForWriting.ts';
import type { ArgumentParser }                   from '../arguments/ArgumentParser.ts';
import { OutputUtil }                            from '../utils/OutputUtil.ts';
import type { TicketSubcommandHandler }          from './@types/TicketSubcommandHandler.ts';
import { TICKET_USAGE }                          from './constants/TicketUsage.ts';
import { TicketLookupUtil }                      from './utils/TicketLookupUtil.ts';

const CLAIM_OPTION_NAMES = ['owner', 'note', 'at', 'json'];

/** Every reference is resolved before the claim is judged, so the first naming no ticket is refused; `3`, `003` and `#3` claim one ticket once. */
async function claimTickets(references: readonly string[], commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  const owner = commandArguments.option('owner');
  const note  = commandArguments.option('note');

  const { result: claimed, nextLine } = await openTrackerForWritingThenReadNextLine(commandArguments, context, (change) => {
    const ticketIds = references.map((reference) => TicketLookupUtil.requireTicket(change, reference).frontmatter.id);
    return change.board.claimTickets(ticketIds, {
      ...(owner === undefined ? {} : { owner }),
      ...(note === undefined ? {} : { note }),
    }, change.at);
  });

  const { concurrency, tickets } = claimed;
  const identifiers  = tickets.map((ticket) => ticket.frontmatter.id);
  const [onlyTicket] = tickets;
  const slotsText    = `${concurrency.agentsInFlight} of ${concurrency.limit} slots are now taken.`;
  if (tickets.length === 1 && onlyTicket !== undefined) {
    OutputUtil.printEntityThenNextLine(
      commandArguments,
      context,
      TicketJsonUtil.ticketAsJson(onlyTicket),
      `${TicketPhraseUtil.namedTicketsText(identifiers)} started: ${slotsText}`,
      nextLine,
    );
    return;
  }
  OutputUtil.printEntityThenNextLine(
    commandArguments,
    context,
    tickets.map(TicketJsonUtil.ticketAsJson),
    `${TicketPhraseUtil.namedTicketsText(identifiers)} started as one agent: ${slotsText}`,
    nextLine,
  );
}

async function claimTheNamedTickets(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(CLAIM_OPTION_NAMES, TICKET_USAGE);
  const references = commandArguments.positionals().slice(1);
  if (references.length === 0) {
    throw new OperationRefusal('refused', `agent-progress ticket claim needs a ticket id, or every id of a bundle.\n  Usage: ${TICKET_USAGE}`);
  }
  return claimTickets(references, commandArguments, context);
}

export const TICKET_CLAIM_SUBCOMMANDS: Readonly<Record<string, TicketSubcommandHandler>> = { claim: claimTheNamedTickets };
