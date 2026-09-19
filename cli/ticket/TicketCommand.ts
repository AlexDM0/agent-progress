/** The named verbs enforce the legality matrix of `lib/tickets/TicketTransitions.ts`; `ticket status` is the documented override that skips it. */
import { readFileSync } from 'node:fs';
import { join }         from 'node:path';

import { DATE_AND_CLOCK_LENGTH } from '../../lib/constants/Limits';
import {
  TICKET_STATUSES,
  TICKET_TYPES,
  ticketStatusIsKnown,
  ticketTypeIsKnown
}                                                from '../../lib/constants/Statuses';
import type { Ticket, TicketStatus, TicketType }   from '../../lib/constants/Types';
import { OperationRefusal }                        from '../../lib/platform/OperationRefusal';
import { requireWorkspace, type Workspace }        from '../../lib/platform/Workspace';
import { appendLogEntry, findTask, setTaskTokens } from '../../lib/progress/ProgressStore';
import {
  createTicket,
  listTickets,
  nextTicketId,
  readTicket
}                                                from '../../lib/tickets/TicketStore';
import {
  LEGAL_SOURCE_STATUSES_FOR_TICKET_STATUS,
  applyTicketTransition,
  ensureTaskForTicket,
  ticketMoveIsLegal
}                                                               from '../../lib/tickets/TicketTransitions';
import { TokenCountUtil }                                         from '../../lib/utils/TokenCountUtil';
import type { CommandContext }                                    from '../CommandContext';
import { openTrackerForWriting, printEntity, progressOperations } from '../CommandSupport';
import type { CommandHandler }                                    from '../CommandTable';
import type { ArgumentParser }                                    from '../arguments/ArgumentParser';

const USAGE = [
  'agent-progress ticket add "<title>" [--type bug|change|feature] [--group <name>] [--body <markdown> | --body-file <path|->] [--at <when>]',
  'agent-progress ticket list [--status <s>] [--json]',
  'agent-progress ticket show <id> [--json]',
  'agent-progress ticket start|review|done|deliver|abandon|reopen <id> [--branch <b>] [--commit <sha>] [--reason <text>] [--tokens <n>] [--at <when>]',
  'agent-progress ticket status <id> <status> [...same options]',
  'agent-progress ticket link <ticketId> <taskId> [--force]',
].join('\n         ');

const TRANSITION_SUBCOMMANDS: Record<string, TicketStatus> = {
  start:   'in-progress',
  review:  'in-review',
  done:    'done',
  deliver: 'delivered',
  abandon: 'abandoned',
  reopen:  'open',
};

const ADD_OPTION_NAMES        = ['type', 'group', 'body', 'body-file', 'at', 'json'];
const LIST_OPTION_NAMES       = ['status', 'json'];
const SHOW_OPTION_NAMES       = ['json'];
const TRANSITION_OPTION_NAMES = ['branch', 'commit', 'reason', 'at', 'tokens', 'json'];
const LINK_OPTION_NAMES       = ['force', 'json'];

const TRANSITION_WORD_FOR_TICKET_STATUS: Record<TicketStatus, string> = {
  'open':        'reopen',
  'in-progress': 'start',
  'in-review':   'review',
  'done':        'done',
  'delivered':   'deliver',
  'abandoned':   'abandon',
};

const DEFAULT_TICKET_TYPE: TicketType = 'change';


const STANDARD_INPUT_MARKER = '-';

/** Relative to this module, not the caller's working directory: the binary is `bun link`ed. */
const TICKET_BODY_TEMPLATE_PATH = ['..', '..', 'templates', 'TicketBody.md'];

const TICKET_TEMPLATE_PLACEHOLDERS = { id: '{{id}}', title: '{{title}}' } as const;

const LIST_COLUMN_WIDTHS = {
  identifier: 6,
  status:     12,
  type:       8,
  task:       6,
};

