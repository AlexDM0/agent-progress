import { StatusWordingUtil } from '../../src/adapters/utils/StatusWordingUtil';
import { TicketJsonUtil }    from '../../src/adapters/utils/TicketJsonUtil';
import { TicketPhraseUtil }  from '../../src/adapters/utils/TicketPhraseUtil';
import type {
  AgentEffort,
  AgentModel,
  Ticket,
  TicketStatus
} from '../../src/lib/tracker-model/@types/Ticket';
import { TicketDefaultsUtil }               from '../../src/lib/tracker-model/utils/TicketDefaultsUtil';
import { TicketDependencyUtil }             from '../../src/lib/tracker-model/utils/TicketDependencyUtil';
import { VocabularyUtil }                   from '../../src/lib/tracker-model/utils/VocabularyUtil';
import { listTickets, readTicket }          from '../../src/services/tracker/TicketStore';
import { requireWorkspace, type Workspace } from '../../src/services/tracker/Workspace';
import { OperationRefusal }                 from '../../src/shared/OperationRefusal';
import { LIMITS }                           from '../../src/shared/constants/Limits';
import type { CommandContext }              from '../CommandContext';
import type { ArgumentParser }              from '../arguments/ArgumentParser';
import { RetiredWordRefusalUtil }           from '../legacy/utils/RetiredWordRefusalUtil';
import { OutputUtil }                       from '../utils/OutputUtil';
import type { TicketSubcommandHandler }     from './@types/TicketSubcommandHandler';
import { TICKET_USAGE }                     from './constants/TicketUsage';
import { TicketArgumentUtil }               from './utils/TicketArgumentUtil';
import { TicketLookupUtil }                 from './utils/TicketLookupUtil';
import { TicketOutputUtil }                 from './utils/TicketOutputUtil';

const LIST_OPTION_NAMES = ['status', 'priority', 'json'];
const SHOW_OPTION_NAMES = ['json'];

const TICKET_STATUSES_THAT_CLOSE_A_TICKET: readonly TicketStatus[] = ['reviewed', 'delivered', 'abandoned'];

const LIST_COLUMN_WIDTHS = {
  identifier: 6,
  status:     12,
  priority:   8,
  type:       8,
  task:       6,
};

/** `ticket show` changes nothing, so it reads the ticket files as they are, with no lock and no Board. */
function requireTicketToShow(workspace: Workspace, reference: string): Ticket {
  return readTicket(workspace, reference) ?? TicketLookupUtil.refuseAMissingTicket(reference, listTickets(workspace).malformed);
}

function unsettledDependenciesFor(ticket: Ticket, tickets: readonly Ticket[]): string[] {
  const statusById = new Map(tickets.map((candidate) => [candidate.frontmatter.id, candidate.frontmatter.status]));
  return TicketDependencyUtil.unsettledDependenciesOf(ticket.frontmatter.dependsOn ?? [], statusById);
}

function ticketIsStillOpen(ticket: Ticket): boolean {
  return !TICKET_STATUSES_THAT_CLOSE_A_TICKET.includes(ticket.frontmatter.status);
}

/** Only what the file names: a ticket left to the defaults prints nothing extra, so a listing of old tickets looks as it did. */
function namedAgentText(ticket: { model?: AgentModel; effort?: AgentEffort }): string {
  const named = [ticket.model, ticket.effort === undefined ? undefined : `${ticket.effort} effort`].filter((part) => part !== undefined);
  return named.length === 0 ? '' : `  [${named.join(', ')}]`;
}

function listedStatusFrom(writtenStatus: string | undefined): TicketStatus | undefined {
  if (writtenStatus === undefined || VocabularyUtil.ticketStatusIsKnown(writtenStatus)) return writtenStatus;
  // The seam to the retired words; dropping `cli/legacy/` leaves only the unknown-status refusal below.
  RetiredWordRefusalUtil.refuseARetiredTicketStatus(writtenStatus, (renamedStatus) => `pass --status ${StatusWordingUtil.statusWordFor(renamedStatus)}`);
  return TicketArgumentUtil.refuseAnUnknownTicketStatus(writtenStatus);
}

