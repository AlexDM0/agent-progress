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
import type { Ticket, TicketStatus, TicketType } from '../../lib/constants/Types';
import { OperationRefusal }                      from '../../lib/platform/OperationRefusal';
import { requireWorkspace, type Workspace }      from '../../lib/platform/Workspace';
import {
  appendLogEntry,
  concurrencyOf,
  findTask,
  setTaskTokens
}                                                from '../../lib/progress/ProgressStore';
import {
  createTicket,
  listTickets,
  nextTicketId,
  readTicket
}                                                from '../../lib/tickets/TicketStore';
import {
  LEGAL_SOURCE_STATUSES_FOR_TICKET_STATUS,
  applyTicketRereview,
  applyTicketTransition,
  ensureTaskForTicket,
  ticketMoveIsLegal
}                                                               from '../../lib/tickets/TicketTransitions';
import { TicketDependencyUtil } from '../../lib/utils/TicketDependencyUtil';
import { TicketIdUtil }         from '../../lib/utils/TicketIdUtil';
import { TokenCountUtil }       from '../../lib/utils/TokenCountUtil';
import type { CommandContext }  from '../CommandContext';
import {
  openTrackerForWriting,
  openTrackerForWritingThenReadNextLine,
  printEntity,
  printEntityThenNextLine,
  progressOperations
}                                                                 from '../CommandSupport';
import type { CommandHandler } from '../CommandTable';
import type { ArgumentParser } from '../arguments/ArgumentParser';

const USAGE = [
  'agent-progress ticket add "<title>" [--type bug|change|feature] [--group <name>] [--depends-on <ids>] [--body <markdown> | --body-file <path|->] [--at <when>]',
  'agent-progress ticket list [--status <s>] [--json]',
  'agent-progress ticket show <id> [--json]',
  'agent-progress ticket start|review|done|deliver|abandon|reopen <id> [--branch <b>] [--commit <sha>] [--reason <text>] [--tokens <n>] [--at <when>]',
  'agent-progress ticket claim <id> [--owner <who>] [--note <text>] [--at <when>]',
  'agent-progress ticket rereview <id> [--at <when>]',
  'agent-progress ticket status <id> <status> [...same options]',
  'agent-progress ticket link <ticketId> <taskId> [--force]',
  'agent-progress ticket depends <id> [<id>...]',
].join('\n         ');

const TRANSITION_SUBCOMMANDS: Record<string, TicketStatus> = {
  start:   'in-progress',
  review:  'in-review',
  done:    'done',
  deliver: 'delivered',
  abandon: 'abandoned',
  reopen:  'open',
};

const ADD_OPTION_NAMES        = ['type', 'group', 'depends-on', 'body', 'body-file', 'at', 'json'];
const LIST_OPTION_NAMES       = ['status', 'json'];
const SHOW_OPTION_NAMES       = ['json'];
const TRANSITION_OPTION_NAMES = ['branch', 'commit', 'reason', 'at', 'tokens', 'json'];
const CLAIM_OPTION_NAMES      = ['owner', 'note', 'at', 'json'];
const REREVIEW_OPTION_NAMES   = ['at', 'json'];
const LINK_OPTION_NAMES       = ['force', 'json'];
const DEPENDS_OPTION_NAMES    = ['json'];

const DEPENDENCY_SEPARATOR_PATTERN = /[\s,]+/;

const TRANSITION_WORD_FOR_TICKET_STATUS: Record<TicketStatus, string> = {
  'open':        'reopen',
  'in-progress': 'start',
  'in-review':   'review',
  'done':        'done',
  'delivered':   'deliver',
  'abandoned':   'abandon',
};

const DEFAULT_TICKET_TYPE: TicketType = 'change';

const TICKET_STATUSES_THAT_CLOSE_A_TICKET: readonly TicketStatus[] = ['done', 'delivered', 'abandoned'];


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