function padColumn(text: string, width: number): string {
  return text.length >= width ? `${text} ` : text.padEnd(width);
}

async function bodyForNewTicket(commandArguments: ArgumentParser, identifier: string, title: string): Promise<string> {
  const supplied = await suppliedBodyFor(commandArguments);
  if (supplied !== undefined && supplied.trim() !== '') return supplied;

  return readFileSync(join(import.meta.dir, ...TICKET_BODY_TEMPLATE_PATH), 'utf8')
    .split(TICKET_TEMPLATE_PLACEHOLDERS.id).join(identifier)
    .split(TICKET_TEMPLATE_PLACEHOLDERS.title).join(title);
}


async function suppliedBodyFor(commandArguments: ArgumentParser): Promise<string | undefined> {
  const written = commandArguments.option('body');
  if (written !== undefined) return written;

  const bodyFile = commandArguments.option('body-file');
  if (bodyFile === STANDARD_INPUT_MARKER) return Bun.stdin.text();
  if (bodyFile === undefined) return undefined;
  try {
    return readFileSync(bodyFile, 'utf8');
  } catch (problem) {
    throw new OperationRefusal('refused', `--body-file ${bodyFile} could not be read: ${problem instanceof Error ? problem.message : String(problem)}`);
  }
}

function requireTicket(workspace: Workspace, reference: string): Ticket {
  const ticket = readTicket(workspace, reference);
  if (ticket === null) {
    throw new OperationRefusal(
      'refused',
      `There is no readable ticket ${reference}. Run \`agent-progress ticket list\` to see what this tracker holds; `
      + 'a file that will not parse is reported there as malformed.',
    );
  }
  return ticket;
}

function ticketAsJson(ticket: Ticket): Record<string, unknown> {
  return { ...ticket.frontmatter, filePath: ticket.filePath, body: ticket.body };
}

function ticketRowAsJson(ticket: Ticket): Record<string, unknown> {
  return { ...ticket.frontmatter, filePath: ticket.filePath };
}

function tokenCountFrom(commandArguments: ArgumentParser): number | undefined {
  const written = commandArguments.option('tokens');
  if (written === undefined) return undefined;

  const count = TokenCountUtil.parseTokenCount(written);
  if (count === null) {
    throw new OperationRefusal(
      'refused',
      `--tokens "${written}" is not a token count. Write a whole number, or a decimal with a \`k\` or \`m\` suffix: \`12000\`, \`12k\`, \`12.3k\`, \`1.2m\`.`,
    );
  }
  return count;
}

async function addOneTicket(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(ADD_OPTION_NAMES, USAGE);
  commandArguments.rejectExtraPositionals(2, USAGE);

  const title = commandArguments.positionals()[1];
  if (title === undefined || title.trim() === '') {
    throw new OperationRefusal('refused', `agent-progress ticket add needs a title.\n  Usage: ${USAGE}`);
  }
  const writtenType = commandArguments.option('type');
  if (writtenType !== undefined && !ticketTypeIsKnown(writtenType)) {
    throw new OperationRefusal('refused', `"${writtenType}" is not a ticket type. The types are ${TICKET_TYPES.join(', ')}.`);
  }
  const type  = writtenType !== undefined && ticketTypeIsKnown(writtenType) ? writtenType : DEFAULT_TICKET_TYPE;
  const group = commandArguments.option('group');

  // Resolved before the lock: `--body-file -` waits on a pipe the caller may hold open indefinitely.
  const workspace  = requireWorkspace(context.currentDirectory);
  const identifier = nextTicketId(workspace);
  const body       = await bodyForNewTicket(commandArguments, identifier, title);

  const ticket = await openTrackerForWriting(commandArguments, context, (change) => {
    const filed = createTicket(change.workspace, {
      title,
      type,
      ...(group === undefined ? {} : { group }),
      body,
      at: change.at,
    });
    ensureTaskForTicket({ progress: change.progress, ticket: filed, operations: progressOperations });
    appendLogEntry(change.progress, change.at, `Ticket #${filed.frontmatter.id} filed: ${title}`);
    change.writeTicketAfterwards(filed);
    return filed;
  });

  printEntity(
    commandArguments,
    context,
    ticketAsJson(ticket),
    `Ticket #${ticket.frontmatter.id} filed: ${ticket.frontmatter.title}\n  ${ticket.filePath}`,
  );
}