async function listAllTickets(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(LIST_OPTION_NAMES, TICKET_USAGE);
  commandArguments.rejectExtraPositionals(1, TICKET_USAGE);

  const listedStatus    = listedStatusFrom(commandArguments.option('status'));
  const writtenPriority = TicketArgumentUtil.priorityFrom(commandArguments.option('priority'));

  const workspace = requireWorkspace(context.currentDirectory);
  const listing   = listTickets(workspace);
  const shown     = listing.tickets
    .filter((ticket) => listedStatus === undefined || ticket.frontmatter.status === listedStatus)
    .filter((ticket) => writtenPriority === undefined || TicketDefaultsUtil.ticketPriorityOf(ticket.frontmatter) === writtenPriority);

  // Before the listing, so a reader piping the table still sees what was left out of it.
  OutputUtil.reportIgnoredTicketFiles(context, listing.malformed);

  if (shown.length === 0) {
    const narrowing = [
      listedStatus === undefined ? undefined : StatusWordingUtil.statusWordFor(listedStatus),
      writtenPriority === undefined ? undefined : `${StatusWordingUtil.priorityWordFor(writtenPriority)} priority`,
    ].filter((part) => part !== undefined);
    OutputUtil.printEntity(
      commandArguments,
      context,
      [],
      narrowing.length === 0 ? 'No tickets have been filed yet.' : `No tickets are ${narrowing.join(' and ')}.`,
    );
    return;
  }

  const header = [
    OutputUtil.padColumn('id', LIST_COLUMN_WIDTHS.identifier),
    OutputUtil.padColumn('status', LIST_COLUMN_WIDTHS.status),
    OutputUtil.padColumn('priority', LIST_COLUMN_WIDTHS.priority),
    OutputUtil.padColumn('type', LIST_COLUMN_WIDTHS.type),
    OutputUtil.padColumn('task', LIST_COLUMN_WIDTHS.task),
    'title',
  ].join('');
  const rows = shown.map((ticket) => {
    const unsettled = unsettledDependenciesFor(ticket, listing.tickets);
    return [
      OutputUtil.padColumn(`#${ticket.frontmatter.id}`, LIST_COLUMN_WIDTHS.identifier),
      OutputUtil.padColumn(StatusWordingUtil.statusWordFor(ticket.frontmatter.status), LIST_COLUMN_WIDTHS.status),
      OutputUtil.padColumn(StatusWordingUtil.priorityWordFor(TicketDefaultsUtil.ticketPriorityOf(ticket.frontmatter)), LIST_COLUMN_WIDTHS.priority),
      OutputUtil.padColumn(StatusWordingUtil.ticketTypeWordFor(ticket.frontmatter.type), LIST_COLUMN_WIDTHS.type),
      OutputUtil.padColumn(ticket.frontmatter.task === null ? '-' : `#${ticket.frontmatter.task}`, LIST_COLUMN_WIDTHS.task),
      ticket.frontmatter.title,
      namedAgentText(ticket.frontmatter),
      ticketIsStillOpen(ticket) && unsettled.length > 0 ? `  (${TicketPhraseUtil.waitingOnText(unsettled)})` : '',
    ].join('');
  });
  OutputUtil.printEntity(commandArguments, context, shown.map(TicketJsonUtil.ticketDocumentOf), [header, ...rows].join('\n'));
}

function dependencyStatusText(status: TicketStatus | undefined): string {
  return status === undefined ? 'missing' : StatusWordingUtil.statusWordFor(status);
}

async function showOneTicket(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(SHOW_OPTION_NAMES, TICKET_USAGE);
  commandArguments.rejectExtraPositionals(2, TICKET_USAGE);

  const reference = commandArguments.positionals()[1];
  if (reference === undefined) {
    throw new OperationRefusal('refused', `agent-progress ticket show needs a ticket id.\n  Usage: ${TICKET_USAGE}`);
  }

  const workspace = requireWorkspace(context.currentDirectory);
  const ticket    = requireTicketToShow(workspace, reference);
  const { frontmatter } = ticket;
  const statusById      = new Map(listTickets(workspace).tickets.map((candidate) => [candidate.frontmatter.id, candidate.frontmatter.status]));
  const dependencies    = (frontmatter.dependsOn ?? []).map((identifier) => `#${identifier} (${dependencyStatusText(statusById.get(identifier))})`);
  const summary = [
    `Ticket #${frontmatter.id}: ${frontmatter.title}`,
    `  status:   ${StatusWordingUtil.statusWordFor(frontmatter.status)}`,
    `  priority: ${StatusWordingUtil.priorityWordFor(TicketDefaultsUtil.ticketPriorityOf(frontmatter))}`,
    ...(frontmatter.model === undefined ? [] : [`  model:    ${frontmatter.model}`]),
    ...(frontmatter.effort === undefined ? [] : [`  effort:   ${frontmatter.effort}`]),
    ...(frontmatter.hold === undefined ? [] : [`  held:     ${frontmatter.hold === '' ? 'yes' : frontmatter.hold}`]),
    `  type:     ${StatusWordingUtil.ticketTypeWordFor(frontmatter.type)}`,
    `  group:    ${frontmatter.group ?? '-'}`,
    `  task:     ${frontmatter.task === null ? '-' : `#${frontmatter.task}`}`,
    `  waits on: ${dependencies.length === 0 ? '-' : dependencies.join(', ')}`,
    `  filed:    ${frontmatter.filed.slice(0, LIMITS.DATE_AND_CLOCK_LENGTH).replace('T', ' ')}`,
    `  updated:  ${frontmatter.updated.slice(0, LIMITS.DATE_AND_CLOCK_LENGTH).replace('T', ' ')}`,
    `  branch:   ${frontmatter.branch ?? '-'}`,
    `  commit:   ${frontmatter.commit ?? '-'}`,
    `  reason:   ${frontmatter.reason ?? '-'}`,
    `  file:     ${ticket.filePath}`,
  ].join('\n');
  OutputUtil.printEntity(commandArguments, context, TicketOutputUtil.ticketAsJson(ticket), `${summary}\n\n${ticket.body}`);
}

export const TICKET_READING_SUBCOMMANDS: Readonly<Record<string, TicketSubcommandHandler>> = { list: listAllTickets, show: showOneTicket };
