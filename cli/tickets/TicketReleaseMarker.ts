/** `ticket release-of`: marks a ticket as its group's release ticket, or with `--clear` removes the mark. */
import { TicketJsonUtil }        from '../../src/adapters/utils/TicketJsonUtil.ts';
import { OperationRefusal }      from '../../src/shared/OperationRefusal.ts';
import type { CommandContext }   from '../CommandContext.ts';
import { openTrackerForWriting } from '../OpenTrackerForWriting.ts';
import type { ArgumentParser }   from '../arguments/ArgumentParser.ts';
import { OutputUtil }            from '../utils/OutputUtil.ts';
import { TICKET_USAGE }          from './constants/TicketUsage.ts';
import { TicketLookupUtil }      from './utils/TicketLookupUtil.ts';

const RELEASE_OF_OPTION_NAMES = ['clear', 'at', 'json'];

export async function markOrClearReleaseTicket(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(RELEASE_OF_OPTION_NAMES, TICKET_USAGE);
  commandArguments.rejectExtraPositionals(2, TICKET_USAGE);

  const reference = commandArguments.positionals()[1];
  if (reference === undefined) {
    throw new OperationRefusal('refused', `agent-progress ticket release-of needs a ticket id.\n  Usage: ${TICKET_USAGE}`);
  }
  const clears = commandArguments.flag('clear');

  const changed = await openTrackerForWriting(commandArguments, context, (change) => {
    const ticketId = TicketLookupUtil.requireTicket(change, reference).frontmatter.id;
    return clears ? change.board.clearReleaseTicket(ticketId, change.at) : change.board.markReleaseTicket(ticketId, change.at);
  });

  OutputUtil.printEntity(commandArguments, context, TicketJsonUtil.ticketAsJson(changed.ticket), OutputUtil.loggedSentencesOf(changed.logged));
}
