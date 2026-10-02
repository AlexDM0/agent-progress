import { TicketJsonUtil }         from '../../src/adapters/utils/TicketJsonUtil.ts';
import { requireWorkspace }       from '../../src/services/tracker/Workspace.ts';
import { OperationRefusal }       from '../../src/shared/OperationRefusal.ts';
import type { CommandContext }    from '../CommandContext.ts';
import { openTrackerForWriting }  from '../OpenTrackerForWriting.ts';
import { suppliedMarkdownBodyOf } from '../SuppliedMarkdownBody.ts';
import type { ArgumentParser }    from '../arguments/ArgumentParser.ts';
import { OutputUtil }             from '../utils/OutputUtil.ts';
import { TICKET_USAGE }           from './constants/TicketUsage.ts';
import { TicketLookupUtil }       from './utils/TicketLookupUtil.ts';

const EDIT_OPTION_NAMES = ['title', 'append', 'body', 'body-file', 'force', 'at', 'json'];

export async function editTicket(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(EDIT_OPTION_NAMES, TICKET_USAGE);
  commandArguments.rejectExtraPositionals(2, TICKET_USAGE);

  const reference = commandArguments.positionals()[1];
  if (reference === undefined) {
    throw new OperationRefusal('refused', `agent-progress ticket edit needs a ticket id.\n  Usage: ${TICKET_USAGE}`);
  }
  if (commandArguments.option('body') !== undefined && commandArguments.option('body-file') !== undefined) {
    throw new OperationRefusal('refused', `agent-progress ticket edit takes --body or --body-file, not both.\n  Usage: ${TICKET_USAGE}`);
  }
  const title   = commandArguments.option('title');
  const appends = commandArguments.flag('append');
  const forced  = commandArguments.flag('force');
  if (title?.trim() === '') throw new OperationRefusal('refused', `agent-progress ticket edit was given an empty --title.\n  Usage: ${TICKET_USAGE}`);

  // Read before the lock: `--body-file -` waits on a pipe the caller may hold open indefinitely.
  requireWorkspace(context.currentDirectory);
  const text = await suppliedMarkdownBodyOf(commandArguments, context);
  if (title === undefined && text === undefined) {
    throw new OperationRefusal('refused', `agent-progress ticket edit needs --title, --body or --body-file.\n  Usage: ${TICKET_USAGE}`);
  }
  if (text !== undefined && !appends && text.trim() === '') {
    throw new OperationRefusal('refused', 'An empty body would erase the ticket\'s prose, so it is refused; to add to the body, pass --append.');
  }

  const edited = await openTrackerForWriting(
    commandArguments,
    context,
    (change) => change.board.editTicket(TicketLookupUtil.requireTicket(change, reference).frontmatter.id, {
      ...(title === undefined ? {} : { title }),
      ...(text === undefined ? {} : { body: { text, appends } }),
      allowsPastPending: forced,
    }, change.at),
  );

  const ticketId = edited.ticket.frontmatter.id;
  const sentences = edited.changed
    ? [
      ...(edited.logged.length === 0 ? [] : [OutputUtil.loggedSentencesOf(edited.logged)]),
      ...(text === undefined ? [] : [`Ticket #${ticketId} body ${appends ? 'appended to' : 'replaced'}`]),
    ]
    : [`Ticket #${ticketId} ${title === undefined ? 'body ' : ''}unchanged: nothing to write`];
  OutputUtil.printEntity(commandArguments, context, TicketJsonUtil.ticketAsJson(edited.ticket), `${sentences.join('\n')}\n  ${edited.ticket.filePath}`);
}