function listAllTickets(commandArguments: ArgumentParser, context: CommandContext): void {
  commandArguments.rejectUnknownOptions(LIST_OPTION_NAMES, USAGE);
  commandArguments.rejectExtraPositionals(1, USAGE);

  const writtenStatus = commandArguments.option('status');
  if (writtenStatus !== undefined && !ticketStatusIsKnown(writtenStatus)) {
    throw new OperationRefusal('refused', `"${writtenStatus}" is not a ticket status. The statuses are ${TICKET_STATUSES.join(', ')}.`);
  }

  const workspace = requireWorkspace(context.currentDirectory);
  const listing   = listTickets(workspace);
  const shown     = writtenStatus === undefined ? listing.tickets : listing.tickets.filter((ticket) => ticket.frontmatter.status === writtenStatus);

  // Before the listing, so a reader piping the table still sees what was left out of it.
  for (const malformed of listing.malformed) {
    const place = malformed.line > 0 ? ` (line ${malformed.line})` : '';
    context.standardError(`Ticket file ignored: ${malformed.filePath}${place}: ${malformed.reason}`);
  }

  if (shown.length === 0) {
    printEntity(
      commandArguments,
      context,
      [],
      writtenStatus === undefined ? 'No tickets have been filed yet.' : `No tickets are ${writtenStatus}.`,
    );
    return;
  }

  const header = [
    padColumn('id', LIST_COLUMN_WIDTHS.identifier),
    padColumn('status', LIST_COLUMN_WIDTHS.status),
    padColumn('type', LIST_COLUMN_WIDTHS.type),
    padColumn('task', LIST_COLUMN_WIDTHS.task),
    'title',
  ].join('');
  const rows = shown.map((ticket) => [
    padColumn(`#${ticket.frontmatter.id}`, LIST_COLUMN_WIDTHS.identifier),
    padColumn(ticket.frontmatter.status, LIST_COLUMN_WIDTHS.status),
    padColumn(ticket.frontmatter.type, LIST_COLUMN_WIDTHS.type),
    padColumn(ticket.frontmatter.task === null ? '-' : `#${ticket.frontmatter.task}`, LIST_COLUMN_WIDTHS.task),
    ticket.frontmatter.title,
  ].join(''));
  printEntity(commandArguments, context, shown.map(ticketRowAsJson), [header, ...rows].join('\n'));
}

function showOneTicket(commandArguments: ArgumentParser, context: CommandContext): void {
  commandArguments.rejectUnknownOptions(SHOW_OPTION_NAMES, USAGE);
  commandArguments.rejectExtraPositionals(2, USAGE);

  const reference = commandArguments.positionals()[1];
  if (reference === undefined) {
    throw new OperationRefusal('refused', `agent-progress ticket show needs a ticket id.\n  Usage: ${USAGE}`);
  }

  const workspace = requireWorkspace(context.currentDirectory);
  const ticket    = requireTicket(workspace, reference);
  const { frontmatter } = ticket;
  const summary = [
    `Ticket #${frontmatter.id}: ${frontmatter.title}`,
    `  status:   ${frontmatter.status}`,
    `  type:     ${frontmatter.type}`,
    `  group:    ${frontmatter.group ?? '-'}`,
    `  task:     ${frontmatter.task === null ? '-' : `#${frontmatter.task}`}`,
    `  filed:    ${frontmatter.filed.slice(0, DATE_AND_CLOCK_LENGTH).replace('T', ' ')}`,
    `  updated:  ${frontmatter.updated.slice(0, DATE_AND_CLOCK_LENGTH).replace('T', ' ')}`,
    `  branch:   ${frontmatter.branch ?? '-'}`,
    `  commit:   ${frontmatter.commit ?? '-'}`,
    `  reason:   ${frontmatter.reason ?? '-'}`,
    `  file:     ${ticket.filePath}`,
  ].join('\n');
  printEntity(commandArguments, context, ticketAsJson(ticket), `${summary}\n\n${ticket.body}`);
}

