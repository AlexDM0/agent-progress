import { TicketJsonUtil }        from '../../src/adapters/utils/TicketJsonUtil.ts';
import { requireWorkspace }      from '../../src/services/tracker/Workspace.ts';
import { OperationRefusal }      from '../../src/shared/OperationRefusal.ts';
import type { CommandContext }   from '../CommandContext.ts';
import { openTrackerForWriting } from '../OpenTrackerForWriting.ts';
import type { ArgumentParser }   from '../arguments/ArgumentParser.ts';
import { OutputUtil }            from '../utils/OutputUtil.ts';
import { suppliedTicketBodyOf }  from './SuppliedTicketBody.ts';
import { TICKET_USAGE }          from './constants/TicketUsage.ts';
import { TicketLookupUtil }      from './utils/TicketLookupUtil.ts';

const EDIT_OPTION_NAMES = ['append', 'body', 'body-file', 'json'];

export async function editTicketBody(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(EDIT_OPTION_NAMES, TICKET_USAGE);
  commandArguments.rejectExtraPositionals(2, TICKET_USAGE);

  const reference = commandArguments.positionals()[1];
  if (reference === undefined) {
    throw new OperationRefusal('refused', `agent-progress ticket edit needs a ticket id.\n  Usage: ${TICKET_USAGE}`);
  }
  if (commandArguments.option('body') !== undefined && commandArguments.option('body-file') !== undefined) {
    throw new OperationRefusal('refused', `agent-progress ticket edit takes --body or --body-file, not both.\n  Usage: ${TICKET_USAGE}`);
  }
  const appends = commandArguments.flag('append');

  // Read before the lock: `--body-file -` waits on a pipe the caller may hold open indefinitely.
  requireWorkspace(context.currentDirectory);
  const text = await suppliedTicketBodyOf(commandArguments, context);
  if (text === undefined) {
    throw new OperationRefusal('refused', `agent-progress ticket edit needs --body or --body-file.\n  Usage: ${TICKET_USAGE}`);
  }
  if (!appends && text.trim() === '') {
    throw new OperationRefusal('refused', 'An empty body would erase the ticket\'s prose, so it is refused; to add to the body, pass --append.');
  }

  const edited = await openTrackerForWriting(
    commandArguments,
    context,
    (change) => change.board.editTicketBody(TicketLookupUtil.requireTicket(change, reference).frontmatter.id, { text, appends }),
  );

  const ticketId = edited.ticket.frontmatter.id;
  const sentence = edited.changed
    ? `Ticket #${ticketId} body ${appends ? 'appended to' : 'replaced'}`
    : `Ticket #${ticketId} body unchanged: nothing to write`;
  OutputUtil.printEntity(commandArguments, context, TicketJsonUtil.ticketAsJson(edited.ticket), `${sentence}\n  ${edited.ticket.filePath}`);
}
