/** The named verbs enforce the legality matrix of `lib/tickets/TicketTransitions.ts`; `ticket status` is the documented override that skips it. */
import { readFileSync }  from 'node:fs';
import { join, resolve } from 'node:path';

import {
  AGENT_EFFORTS,
  AGENT_MODELS,
  agentEffortIsKnown,
  agentEffortOf,
  agentModelIsKnown,
  agentModelOf
}                                from '../../lib/constants/AgentSettings';
import { DATE_AND_CLOCK_LENGTH } from '../../lib/constants/Limits';
import {
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  TICKET_TYPES,
  ticketPriorityIsKnown,
  ticketPriorityOf,
  ticketStatusIsKnown,
  ticketTypeIsKnown
}                                                from '../../lib/constants/Statuses';
import type {
  AgentEffort,
  AgentModel,
  ProgressFile,
  Task,
  Ticket,
  TicketPriority,
  TicketStatus,
  TicketType
}                                                from '../../lib/constants/Types';
import { OperationRefusal }                 from '../../lib/platform/OperationRefusal';
import { requireWorkspace, type Workspace } from '../../lib/platform/Workspace';
import {
  addTask,
  appendLogEntry,
  concurrencyOf,
  findTask,
  runningReviewRowsOf,
  setTaskTokens,
  transitionTask
}                                                from '../../lib/progress/ProgressStore';
import { createTicket, listTickets, readTicket } from '../../lib/tickets/TicketStore';
import {
  LEGAL_SOURCE_STATUSES_FOR_TICKET_STATUS,
  applyTicketPriority,
  applyTicketRereview,
  applyTicketTransition,
  ensureTaskForTicketOnTheChart,
  ticketMoveIsLegal
}                                                               from '../../lib/tickets/TicketTransitions';
import { NextLineUtil }         from '../../lib/utils/NextLineUtil';
import { TicketDependencyUtil } from '../../lib/utils/TicketDependencyUtil';
import { TicketIdUtil }         from '../../lib/utils/TicketIdUtil';
import type { CommandContext }  from '../CommandContext';
import {
  TICKET_STATUSES_NO_AGENT_WORKS_AGAIN,
  openTrackerForWriting,
  openTrackerForWritingThenReadNextLine,
  padColumn,
  printEntity,
  printEntityThenNextLine,
  progressOperations,
  ticketDocumentOf,
  tokenCountFrom
}                                                              from '../CommandSupport';
import type { CommandHandler } from '../CommandTable';
import type { ArgumentParser } from '../arguments/ArgumentParser';

const USAGE = [
  'agent-progress ticket add "<title>" [--type bug|change|feature] [--priority low|normal|high] [--model <m>] [--effort <e>] [--group <name>] '
  + '[--depends-on <ids>] [--body <markdown> | --body-file <path|->] [--at <when>]',
  'agent-progress ticket list [--status <s>] [--priority <p>] [--json]',
  'agent-progress ticket show <id> [--json]',
  'agent-progress ticket start|review|done|deliver|abandon|reopen <id> [--branch <b>] [--commit <sha>] [--reason <text>] [--tokens <n>] [--at <when>]',
  'agent-progress ticket review|rereview <id> --start-review [--owner <who>] [--note <text>] [--at <when>]',
  'agent-progress ticket claim <id> [<id>...] [--owner <who>] [--note <text>] [--at <when>]',
  'agent-progress ticket rereview <id> [--at <when>]',
  'agent-progress ticket status <id> <status> [...same options]',
  'agent-progress ticket link <ticketId> <taskId> [--force]',
  'agent-progress ticket depends <id> [<id>...]',
  'agent-progress ticket priority <id> low|normal|high [--at <when>]',
  'agent-progress ticket agent <id> [--model <m>] [--effort <e>] [--at <when>]',
  'agent-progress ticket hold <id> [--reason <text>] [--at <when>]',
  'agent-progress ticket unhold <id> [--at <when>]',
].join('\n         ');

const TRANSITION_SUBCOMMANDS: Record<string, TicketStatus> = {
  start:   'in-progress',
  review:  'in-review',
  done:    'done',
  deliver: 'delivered',
  abandon: 'abandoned',
  reopen:  'open',
};