async function transitionOneTicket(
  targetStatus: TicketStatus,
  reference: string,
  commandArguments: ArgumentParser,
  context: CommandContext,
  checksTheMatrix: boolean,
): Promise<void> {
  const branch = commandArguments.option('branch');
  const commit = commandArguments.option('commit');
  const reason = commandArguments.option('reason');
  const tokens = tokenCountFrom(commandArguments);

  const moved = await openTrackerForWriting(commandArguments, context, (change) => {
    const ticket = requireTicket(change.workspace, reference);
    refuseAnIllegalMove(ticket, targetStatus, checksTheMatrix);

    const outcome = applyTicketTransition({
      progress:   change.progress,
      ticket,
      targetStatus,
      at:         change.at,
      operations: progressOperations,
      ...(branch === undefined ? {} : { branch }),
      ...(commit === undefined ? {} : { commit }),
      ...(reason === undefined ? {} : { reason }),
    });
    if (outcome.verdict === 'refused') {
      throw new OperationRefusal(
        'refused',
        `Ticket #${ticket.frontmatter.id} was not moved: ${outcome.reason}. `
        + 'Say why the work was dropped, for example `agent-progress ticket abandon 3 --reason "superseded by #7"`.',
      );
    }
    // After the transition, which is what guarantees the ticket has a row to write to at all.
    if (tokens !== undefined && outcome.ticket.frontmatter.task !== null) {
      setTaskTokens(change.progress, outcome.ticket.frontmatter.task, tokens);
    }
    change.writeTicketAfterwards(outcome.ticket);
    return { logText: outcome.logText, ticket: outcome.ticket };
  });

  printEntity(commandArguments, context, ticketAsJson(moved.ticket), moved.logText);
}

function refuseAnIllegalMove(ticket: Ticket, targetStatus: TicketStatus, checksTheMatrix: boolean): void {
  const { id, status } = ticket.frontmatter;

  if (status === targetStatus) {
    throw new OperationRefusal('refused', `Ticket #${id} is already ${targetStatus}, so nothing was changed and nothing was logged.`);
  }
  if (!checksTheMatrix || ticketMoveIsLegal(status, targetStatus)) return;

  const legalSources = LEGAL_SOURCE_STATUSES_FOR_TICKET_STATUS[targetStatus].join(' or ');
  throw new OperationRefusal(
    'refused',
    `Ticket #${id} is ${status}, and \`agent-progress ticket ${TRANSITION_WORD_FOR_TICKET_STATUS[targetStatus]}\` moves a ticket that is ${legalSources}. `
    + `Run \`agent-progress ticket status ${id} ${targetStatus}\` if you mean to set it directly.`,
  );
}