function dependencyListFrom(texts: readonly string[]): string[] {
  const dependsOn: string[] = [];
  for (const reference of texts.flatMap((text) => text.split(DEPENDENCY_SEPARATOR_PATTERN)).filter((part) => part !== '')) {
    const identifier = TicketIdUtil.parseTicketReference(reference);
    if (identifier === null) {
      throw new OperationRefusal('refused', `"${reference}" is not a ticket id. Write it as \`3\`, \`003\` or \`#3\`.`);
    }
    if (!dependsOn.includes(identifier)) dependsOn.push(identifier);
  }
  return dependsOn;
}

function refuseAnUnworkableDependencyList(ticketId: string, dependsOn: readonly string[], tickets: readonly Ticket[]): void {
  const known   = new Set(tickets.map((ticket) => ticket.frontmatter.id));
  const missing = dependsOn.filter((identifier) => !known.has(identifier));
  if (missing.length > 0) {
    const named = missing.map((identifier) => `#${identifier}`).join(', ');
    throw new OperationRefusal('refused', `There is no ticket ${named}. Run \`agent-progress ticket list\` to see what this tracker holds.`);
  }
  const dependsOnById = new Map(tickets.map((ticket) => [ticket.frontmatter.id, ticket.frontmatter.dependsOn ?? []]));
  const loop          = TicketDependencyUtil.dependencyLoopFrom(ticketId, dependsOn, dependsOnById);
  if (loop !== null) {
    throw new OperationRefusal('refused', `That would make tickets wait on each other in a circle: ${loop.map((identifier) => `#${identifier}`).join(' → ')}.`);
  }
}

function unsettledDependenciesFor(ticket: Ticket, tickets: readonly Ticket[]): string[] {
  const statusById = new Map(tickets.map((candidate) => [candidate.frontmatter.id, candidate.frontmatter.status]));
  return TicketDependencyUtil.unsettledDependenciesOf(ticket.frontmatter.dependsOn ?? [], statusById);
}

function ticketIsStillOpen(ticket: Ticket): boolean {
  return !TICKET_STATUSES_THAT_CLOSE_A_TICKET.includes(ticket.frontmatter.status);
}

function waitingOnText(identifiers: readonly string[]): string {
  return `waiting on ${identifiers.map((identifier) => `#${identifier}`).join(', ')}`;
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
  const type      = writtenType !== undefined && ticketTypeIsKnown(writtenType) ? writtenType : DEFAULT_TICKET_TYPE;
  const group     = commandArguments.option('group');
  const dependsOn = dependencyListFrom([commandArguments.option('depends-on') ?? '']);

  // Resolved before the lock: `--body-file -` waits on a pipe the caller may hold open indefinitely.
  const workspace  = requireWorkspace(context.currentDirectory);
  const identifier = nextTicketId(workspace);
  const body       = await bodyForNewTicket(commandArguments, identifier, title);

  const { result: ticket, nextLine } = await openTrackerForWritingThenReadNextLine(commandArguments, context, (change) => {
    // A ticket that does not exist yet has nobody waiting on it, so only the ids themselves can be wrong.
    refuseAnUnworkableDependencyList(identifier, dependsOn, listTickets(change.workspace).tickets);
    const filed = createTicket(change.workspace, {
      title,
      type,
      ...(group === undefined ? {} : { group }),
      body,
      at: change.at,
    });
    if (dependsOn.length > 0) filed.frontmatter.dependsOn = dependsOn;
    ensureTaskForTicket({
      progress:   change.progress,
      ticket:     filed,
      operations: progressOperations,
      at:         change.at,
    });
    appendLogEntry(change.progress, change.at, `Ticket #${filed.frontmatter.id} filed: ${title}`);
    change.writeTicketAfterwards(filed);
    return filed;
  });

  printEntityThenNextLine(
    commandArguments,
    context,
    ticketAsJson(ticket),
    `Ticket #${ticket.frontmatter.id} filed: ${ticket.frontmatter.title}\n  ${ticket.filePath}`,
    nextLine,
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
  const rows = shown.map((ticket) => {
    const unsettled = unsettledDependenciesFor(ticket, listing.tickets);
    return [
      padColumn(`#${ticket.frontmatter.id}`, LIST_COLUMN_WIDTHS.identifier),
      padColumn(ticket.frontmatter.status, LIST_COLUMN_WIDTHS.status),
      padColumn(ticket.frontmatter.type, LIST_COLUMN_WIDTHS.type),
      padColumn(ticket.frontmatter.task === null ? '-' : `#${ticket.frontmatter.task}`, LIST_COLUMN_WIDTHS.task),
      ticket.frontmatter.title,
      ticketIsStillOpen(ticket) && unsettled.length > 0 ? `  (${waitingOnText(unsettled)})` : '',
    ].join('');
  });
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
  const statusById      = new Map(listTickets(workspace).tickets.map((candidate) => [candidate.frontmatter.id, candidate.frontmatter.status]));
  const dependencies    = (frontmatter.dependsOn ?? []).map((identifier) => `#${identifier} (${statusById.get(identifier) ?? 'missing'})`);
  const summary = [
    `Ticket #${frontmatter.id}: ${frontmatter.title}`,
    `  status:   ${frontmatter.status}`,
    `  type:     ${frontmatter.type}`,
    `  group:    ${frontmatter.group ?? '-'}`,
    `  task:     ${frontmatter.task === null ? '-' : `#${frontmatter.task}`}`,
    `  waits on: ${dependencies.length === 0 ? '-' : dependencies.join(', ')}`,
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

  const { result: moved, nextLine } = await openTrackerForWritingThenReadNextLine(commandArguments, context, (change) => {
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
    return {
      logText:   outcome.logText,
      ticket:    outcome.ticket,
      unsettled: unsettledDependenciesFor(outcome.ticket, listTickets(change.workspace).tickets),
    };
  });

  printEntityThenNextLine(commandArguments, context, ticketAsJson(moved.ticket), moved.logText, nextLine);

  // A warning, not a refusal: the order is advice to whoever picks work up, and the user may know better.
  if (targetStatus === 'in-progress' && moved.unsettled.length > 0) {
    const notDoneYet = moved.unsettled.length === 1 ? 'which is not done yet' : 'which are not done yet';
    context.standardError(`Ticket #${moved.ticket.frontmatter.id} is ${waitingOnText(moved.unsettled)}, ${notDoneYet}.`);
  }
}

/** The one verb that may be run on the status the ticket already has: a further review pass is still review. */
async function rereviewOneTicket(reference: string, commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  const { result: moved, nextLine } = await openTrackerForWritingThenReadNextLine(commandArguments, context, (change) => {
    const ticket  = requireTicket(change.workspace, reference);
    const outcome = applyTicketRereview({
      progress:   change.progress,
      ticket,
      at:         change.at,
      operations: progressOperations,
    });
    if (outcome.verdict === 'refused') {
      const { id, status } = ticket.frontmatter;
      const firstReviewAdvice = ticketMoveIsLegal(status, 'in-review') ? ` Run \`agent-progress ticket review ${id}\` to send it to its first reviewer.` : '';
      throw new OperationRefusal('refused', `Ticket #${id} is ${status}, and ${outcome.reason}.${firstReviewAdvice}`);
    }
    change.writeTicketAfterwards(outcome.ticket);
    return { logText: outcome.logText, ticket: outcome.ticket };
  });

  printEntityThenNextLine(commandArguments, context, ticketAsJson(moved.ticket), moved.logText, nextLine);
}

/**
 * `ticket start` plus the row's owner and note, refused rather than warned: every check and the move share one lock hold, so two claims
 * racing for the last slot cannot both pass the count.
 */
async function claimOneTicket(reference: string, commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  const owner = commandArguments.option('owner');
  const note  = commandArguments.option('note');

  const { result: claimed, nextLine } = await openTrackerForWritingThenReadNextLine(commandArguments, context, (change) => {
    const ticket         = requireTicket(change.workspace, reference);
    const { id, status } = ticket.frontmatter;
    if (!ticketMoveIsLegal(status, 'in-progress')) {
      const legalSources = LEGAL_SOURCE_STATUSES_FOR_TICKET_STATUS['in-progress'].join(' or ');
      throw new OperationRefusal('refused', `Ticket #${id} is ${status}, and \`agent-progress ticket claim\` takes a ticket that is ${legalSources}. Nothing was written.`);
    }
    const unsettled = unsettledDependenciesFor(ticket, listTickets(change.workspace).tickets);
    if (unsettled.length > 0) {
      throw new OperationRefusal('refused', `Ticket #${id} is ${waitingOnText(unsettled)}, which must be done or delivered before it is claimed. Nothing was written.`);
    }
    const { inFlight, limit } = concurrencyOf(change.progress);
    if (inFlight >= limit) {
      throw new OperationRefusal(
        'refused',
        `Ticket #${id} was not claimed: ${inFlight} rows are running and the concurrency limit is ${limit}. `
        + 'Nothing was written; claim it once a running row has moved on.',
      );
    }

    const outcome = applyTicketTransition({
      progress:     change.progress,
      ticket,
      targetStatus: 'in-progress',
      at:           change.at,
      operations:   progressOperations,
    });
    if (outcome.verdict === 'refused') throw new OperationRefusal('refused', `Ticket #${id} was not claimed: ${outcome.reason}.`);
    const row = outcome.ticket.frontmatter.task === null ? undefined : findTask(change.progress, outcome.ticket.frontmatter.task);
    if (row !== undefined && owner !== undefined) row.owner = owner;
    if (row !== undefined && note !== undefined) row.note = note;
    change.writeTicketAfterwards(outcome.ticket);
    return { logText: outcome.logText, ticket: outcome.ticket, concurrency: concurrencyOf(change.progress) };
  });

  const { concurrency, logText, ticket } = claimed;
  printEntityThenNextLine(
    commandArguments,
    context,
    ticketAsJson(ticket),
    `${logText}: ${concurrency.inFlight} of ${concurrency.limit} slots are now taken.`,
    nextLine,
  );
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

async function setTicketDependencies(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(DEPENDS_OPTION_NAMES, USAGE);

  const [, reference, ...dependencyTexts] = commandArguments.positionals();
  if (reference === undefined) {
    throw new OperationRefusal('refused', `agent-progress ticket depends needs a ticket id, then the ids it waits on (none clears the list).\n  Usage: ${USAGE}`);
  }
  const dependsOn = dependencyListFrom(dependencyTexts);

  const changed = await openTrackerForWriting(commandArguments, context, (change) => {
    const ticket = requireTicket(change.workspace, reference);
    refuseAnUnworkableDependencyList(ticket.frontmatter.id, dependsOn, listTickets(change.workspace).tickets);

    if (dependsOn.length === 0) {
      delete ticket.frontmatter.dependsOn;
    } else {
      ticket.frontmatter.dependsOn = dependsOn;
    }
    const logText = dependsOn.length === 0
      ? `Ticket #${ticket.frontmatter.id} waits on no other ticket`
      : `Ticket #${ticket.frontmatter.id} waits on ${dependsOn.map((identifier) => `#${identifier}`).join(', ')}`;
    appendLogEntry(change.progress, change.at, logText);
    change.writeTicketAfterwards(ticket);
    return { ticket, logText };
  });

  printEntity(commandArguments, context, ticketAsJson(changed.ticket), changed.logText);
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
  if (subcommand === 'depends') return setTicketDependencies(commandArguments, context);
  if (subcommand === 'status') return setTicketStatus(commandArguments, context);
  if (subcommand === 'claim') {
    commandArguments.rejectUnknownOptions(CLAIM_OPTION_NAMES, USAGE);
    commandArguments.rejectExtraPositionals(2, USAGE);
    const reference = commandArguments.positionals()[1];
    if (reference === undefined) {
      throw new OperationRefusal('refused', `agent-progress ticket claim needs a ticket id.\n  Usage: ${USAGE}`);
    }
    return claimOneTicket(reference, commandArguments, context);
  }
  if (subcommand === 'rereview') {
    commandArguments.rejectUnknownOptions(REREVIEW_OPTION_NAMES, USAGE);
    commandArguments.rejectExtraPositionals(2, USAGE);
    const reference = commandArguments.positionals()[1];
    if (reference === undefined) {
      throw new OperationRefusal('refused', `agent-progress ticket rereview needs a ticket id.\n  Usage: ${USAGE}`);
    }
    return rereviewOneTicket(reference, commandArguments, context);
  }
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