const ADD_OPTION_NAMES        = ['type', 'priority', 'model', 'effort', 'group', 'depends-on', 'body', 'body-file', 'at', 'json'];
const LIST_OPTION_NAMES       = ['status', 'priority', 'json'];
const PRIORITY_OPTION_NAMES   = ['at', 'json'];
const AGENT_OPTION_NAMES      = ['model', 'effort', 'at', 'json'];
const HOLD_OPTION_NAMES       = ['reason', 'at', 'json'];
const UNHOLD_OPTION_NAMES     = ['at', 'json'];
const SHOW_OPTION_NAMES       = ['json'];
const TRANSITION_OPTION_NAMES = ['branch', 'commit', 'reason', 'at', 'tokens', 'json'];
const CLAIM_OPTION_NAMES      = ['owner', 'note', 'at', 'json'];
const REVIEW_BAR_OPTION_NAMES = ['start-review', 'owner', 'note'];
const REVIEW_OPTION_NAMES     = [...TRANSITION_OPTION_NAMES, ...REVIEW_BAR_OPTION_NAMES];
const REREVIEW_OPTION_NAMES   = ['at', 'json', ...REVIEW_BAR_OPTION_NAMES];
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
  priority:   8,
  type:       8,
  task:       6,
};

function bodyForNewTicket(suppliedBody: string | undefined, ticketId: string, title: string): string {
  if (suppliedBody !== undefined && suppliedBody.trim() !== '') return suppliedBody;

  return readFileSync(join(import.meta.dir, ...TICKET_BODY_TEMPLATE_PATH), 'utf8')
    .split(TICKET_TEMPLATE_PLACEHOLDERS.id).join(ticketId)
    .split(TICKET_TEMPLATE_PLACEHOLDERS.title).join(title);
}