async function linkOneTicket(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(LINK_OPTION_NAMES, USAGE);
  commandArguments.rejectExtraPositionals(3, USAGE);

  const [, ticketReference, taskReference] = commandArguments.positionals();
  if (ticketReference === undefined || taskReference === undefined) {
    throw new OperationRefusal('refused', `agent-progress ticket link needs a ticket id and a task id.\n  Usage: ${USAGE}`);
  }
  const taskId = Number(taskReference);
  if (!Number.isSafeInteger(taskId) || taskId <= 0) {
    throw new OperationRefusal('refused', `"${taskReference}" is not a task id. A task id is the whole number shown beside the row.`);
  }
  const movesTheLink = commandArguments.flag('force');

  const linked = await openTrackerForWriting(commandArguments, context, (change) => {
    const {
      progress,
      workspace,
      writeTicketAfterwards,
    } = change;
    const ticket = requireTicket(workspace, ticketReference);
    const task   = findTask(progress, taskId);
    if (task === undefined) {
      throw new OperationRefusal('refused', `There is no task #${taskId}. Run \`agent-progress status\` to see the rows this tracker holds.`);
    }

    if (task.ticket !== null && task.ticket !== ticket.frontmatter.id) {
      if (!movesTheLink) {
        throw new OperationRefusal(
          'refused',
          `Task #${taskId} already belongs to ticket #${task.ticket}. Pass --force to move it to ticket #${ticket.frontmatter.id}.`,
        );
      }
      const previousOwner = readTicket(workspace, task.ticket);
      if (previousOwner !== null && previousOwner.frontmatter.task === taskId) {
        previousOwner.frontmatter.task = null;
        writeTicketAfterwards(previousOwner);
      }
    }

    if (ticket.frontmatter.task !== null && ticket.frontmatter.task !== taskId) {
      const abandonedRow = findTask(progress, ticket.frontmatter.task);
      if (abandonedRow !== undefined) abandonedRow.ticket = null;
    }

    task.ticket             = ticket.frontmatter.id;
    ticket.frontmatter.task = taskId;
    writeTicketAfterwards(ticket);
    return ticket;
  });

  printEntity(commandArguments, context, ticketAsJson(linked), `Ticket #${linked.frontmatter.id} linked to task #${taskId}`);
}

async function setTicketStatus(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(TRANSITION_OPTION_NAMES, USAGE);
  commandArguments.rejectExtraPositionals(3, USAGE);

  const [, reference, writtenStatus] = commandArguments.positionals();
  if (reference === undefined || writtenStatus === undefined) {
    throw new OperationRefusal('refused', `agent-progress ticket status needs a ticket id and a status.\n  Usage: ${USAGE}`);
  }
  if (!ticketStatusIsKnown(writtenStatus)) {
    throw new OperationRefusal('refused', `"${writtenStatus}" is not a ticket status. The statuses are ${TICKET_STATUSES.join(', ')}.`);
  }
  return transitionOneTicket(writtenStatus, reference, commandArguments, context, false);
}

export const ticketCommand: CommandHandler = async (commandArguments, context) => {
  const subcommand = commandArguments.positionals()[0];

  if (subcommand === 'add') return addOneTicket(commandArguments, context);
  if (subcommand === 'link') return linkOneTicket(commandArguments, context);
  if (subcommand === 'status') return setTicketStatus(commandArguments, context);
  if (subcommand === 'list') {
    listAllTickets(commandArguments, context);
    return;
  }
  if (subcommand === 'show') {
    showOneTicket(commandArguments, context);
    return;
  }

  // `Object.hasOwn`, never a bare index: `subcommand` is argv text, and `constructor` is a truthy inherited property.
  const targetStatus = subcommand !== undefined && Object.hasOwn(TRANSITION_SUBCOMMANDS, subcommand)
    ? TRANSITION_SUBCOMMANDS[subcommand]
    : undefined;
  if (targetStatus !== undefined) {
    commandArguments.rejectUnknownOptions(TRANSITION_OPTION_NAMES, USAGE);
    commandArguments.rejectExtraPositionals(2, USAGE);
    const reference = commandArguments.positionals()[1];
    if (reference === undefined) {
      throw new OperationRefusal('refused', `agent-progress ticket ${subcommand} needs a ticket id.\n  Usage: ${USAGE}`);
    }
    return transitionOneTicket(targetStatus, reference, commandArguments, context, true);
  }

  throw new OperationRefusal(
    'refused',
    `${subcommand === undefined ? 'agent-progress ticket needs a subcommand' : `"${subcommand}" is not an agent-progress ticket subcommand`}.\n  Usage: ${USAGE}`,
  );
};
