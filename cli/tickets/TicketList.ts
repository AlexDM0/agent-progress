/** `ticket list`: the ticket files as a table, narrowed by status and priority, read with no lock and no Board. */
import { TicketJsonUtil }   from '../../src/adapters/utils/TicketJsonUtil.ts';
import { TicketPhraseUtil } from '../../src/adapters/utils/TicketPhraseUtil.ts';
import type {
  AgentEffort,
  AgentModel,
  Ticket,
  TicketStatus
} from '../../src/lib/tracker-model/@types/Ticket.ts';
import { TicketDefaultsUtil }     from '../../src/lib/tracker-model/utils/TicketDefaultsUtil.ts';
import { TicketDependencyUtil }   from '../../src/lib/tracker-model/utils/TicketDependencyUtil.ts';
import { VocabularyUtil }         from '../../src/lib/tracker-model/utils/VocabularyUtil.ts';
import { listTickets }            from '../../src/services/tracker/TicketStore.ts';
import { requireWorkspace }       from '../../src/services/tracker/Workspace.ts';
import type { CommandContext }    from '../CommandContext.ts';
import type { ArgumentParser }    from '../arguments/ArgumentParser.ts';
import { RetiredWordRefusalUtil } from '../legacy/utils/RetiredWordRefusalUtil.ts';
import { OutputUtil }             from '../utils/OutputUtil.ts';
import { TICKET_USAGE }           from './constants/TicketUsage.ts';
import { TicketArgumentUtil }     from './utils/TicketArgumentUtil.ts';

const LIST_OPTION_NAMES = ['status', 'priority', 'json'];

const LIST_COLUMN_WIDTHS_CHARACTERS = {
  identifier: 6,
  status:     12,
  priority:   8,
  type:       8,
  task:       6,
};

function waitingOnFor(ticket: Ticket, tickets: readonly Ticket[]): string[] {
  const statusById = new Map(tickets.map((candidate) => [candidate.frontmatter.id, candidate.frontmatter.status]));
  return TicketDependencyUtil.waitingOnOf(ticket.frontmatter, statusById);
}

/** Only what the file names: a ticket left to the defaults prints nothing extra, so a listing of old tickets looks as it did. */
function namedAgentText(ticket: { model?: AgentModel; effort?: AgentEffort }): string {
  const named = [ticket.model, ticket.effort === undefined ? undefined : `${ticket.effort} effort`].filter((part) => part !== undefined);
  return named.length === 0 ? '' : `  [${named.join(', ')}]`;
}

function listedStatusFrom(writtenStatus: string | undefined): TicketStatus | undefined {
  if (writtenStatus === undefined || VocabularyUtil.ticketStatusIsKnown(writtenStatus)) return writtenStatus;
  // The seam to the retired words; dropping `cli/legacy/` leaves only the unknown-status refusal below.
  RetiredWordRefusalUtil.refuseARetiredTicketStatus(writtenStatus, (renamedStatus) => `pass --status ${renamedStatus}`);
  return TicketArgumentUtil.refuseAnUnknownTicketStatus(writtenStatus);
}

function tableOf(shown: readonly Ticket[], tickets: readonly Ticket[]): string {
  const header = [
    OutputUtil.padColumn('id', LIST_COLUMN_WIDTHS_CHARACTERS.identifier),
    OutputUtil.padColumn('status', LIST_COLUMN_WIDTHS_CHARACTERS.status),
    OutputUtil.padColumn('priority', LIST_COLUMN_WIDTHS_CHARACTERS.priority),
    OutputUtil.padColumn('type', LIST_COLUMN_WIDTHS_CHARACTERS.type),
    OutputUtil.padColumn('task', LIST_COLUMN_WIDTHS_CHARACTERS.task),
    'title',
  ].join('');
  const rows = shown.map((ticket) => {
    const waitingOn = waitingOnFor(ticket, tickets);
    return [
      OutputUtil.padColumn(`#${ticket.frontmatter.id}`, LIST_COLUMN_WIDTHS_CHARACTERS.identifier),
      OutputUtil.padColumn(ticket.frontmatter.status, LIST_COLUMN_WIDTHS_CHARACTERS.status),
      OutputUtil.padColumn(TicketDefaultsUtil.ticketPriorityOf(ticket.frontmatter), LIST_COLUMN_WIDTHS_CHARACTERS.priority),
      OutputUtil.padColumn(ticket.frontmatter.type, LIST_COLUMN_WIDTHS_CHARACTERS.type),
      OutputUtil.padColumn(ticket.frontmatter.task === null ? '-' : `#${ticket.frontmatter.task}`, LIST_COLUMN_WIDTHS_CHARACTERS.task),
      ticket.frontmatter.title,
      namedAgentText(ticket.frontmatter),
      waitingOn.length > 0 ? `  (${TicketPhraseUtil.waitingOnText(waitingOn)})` : '',
    ].join('');
  });
  return [header, ...rows].join('\n');
}

export async function listAllTickets(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(LIST_OPTION_NAMES, TICKET_USAGE);
  commandArguments.rejectExtraPositionals(1, TICKET_USAGE);

  const listedStatus    = listedStatusFrom(commandArguments.option('status'));
  const writtenPriority = TicketArgumentUtil.priorityFrom(commandArguments.option('priority'));

  const listing = listTickets(requireWorkspace(context.currentDirectory));
  const shown   = listing.tickets
    .filter((ticket) => listedStatus === undefined || ticket.frontmatter.status === listedStatus)
    .filter((ticket) => writtenPriority === undefined || TicketDefaultsUtil.ticketPriorityOf(ticket.frontmatter) === writtenPriority);

  // Before the listing, so a reader piping the table still sees what was left out of it.
  OutputUtil.reportIgnoredTicketFiles(context, listing.malformed);

  if (shown.length === 0) {
    const narrowing = [listedStatus, writtenPriority === undefined ? undefined : `${writtenPriority} priority`].filter((part) => part !== undefined);
    const emptyText = narrowing.length === 0 ? 'No tickets have been filed yet.' : `No tickets are ${narrowing.join(' and ')}.`;
    OutputUtil.printEntity(commandArguments, context, [], emptyText);
    return;
  }
  OutputUtil.printEntity(commandArguments, context, shown.map(TicketJsonUtil.ticketDocumentOf), tableOf(shown, listing.tickets));
}