async function suppliedBodyFor(commandArguments: ArgumentParser, context: CommandContext): Promise<string | undefined> {
  const written = commandArguments.option('body');
  if (written !== undefined) return written;

  const bodyFile = commandArguments.option('body-file');
  if (bodyFile === STANDARD_INPUT_MARKER) return context.readStandardInput();
  if (bodyFile === undefined) return undefined;
  try {
    return readFileSync(resolve(context.currentDirectory, bodyFile), 'utf8');
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

/** The priority is always spelled out, so a script never has to know that an absent key means normal. */
function ticketAsJson(ticket: Ticket): Record<string, unknown> {
  return { ...ticketDocumentOf(ticket), body: ticket.body };
}

function requirePriority(writtenPriority: string): TicketPriority {
  if (!ticketPriorityIsKnown(writtenPriority)) {
    throw new OperationRefusal('refused', `"${writtenPriority}" is not a ticket priority. The priorities are ${TICKET_PRIORITIES.join(', ')}.`);
  }
  return writtenPriority;
}

function priorityFrom(writtenPriority: string | undefined): TicketPriority | undefined {
  return writtenPriority === undefined ? undefined : requirePriority(writtenPriority);
}

function agentModelFrom(writtenModel: string | undefined): AgentModel | undefined {
  if (writtenModel === undefined) return undefined;
  if (!agentModelIsKnown(writtenModel)) {
    throw new OperationRefusal('refused', `"${writtenModel}" is not an agent model. The models are ${AGENT_MODELS.join(', ')}.`);
  }
  return writtenModel;
}

function agentEffortFrom(writtenEffort: string | undefined): AgentEffort | undefined {
  if (writtenEffort === undefined) return undefined;
  if (!agentEffortIsKnown(writtenEffort)) {
    throw new OperationRefusal('refused', `"${writtenEffort}" is not an agent effort. The efforts are ${AGENT_EFFORTS.join(', ')}.`);
  }
  return writtenEffort;
}

function agentPairText(ticket: { model?: AgentModel; effort?: AgentEffort }): string {
  return `${agentModelOf(ticket)}/${agentEffortOf(ticket)}`;
}

/** Only what the file names: a ticket left to the defaults prints nothing extra, so a listing of old tickets looks as it did. */
function namedAgentText(ticket: { model?: AgentModel; effort?: AgentEffort }): string {
  const named = [ticket.model, ticket.effort === undefined ? undefined : `${ticket.effort} effort`].filter((part) => part !== undefined);
  return named.length === 0 ? '' : `  [${named.join(', ')}]`;
}

function lowTicketHeldBackText(ticket: Ticket, tickets: readonly Ticket[]): string | null {
  if (ticketPriorityOf(ticket.frontmatter) !== 'low') return null;
  const holdingBack = TicketDependencyUtil.ticketsHoldingBackLowPriorityWork(tickets.map((candidate) => candidate.frontmatter));
  if (holdingBack.length === 0) return null;
  return `Ticket #${ticket.frontmatter.id} is low priority, and ${holdingBack.map((identifier) => `#${identifier}`).join(', ')} `
    + `${holdingBack.length === 1 ? 'is' : 'are'} normal or high and not delivered or abandoned yet`;
}

interface ReviewBarRequest {
  owner?: string;
  note?:  string;
}

interface StartedReviewBar {
  bar:          Task;
  closedBarIds: number[];
}

const REVIEW_SECTION_HEADING_PATTERN = /^## Review[ \t]*$/gm;

function reviewBarRequestFrom(commandArguments: ArgumentParser, subcommand: string): ReviewBarRequest | null {
  const owner = commandArguments.option('owner');
  const note  = commandArguments.option('note');
  if (!commandArguments.flag('start-review')) {
    if (owner !== undefined || note !== undefined) {
      throw new OperationRefusal(
        'refused',
        `--owner and --note name the review bar, so \`agent-progress ticket ${subcommand}\` takes them only with --start-review.\n  Usage: ${USAGE}`,
      );
    }
    return null;
  }
  return {
    ...(owner === undefined ? {} : { owner }),
    ...(note === undefined ? {} : { note }),
  };
}

/** The round a reviewer states for itself: the `## Review` sections already in the ticket, plus one. */
function reviewRoundOf(ticket: Ticket): number {
  return (ticket.body.match(REVIEW_SECTION_HEADING_PATTERN)?.length ?? 0) + 1;
}

/**
 * Closes the ticket's running review bars and starts the next one, inside the caller's lock hold, so the ticket's slot is never free between two
 * agents: a builder's `ticket review` hands it to its reviewer, a reviewer's round to the next.
 */
function startReviewBar(progress: ProgressFile, ticket: Ticket, request: ReviewBarRequest, at: string): StartedReviewBar {
  const { id, title } = ticket.frontmatter;
  const closedBarIds  = [];
  for (const earlierBar of runningReviewRowsOf(progress, [id])) {
    transitionTask(progress, earlierBar.id, 'finished', at);
    transitionTask(progress, earlierBar.id, 'delivered', at);
    appendLogEntry(progress, at, `Closed the review row #${earlierBar.id}, delivered: ${earlierBar.name}`);
    closedBarIds.push(earlierBar.id);
  }
  const bar = addTask(progress, {
    name:     `Review ${reviewRoundOf(ticket)} #${id} — ${title}`,
    filedAt:  at,
    reviewOf: id,
    ...request,
  });
  transitionTask(progress, bar.id, 'running', at);
  appendLogEntry(progress, at, `Review row #${bar.id} started: ${bar.name}`);
  return { bar, closedBarIds };
}

function reviewBarText(started: StartedReviewBar | null): string {
  if (started === null) return '';
  const closedText = started.closedBarIds.map((barId) => `\nClosed the review row #${barId}, delivered`).join('');
  return `${closedText}\nReview row #${started.bar.id} started: ${started.bar.name}`;
}

function ticketWithReviewBarAsJson(ticket: Ticket, started: StartedReviewBar | null): Record<string, unknown> {
  if (started === null) return ticketAsJson(ticket);
  return { ...ticketAsJson(ticket), reviewRow: started.bar, closedReviewRows: started.closedBarIds };
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
  const priority  = priorityFrom(commandArguments.option('priority'));
  const model     = agentModelFrom(commandArguments.option('model'));
  const effort    = agentEffortFrom(commandArguments.option('effort'));
  const group     = commandArguments.option('group');
  const dependsOn = dependencyListFrom([commandArguments.option('depends-on') ?? '']);

  // Read before the lock: `--body-file -` waits on a pipe the caller may hold open indefinitely. The id is not: only the lock hold makes it this ticket's.
  requireWorkspace(context.currentDirectory);
  const suppliedBody = await suppliedBodyFor(commandArguments, context);

  const { result: ticket, nextLine, dispatcherState } = await openTrackerForWritingThenReadNextLine(commandArguments, context, (change) => {
    const filed = createTicket(change.workspace, {
      title,
      type,
      ...(priority === undefined ? {} : { priority }),
      ...(group === undefined ? {} : { group }),
      bodyFor: (ticketId) => bodyForNewTicket(suppliedBody, ticketId, title),
      at:      change.at,
    });
    // A ticket that does not exist yet has nobody waiting on it, so only the ids themselves can be wrong.
    refuseAnUnworkableDependencyList(filed.frontmatter.id, dependsOn, listTickets(change.workspace).tickets);
    if (dependsOn.length > 0) filed.frontmatter.dependsOn = dependsOn;
    if (model !== undefined) filed.frontmatter.model = model;
    if (effort !== undefined) filed.frontmatter.effort = effort;
    ensureTaskForTicketOnTheChart({
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
    `Ticket #${ticket.frontmatter.id} filed: ${ticket.frontmatter.title}${priority === 'low' ? ' (low priority: no row until it is started)' : ''}\n  ${ticket.filePath}`,
    NextLineUtil.endWithRunningDispatcherNotice(nextLine, dispatcherState),
  );
}

function listAllTickets(commandArguments: ArgumentParser, context: CommandContext): void {
  commandArguments.rejectUnknownOptions(LIST_OPTION_NAMES, USAGE);
  commandArguments.rejectExtraPositionals(1, USAGE);

  const writtenStatus = commandArguments.option('status');
  if (writtenStatus !== undefined && !ticketStatusIsKnown(writtenStatus)) {
    throw new OperationRefusal('refused', `"${writtenStatus}" is not a ticket status. The statuses are ${TICKET_STATUSES.join(', ')}.`);
  }

  const writtenPriority = priorityFrom(commandArguments.option('priority'));

  const workspace = requireWorkspace(context.currentDirectory);
  const listing   = listTickets(workspace);
  const shown     = listing.tickets
    .filter((ticket) => writtenStatus === undefined || ticket.frontmatter.status === writtenStatus)
    .filter((ticket) => writtenPriority === undefined || ticketPriorityOf(ticket.frontmatter) === writtenPriority);

  // Before the listing, so a reader piping the table still sees what was left out of it.
  for (const malformed of listing.malformed) {
    const place = malformed.line > 0 ? ` (line ${malformed.line})` : '';
    context.standardError(`Ticket file ignored: ${malformed.filePath}${place}: ${malformed.reason}`);
  }

  if (shown.length === 0) {
    const narrowing = [writtenStatus, writtenPriority === undefined ? undefined : `${writtenPriority} priority`].filter((part) => part !== undefined);
    printEntity(
      commandArguments,
      context,
      [],
      narrowing.length === 0 ? 'No tickets have been filed yet.' : `No tickets are ${narrowing.join(' and ')}.`,
    );
    return;
  }

  const header = [
    padColumn('id', LIST_COLUMN_WIDTHS.identifier),
    padColumn('status', LIST_COLUMN_WIDTHS.status),
    padColumn('priority', LIST_COLUMN_WIDTHS.priority),
    padColumn('type', LIST_COLUMN_WIDTHS.type),
    padColumn('task', LIST_COLUMN_WIDTHS.task),
    'title',
  ].join('');
  const rows = shown.map((ticket) => {
    const unsettled = unsettledDependenciesFor(ticket, listing.tickets);
    return [
      padColumn(`#${ticket.frontmatter.id}`, LIST_COLUMN_WIDTHS.identifier),
      padColumn(ticket.frontmatter.status, LIST_COLUMN_WIDTHS.status),
      padColumn(ticketPriorityOf(ticket.frontmatter), LIST_COLUMN_WIDTHS.priority),
      padColumn(ticket.frontmatter.type, LIST_COLUMN_WIDTHS.type),
      padColumn(ticket.frontmatter.task === null ? '-' : `#${ticket.frontmatter.task}`, LIST_COLUMN_WIDTHS.task),
      ticket.frontmatter.title,
      namedAgentText(ticket.frontmatter),
      ticketIsStillOpen(ticket) && unsettled.length > 0 ? `  (${waitingOnText(unsettled)})` : '',
    ].join('');
  });
  printEntity(commandArguments, context, shown.map(ticketDocumentOf), [header, ...rows].join('\n'));
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
    `  priority: ${ticketPriorityOf(frontmatter)}`,
    ...(frontmatter.model === undefined ? [] : [`  model:    ${frontmatter.model}`]),
    ...(frontmatter.effort === undefined ? [] : [`  effort:   ${frontmatter.effort}`]),
    ...(frontmatter.hold === undefined ? [] : [`  held:     ${frontmatter.hold === '' ? 'yes' : frontmatter.hold}`]),
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
  reviewBarRequest: ReviewBarRequest | null = null,
): Promise<void> {
  const branch = commandArguments.option('branch');
  const commit = commandArguments.option('commit');
  const reason = commandArguments.option('reason');
  const tokens = tokenCountFrom(commandArguments);

  const { result: moved, nextLine, dispatcherState } = await openTrackerForWritingThenReadNextLine(commandArguments, context, (change) => {
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
    // After the transition, which files a low ticket's row when it starts; a move that leaves it row-less throws before anything is written.
    if (tokens !== undefined) {
      if (outcome.ticket.frontmatter.task === null) {
        throw new OperationRefusal(
          'refused',
          `Ticket #${ticket.frontmatter.id} has no row, so --tokens has nowhere to be recorded: a low-priority ticket gets its row when it is started. Drop --tokens.`,
        );
      }
      setTaskTokens(change.progress, outcome.ticket.frontmatter.task, tokens);
    }
    const startedReviewBar = reviewBarRequest === null ? null : startReviewBar(change.progress, outcome.ticket, reviewBarRequest, change.at);
    change.writeTicketAfterwards(outcome.ticket);
    const { tickets } = listTickets(change.workspace);
    return {
      logText:     outcome.logText,
      ticket:      outcome.ticket,
      startedReviewBar,
      unsettled:   unsettledDependenciesFor(outcome.ticket, tickets),
      lowHeldBack: lowTicketHeldBackText(outcome.ticket, tickets),
    };
  });

  // A reopened ticket goes back into the queue a running dispatcher takes from, so it is intake like `ticket add`.
  const closingLines = targetStatus === 'open' ? NextLineUtil.endWithRunningDispatcherNotice(nextLine, dispatcherState) : nextLine;
  const humanText    = `${moved.logText}${reviewBarText(moved.startedReviewBar)}`;
  printEntityThenNextLine(commandArguments, context, ticketWithReviewBarAsJson(moved.ticket, moved.startedReviewBar), humanText, closingLines);

  // A warning, not a refusal: the order is advice to whoever picks work up, and the user may know better.
  if (targetStatus === 'in-progress' && moved.unsettled.length > 0) {
    const notDoneYet = moved.unsettled.length === 1 ? 'which is not done yet' : 'which are not done yet';
    context.standardError(`Ticket #${moved.ticket.frontmatter.id} is ${waitingOnText(moved.unsettled)}, ${notDoneYet}.`);
  }
  if (targetStatus === 'in-progress' && moved.lowHeldBack !== null) {
    context.standardError(`${moved.lowHeldBack}; it was started anyway.`);
  }
}

/** The one verb that may be run on the status the ticket already has: a further review pass is still review. */
async function rereviewOneTicket(
  reference: string,
  commandArguments: ArgumentParser,
  context: CommandContext,
  reviewBarRequest: ReviewBarRequest | null,
): Promise<void> {
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
    const startedReviewBar = reviewBarRequest === null ? null : startReviewBar(change.progress, outcome.ticket, reviewBarRequest, change.at);
    change.writeTicketAfterwards(outcome.ticket);
    return { logText: outcome.logText, ticket: outcome.ticket, startedReviewBar };
  });

  const humanText = `${moved.logText}${reviewBarText(moved.startedReviewBar)}`;
  printEntityThenNextLine(commandArguments, context, ticketWithReviewBarAsJson(moved.ticket, moved.startedReviewBar), humanText, nextLine);
}

/** A dependency on another ticket in the same claim is settled: one agent works a bundle in dependency order. */
function refuseAnUnclaimableTicket(ticket: Ticket, tickets: readonly Ticket[], claimedIdentifiers: readonly string[]): void {
  const { id, status } = ticket.frontmatter;
  if (!ticketMoveIsLegal(status, 'in-progress')) {
    const legalSources = LEGAL_SOURCE_STATUSES_FOR_TICKET_STATUS['in-progress'].join(' or ');
    throw new OperationRefusal('refused', `Ticket #${id} is ${status}, and \`agent-progress ticket claim\` takes a ticket that is ${legalSources}. Nothing was written.`);
  }
  const unsettled = unsettledDependenciesFor(ticket, tickets).filter((dependency) => !claimedIdentifiers.includes(dependency));
  if (unsettled.length > 0) {
    throw new OperationRefusal('refused', `Ticket #${id} is ${waitingOnText(unsettled)}, which must be done or delivered before it is claimed. Nothing was written.`);
  }
  if (ticket.frontmatter.hold !== undefined) {
    throw new OperationRefusal('refused', `Ticket #${id} is held, so it is not claimed. Nothing was written; \`agent-progress ticket unhold ${id}\` lets it be claimed.`);
  }
  const lowHeldBack = lowTicketHeldBackText(ticket, tickets);
  if (lowHeldBack !== null) {
    throw new OperationRefusal('refused', `${lowHeldBack}, so it is not claimed. Nothing was written; \`agent-progress ticket start ${id}\` starts it regardless.`);
  }
}

// A running bar is a reviewer at work, so a builder claiming the ticket, a second dispatcher run's among them, would rebuild it under review.
function refuseATicketUnderReview(progress: ProgressFile, ticketId: string): void {
  const [runningBar] = runningReviewRowsOf(progress, [ticketId]);
  if (runningBar === undefined) return;
  throw new OperationRefusal('refused', `Ticket #${ticketId} is under review: its review row #${runningBar.id} is running. Nothing was written.`);
}

function namedTicketsText(identifiers: readonly string[]): string {
  const named = identifiers.map((identifier) => `#${identifier}`).join(', ');
  return identifiers.length === 1 ? `Ticket ${named}` : `Tickets ${named}`;
}

/** Several references to one ticket (`3`, `003`, `#3`) claim it once. */
function distinctTicketsOf(references: readonly string[], workspace: Workspace): Ticket[] {
  const claimedTickets = new Map<string, Ticket>();
  for (const reference of references) {
    const ticket = requireTicket(workspace, reference);
    if (!claimedTickets.has(ticket.frontmatter.id)) claimedTickets.set(ticket.frontmatter.id, ticket);
  }
  return [...claimedTickets.values()].sort((a, b) => a.frontmatter.id.localeCompare(b.frontmatter.id));
}

/**
 * `ticket start` plus the row's owner and note for every ticket named, as one agent, refused rather than warned: every check and every move
 * share one lock hold, so the claim is all or nothing and two claims racing for the last slot cannot both pass the count.
 */
async function claimTickets(references: readonly string[], commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  const owner = commandArguments.option('owner');
  const note  = commandArguments.option('note');

  const { result: claimed, nextLine } = await openTrackerForWritingThenReadNextLine(commandArguments, context, (change) => {
    const claimedTickets = distinctTicketsOf(references, change.workspace);
    const identifiers    = claimedTickets.map((ticket) => ticket.frontmatter.id);
    const { tickets }    = listTickets(change.workspace);
    for (const ticket of claimedTickets) refuseAnUnclaimableTicket(ticket, tickets, identifiers);
    for (const identifier of identifiers) refuseATicketUnderReview(change.progress, identifier);

    const { agentsInFlight, limit } = concurrencyOf(change.progress);
    if (agentsInFlight >= limit) {
      const runningRowCount = change.progress.tasks.filter((task) => task.status === 'running').length;
      throw new OperationRefusal(
        'refused',
        `${namedTicketsText(identifiers)} ${identifiers.length === 1 ? 'was' : 'were'} not claimed: ${agentsInFlight} agents are in flight `
        + `(${runningRowCount} rows are running) and the concurrency limit is ${limit} agents. Nothing was written; claim once an agent has finished.`,
      );
    }

    // Every id, not the lowest alone: a bundle ticket reopened and claimed on its own must not share a key with the rest still running.
    const agentKey = identifiers.join(',');
    const moved: Ticket[] = [];
    for (const ticket of claimedTickets) {
      const outcome = applyTicketTransition({
        progress:     change.progress,
        ticket,
        targetStatus: 'in-progress',
        at:           change.at,
        operations:   progressOperations,
      });
      if (outcome.verdict === 'refused') throw new OperationRefusal('refused', `Ticket #${ticket.frontmatter.id} was not claimed: ${outcome.reason}. Nothing was written.`);
      const row = outcome.ticket.frontmatter.task === null ? undefined : findTask(change.progress, outcome.ticket.frontmatter.task);
      if (row !== undefined) row.agent = agentKey;
      if (row !== undefined && owner !== undefined) row.owner = owner;
      if (row !== undefined && note !== undefined) row.note = note;
      change.writeTicketAfterwards(outcome.ticket);
      moved.push(outcome.ticket);
    }
    return { identifiers, tickets: moved, concurrency: concurrencyOf(change.progress) };
  });

  const { concurrency, identifiers, tickets } = claimed;
  const [onlyTicket] = tickets;
  const slotsText    = `${concurrency.agentsInFlight} of ${concurrency.limit} slots are now taken.`;
  if (tickets.length === 1 && onlyTicket !== undefined) {
    printEntityThenNextLine(commandArguments, context, ticketAsJson(onlyTicket), `${namedTicketsText(identifiers)} started: ${slotsText}`, nextLine);
    return;
  }
  printEntityThenNextLine(commandArguments, context, tickets.map(ticketAsJson), `${namedTicketsText(identifiers)} started as one agent: ${slotsText}`, nextLine);
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

  const { result: changed, nextLine, dispatcherState } = await openTrackerForWritingThenReadNextLine(commandArguments, context, (change) => {
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

  printEntityThenNextLine(commandArguments, context, ticketAsJson(changed.ticket), changed.logText, NextLineUtil.endWithRunningDispatcherNotice(nextLine, dispatcherState));
}

async function setTicketPriority(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(PRIORITY_OPTION_NAMES, USAGE);
  commandArguments.rejectExtraPositionals(3, USAGE);

  const [, reference, writtenPriority] = commandArguments.positionals();
  if (reference === undefined || writtenPriority === undefined) {
    throw new OperationRefusal('refused', `agent-progress ticket priority needs a ticket id and a priority.\n  Usage: ${USAGE}`);
  }
  const priority = requirePriority(writtenPriority);

  const { result: changed, nextLine, dispatcherState } = await openTrackerForWritingThenReadNextLine(commandArguments, context, (change) => {
    const ticket  = requireTicket(change.workspace, reference);
    const outcome = applyTicketPriority({
      progress:   change.progress,
      ticket,
      priority,
      at:         change.at,
      operations: progressOperations,
    });
    if (outcome.verdict === 'refused') {
      const { id, status } = ticket.frontmatter;
      throw new OperationRefusal('refused', `Ticket #${id} is ${status}, and its priority was not changed: ${outcome.reason}. Nothing was written.`);
    }
    change.writeTicketAfterwards(outcome.ticket);
    return { logText: outcome.logText, ticket: outcome.ticket };
  });

  printEntityThenNextLine(commandArguments, context, ticketAsJson(changed.ticket), changed.logText, NextLineUtil.endWithRunningDispatcherNotice(nextLine, dispatcherState));
}

/** A changed pair is judged on the resolved values, so naming the default a ticket already runs on is refused as no change. */
async function setTicketAgent(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(AGENT_OPTION_NAMES, USAGE);
  commandArguments.rejectExtraPositionals(2, USAGE);

  const reference = commandArguments.positionals()[1];
  if (reference === undefined) {
    throw new OperationRefusal('refused', `agent-progress ticket agent needs a ticket id.\n  Usage: ${USAGE}`);
  }
  const model  = agentModelFrom(commandArguments.option('model'));
  const effort = agentEffortFrom(commandArguments.option('effort'));
  if (model === undefined && effort === undefined) {
    throw new OperationRefusal('refused', `agent-progress ticket agent needs --model, --effort or both.\n  Usage: ${USAGE}`);
  }

  const { result: changed, nextLine, dispatcherState } = await openTrackerForWritingThenReadNextLine(commandArguments, context, (change) => {
    const ticket = requireTicket(change.workspace, reference);
    const { frontmatter } = ticket;
    const { id, status }  = frontmatter;
    if (TICKET_STATUSES_NO_AGENT_WORKS_AGAIN.includes(status)) {
      throw new OperationRefusal('refused', `Ticket #${id} is ${status}, and its agents were not changed: no agent will work it again. Nothing was written.`);
    }
    const before = agentPairText(frontmatter);
    const after  = agentPairText({
      ...(frontmatter.model === undefined ? {} : { model: frontmatter.model }),
      ...(frontmatter.effort === undefined ? {} : { effort: frontmatter.effort }),
      ...(model === undefined ? {} : { model }),
      ...(effort === undefined ? {} : { effort }),
    });
    if (before === after) {
      throw new OperationRefusal('refused', `Ticket #${id} is ${status}, and its agents were not changed: they already run on ${before}. Nothing was written.`);
    }
    if (model !== undefined) frontmatter.model = model;
    if (effort !== undefined) frontmatter.effort = effort;
    const logText = `Ticket #${id} agents ${before} → ${after}`;
    appendLogEntry(change.progress, change.at, logText);
    change.writeTicketAfterwards(ticket);
    return { logText, ticket };
  });

  printEntityThenNextLine(commandArguments, context, ticketAsJson(changed.ticket), changed.logText, NextLineUtil.endWithRunningDispatcherNotice(nextLine, dispatcherState));
}

/** A hold stops the dispatcher starting the ticket's next builder or reviewer; an agent already running is never interrupted by it. */
async function holdOrUnholdTicket(holds: boolean, commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  const verb = holds ? 'hold' : 'unhold';
  commandArguments.rejectUnknownOptions(holds ? HOLD_OPTION_NAMES : UNHOLD_OPTION_NAMES, USAGE);
  commandArguments.rejectExtraPositionals(2, USAGE);

  const reference = commandArguments.positionals()[1];
  if (reference === undefined) {
    throw new OperationRefusal('refused', `agent-progress ticket ${verb} needs a ticket id.\n  Usage: ${USAGE}`);
  }
  const reason = commandArguments.option('reason') ?? '';

  const { result: changed, nextLine, dispatcherState } = await openTrackerForWritingThenReadNextLine(commandArguments, context, (change) => {
    const ticket = requireTicket(change.workspace, reference);
    const { frontmatter } = ticket;
    const { id, status }  = frontmatter;
    if (TICKET_STATUSES_NO_AGENT_WORKS_AGAIN.includes(status)) {
      throw new OperationRefusal('refused', `Ticket #${id} is ${status}, and no agent will work it again, so there is nothing to ${verb}. Nothing was written.`);
    }
    if (holds === (frontmatter.hold !== undefined)) {
      throw new OperationRefusal('refused', `Ticket #${id} is ${holds ? 'already held' : 'not held'}. Nothing was written.`);
    }
    if (holds) frontmatter.hold = reason;
    else delete frontmatter.hold;
    const logText = holds ? `Ticket #${id} held${reason === '' ? '' : `: ${reason}`}` : `Ticket #${id} unheld`;
    appendLogEntry(change.progress, change.at, logText);
    change.writeTicketAfterwards(ticket);
    return { logText, ticket };
  });

  printEntityThenNextLine(commandArguments, context, ticketAsJson(changed.ticket), changed.logText, NextLineUtil.endWithRunningDispatcherNotice(nextLine, dispatcherState));
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
  if (subcommand === 'priority') return setTicketPriority(commandArguments, context);
  if (subcommand === 'agent') return setTicketAgent(commandArguments, context);
  if (subcommand === 'hold') return holdOrUnholdTicket(true, commandArguments, context);
  if (subcommand === 'unhold') return holdOrUnholdTicket(false, commandArguments, context);
  if (subcommand === 'claim') {
    commandArguments.rejectUnknownOptions(CLAIM_OPTION_NAMES, USAGE);
    const references = commandArguments.positionals().slice(1);
    if (references.length === 0) {
      throw new OperationRefusal('refused', `agent-progress ticket claim needs a ticket id, or every id of a bundle.\n  Usage: ${USAGE}`);
    }
    return claimTickets(references, commandArguments, context);
  }
  if (subcommand === 'rereview') {
    commandArguments.rejectUnknownOptions(REREVIEW_OPTION_NAMES, USAGE);
    commandArguments.rejectExtraPositionals(2, USAGE);
    const reference = commandArguments.positionals()[1];
    if (reference === undefined) {
      throw new OperationRefusal('refused', `agent-progress ticket rereview needs a ticket id.\n  Usage: ${USAGE}`);
    }
    return rereviewOneTicket(reference, commandArguments, context, reviewBarRequestFrom(commandArguments, 'rereview'));
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
    const sendsToReview = targetStatus === 'in-review';
    commandArguments.rejectUnknownOptions(sendsToReview ? REVIEW_OPTION_NAMES : TRANSITION_OPTION_NAMES, USAGE);
    commandArguments.rejectExtraPositionals(2, USAGE);
    const reference = commandArguments.positionals()[1];
    if (reference === undefined) {
      throw new OperationRefusal('refused', `agent-progress ticket ${subcommand} needs a ticket id.\n  Usage: ${USAGE}`);
    }
    const reviewBarRequest = sendsToReview ? reviewBarRequestFrom(commandArguments, 'review') : null;
    return transitionOneTicket(targetStatus, reference, commandArguments, context, true, reviewBarRequest);
  }

  throw new OperationRefusal(
    'refused',
    `${subcommand === undefined ? 'agent-progress ticket needs a subcommand' : `"${subcommand}" is not an agent-progress ticket subcommand`}.\n  Usage: ${USAGE}`,
  );
};
