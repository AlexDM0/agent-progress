import { TicketJsonUtil }                   from '../../src/adapters/utils/TicketJsonUtil.ts';
import type { Ticket, TicketStatus }        from '../../src/lib/tracker-model/@types/Ticket.ts';
import { TicketDefaultsUtil }               from '../../src/lib/tracker-model/utils/TicketDefaultsUtil.ts';
import { listTickets, readTicket }          from '../../src/services/tracker/TicketStore.ts';
import { requireWorkspace, type Workspace } from '../../src/services/tracker/Workspace.ts';
import { OperationRefusal }                 from '../../src/shared/OperationRefusal.ts';
import { TIMESTAMP_SLICES }                 from '../../src/shared/constants/TimestampSlices.ts';
import type { CommandContext }              from '../CommandContext.ts';
import type { ArgumentParser }              from '../arguments/ArgumentParser.ts';
import { OutputUtil }                       from '../utils/OutputUtil.ts';
import type { TicketSubcommandHandler }     from './@types/TicketSubcommandHandler.ts';
import { listAllTickets }                   from './TicketList.ts';
import { TICKET_USAGE }                     from './constants/TicketUsage.ts';
import { TicketLookupUtil }                 from './utils/TicketLookupUtil.ts';

const SHOW_OPTION_NAMES = ['json'];

/** `ticket show` changes nothing, so it reads the ticket files as they are, with no lock and no Board. */
function requireTicketToShow(workspace: Workspace, reference: string): Ticket {
  return readTicket(workspace, reference) ?? TicketLookupUtil.refuseAMissingTicket(reference, listTickets(workspace).malformed);
}

function stampText(stamp: string): string {
  return stamp.slice(0, TIMESTAMP_SLICES.DATE_AND_CLOCK_LENGTH_CHARACTERS).replace('T', ' ');
}

function summaryOf(ticket: Ticket, statusById: ReadonlyMap<string, TicketStatus>): string {
  const { frontmatter } = ticket;
  const dependencies    = (frontmatter.dependsOn ?? []).map((identifier) => `#${identifier} (${statusById.get(identifier) ?? 'missing'})`);
  return [
    `Ticket #${frontmatter.id}: ${frontmatter.title}`,
    `  status:   ${frontmatter.status}`,
    `  priority: ${TicketDefaultsUtil.ticketPriorityOf(frontmatter)}`,
    ...(frontmatter.model === undefined ? [] : [`  model:    ${frontmatter.model}`]),
    ...(frontmatter.effort === undefined ? [] : [`  effort:   ${frontmatter.effort}`]),
    ...(frontmatter.hold === undefined ? [] : [`  held:     ${frontmatter.hold === '' ? 'yes' : frontmatter.hold}`]),
    `  type:     ${frontmatter.type}`,
    `  group:    ${frontmatter.group ?? '-'}`,
    ...(frontmatter.epics === undefined ? [] : [`  epics:    ${frontmatter.epics.join(', ')}`]),
    `  task:     ${frontmatter.task === null ? '-' : `#${frontmatter.task}`}`,
    `  waits on: ${dependencies.length === 0 ? '-' : dependencies.join(', ')}`,
    `  filed:    ${stampText(frontmatter.filed)}`,
    `  updated:  ${stampText(frontmatter.updated)}`,
    `  branch:   ${frontmatter.branch ?? '-'}`,
    `  commit:   ${frontmatter.commit ?? '-'}`,
    `  reason:   ${frontmatter.reason ?? '-'}`,
    `  file:     ${ticket.filePath}`,
  ].join('\n');
}

async function showOneTicket(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(SHOW_OPTION_NAMES, TICKET_USAGE);
  commandArguments.rejectExtraPositionals(2, TICKET_USAGE);

  const reference = commandArguments.positionals()[1];
  if (reference === undefined) {
    throw new OperationRefusal('refused', `agent-progress ticket show needs a ticket id.\n  Usage: ${TICKET_USAGE}`);
  }

  const workspace  = requireWorkspace(context.currentDirectory);
  const ticket     = requireTicketToShow(workspace, reference);
  const statusById = new Map(listTickets(workspace).tickets.map((candidate) => [candidate.frontmatter.id, candidate.frontmatter.status]));
  OutputUtil.printEntity(commandArguments, context, TicketJsonUtil.ticketAsJson(ticket), `${summaryOf(ticket, statusById)}\n\n${ticket.body}`);
}

export const TICKET_READING_SUBCOMMANDS: Readonly<Record<string, TicketSubcommandHandler>> = { list: listAllTickets, show: showOneTicket };
