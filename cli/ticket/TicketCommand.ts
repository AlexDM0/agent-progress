/**
 * The named verbs enforce the legality matrix of `src/lib/tracker-model/constants/TicketMoveLegality.ts`; `ticket status` is the
 * documented override that skips it.
 */
import { readFileSync }            from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { NextLineUtil }                           from '../../lib/utils/NextLineUtil';
import { LegacyStatusUtil }                       from '../../src/adapters/utils/LegacyStatusUtil';
import { LogUtil }                                from '../../src/adapters/utils/LogUtil';
import { StatusWordingUtil }                      from '../../src/adapters/utils/StatusWordingUtil';
import { TicketBodyUtil }                         from '../../src/adapters/utils/TicketBodyUtil';
import { TicketPhraseUtil }                       from '../../src/adapters/utils/TicketPhraseUtil';
import type { AgentAssignment, ReviewBarStarted } from '../../src/lib/tracker-model/@types/BoardChanges';
import type { LogRecord }                         from '../../src/lib/tracker-model/@types/LogRecord';
import type { Task }                              from '../../src/lib/tracker-model/@types/Task';
import type {
  AgentEffort,
  AgentModel,
  Ticket,
  TicketPriority,
  TicketStatus,
  TicketType
} from '../../src/lib/tracker-model/@types/Ticket';
import { AGENT_EFFORTS, AGENT_MODELS }     from '../../src/lib/tracker-model/constants/AgentSettings';
import { TICKET_STATUSES }                 from '../../src/lib/tracker-model/constants/Statuses';
import { TICKET_PRIORITIES, TICKET_TYPES } from '../../src/lib/tracker-model/constants/TicketFields';
import { TicketDefaultsUtil }              from '../../src/lib/tracker-model/utils/TicketDefaultsUtil';
import { TicketDependencyUtil }            from '../../src/lib/tracker-model/utils/TicketDependencyUtil';
import { TicketIdUtil }                    from '../../src/lib/tracker-model/utils/TicketIdUtil';
import { VocabularyUtil }                  from '../../src/lib/tracker-model/utils/VocabularyUtil';
import {
  createTicket,
  listTickets,
  readTicket,
  type MalformedTicketFile
}                                                     from '../../src/services/tracker/TicketStore';
import type { TrackerChange }               from '../../src/services/tracker/TrackerPipeline';
import { requireWorkspace, type Workspace } from '../../src/services/tracker/Workspace';
import { OperationRefusal }                 from '../../src/shared/OperationRefusal';
import { LIMITS }                           from '../../src/shared/constants/Limits';
import { DispatcherClaimNoteUtil }          from '../../src/shared/utils/DispatcherClaimNoteUtil';
import type { CommandContext }              from '../CommandContext';
import {
  ignoredTicketFileText,
  openTrackerForWriting,
  openTrackerForWritingThenReadNextLine,
  padColumn,
  printEntity,
  printEntityThenNextLine,
  reportIgnoredTicketFiles,
  ticketDocumentOf,
  tokenCountFrom
} from '../CommandSupport';
import type { CommandHandler } from '../CommandTable';
import type { ArgumentParser } from '../arguments/ArgumentParser';

const USAGE = [
  'agent-progress ticket add "<title>" [--type bug|change|feature] [--priority low|normal|high] [--model <m>] [--effort <e>] [--group <name>] '
  + '[--depends-on <ids>] [--body <markdown> | --body-file <path|->] [--at <when>]',
  'agent-progress ticket list [--status <s>] [--priority <p>] [--json]',
  'agent-progress ticket show <id> [--json]',
  'agent-progress ticket start|finish|approve|deliver|abandon|reopen <id> [--branch <b>] [--commit <sha>] [--reason <text>] [--tokens <n>] [--at <when>]',
  'agent-progress ticket finish|rereview <id> --start-review [--owner <who>] [--note <text>] [--at <when>]',
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
  [StatusWordingUtil.verbFor('in-progress')]: 'in-progress',
  [StatusWordingUtil.verbFor('in-review')]:   'in-review',
  [StatusWordingUtil.verbFor('reviewed')]:    'reviewed',
  [StatusWordingUtil.verbFor('delivered')]:   'delivered',
  [StatusWordingUtil.verbFor('abandoned')]:   'abandoned',
  [StatusWordingUtil.verbFor('pending')]:     'pending',
};

/** A verb that was renamed is refused naming its replacement, rather than read as an unknown word. */
const RETIRED_SUBCOMMAND_REPLACEMENTS: Record<string, string> = {
  review: 'finish',
  done:   'approve',
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

const DEFAULT_TICKET_TYPE: TicketType = 'change';

const TICKET_STATUSES_THAT_CLOSE_A_TICKET: readonly TicketStatus[] = ['reviewed', 'delivered', 'abandoned'];


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

function malformedFileOfTicket(malformedTickets: readonly MalformedTicketFile[], reference: string): MalformedTicketFile | undefined {
  const identifier = TicketIdUtil.parseTicketReference(reference);
  if (identifier === null) return undefined;
  return malformedTickets.find(({ filePath }) => {
    const fileName = basename(filePath);
    return fileName.startsWith(`${identifier}-`) || fileName === `${identifier}.md`;
  });
}

/** A ticket file that is there and will not parse is exit 2: the tool will not repair a hand edit, and a missing ticket is the caller's to fix. */
function refuseAMissingTicket(reference: string, malformedTickets: readonly MalformedTicketFile[]): never {
  const malformed = malformedFileOfTicket(malformedTickets, reference);
  if (malformed !== undefined) throw new OperationRefusal('unrepaired', ignoredTicketFileText(malformed));
  throw new OperationRefusal(
    'refused',
    `There is no readable ticket ${reference}. Run \`agent-progress ticket list\` to see what this tracker holds; `
    + 'a file that will not parse is reported there as malformed.',
  );
}

function requireTicket(change: TrackerChange, reference: string): Ticket {
  return change.board.ticketByReference(reference) ?? refuseAMissingTicket(reference, change.malformedTickets);
}

/** `ticket show` changes nothing, so it reads the ticket files as they are, with no lock and no Board. */
function requireTicketToShow(workspace: Workspace, reference: string): Ticket {
  return readTicket(workspace, reference) ?? refuseAMissingTicket(reference, listTickets(workspace).malformed);
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

function unsettledDependenciesFor(ticket: Ticket, tickets: readonly Ticket[]): string[] {
  const statusById = new Map(tickets.map((candidate) => [candidate.frontmatter.id, candidate.frontmatter.status]));
  return TicketDependencyUtil.unsettledDependenciesOf(ticket.frontmatter.dependsOn ?? [], statusById);
}

function ticketIsStillOpen(ticket: Ticket): boolean {
  return !TICKET_STATUSES_THAT_CLOSE_A_TICKET.includes(ticket.frontmatter.status);
}

/** The priority is always spelled out, so a script never has to know that an absent key means normal. */
function ticketAsJson(ticket: Ticket): Record<string, unknown> {
  return { ...ticketDocumentOf(ticket), body: ticket.body };
}

function requirePriority(writtenPriority: string): TicketPriority {
  if (!VocabularyUtil.ticketPriorityIsKnown(writtenPriority)) {
    throw new OperationRefusal('refused', `"${writtenPriority}" is not a ticket priority. The priorities are ${TICKET_PRIORITIES.join(', ')}.`);
  }
  return writtenPriority;
}

function priorityFrom(writtenPriority: string | undefined): TicketPriority | undefined {
  return writtenPriority === undefined ? undefined : requirePriority(writtenPriority);
}

function agentModelFrom(writtenModel: string | undefined): AgentModel | undefined {
  if (writtenModel === undefined) return undefined;
  if (!VocabularyUtil.agentModelIsKnown(writtenModel)) {
    throw new OperationRefusal('refused', `"${writtenModel}" is not an agent model. The models are ${AGENT_MODELS.join(', ')}.`);
  }
  return writtenModel;
}

function agentEffortFrom(writtenEffort: string | undefined): AgentEffort | undefined {
  if (writtenEffort === undefined) return undefined;
  if (!VocabularyUtil.agentEffortIsKnown(writtenEffort)) {
    throw new OperationRefusal('refused', `"${writtenEffort}" is not an agent effort. The efforts are ${AGENT_EFFORTS.join(', ')}.`);
  }
  return writtenEffort;
}

/** Only what the file names: a ticket left to the defaults prints nothing extra, so a listing of old tickets looks as it did. */
function namedAgentText(ticket: { model?: AgentModel; effort?: AgentEffort }): string {
  const named = [ticket.model, ticket.effort === undefined ? undefined : `${ticket.effort} effort`].filter((part) => part !== undefined);
  return named.length === 0 ? '' : `  [${named.join(', ')}]`;
}

function reviewBarRequestFrom(commandArguments: ArgumentParser, subcommand: string): AgentAssignment | null {
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

/**
 * A builder's `ticket finish` hands the ticket's slot to its reviewer, a reviewer's `rereview` to the next. The round is the one a reviewer
 * states for itself: the `## Review` sections already in the ticket, plus one.
 */
function reviewBarStartedFor(change: TrackerChange, ticket: Readonly<Ticket>, request: AgentAssignment | null): ReviewBarStarted | null {
  if (request === null) return null;
  const round = TicketBodyUtil.nextReviewRoundOf(ticket.body);
  return change.board.startReviewBar(ticket.frontmatter.id, { round, ...request }, change.at);
}

function sentencesOf(logged: readonly LogRecord[]): string {
  return logged.map(LogUtil.sentenceOf).join('\n');
}

/** A closed bar is printed by its id alone, not as the sentence the log holds for it. */
function recordClosesNoBar(record: LogRecord): boolean {
  return record.kind !== 'review-bar-closed';
}

function idsOf(bars: readonly Readonly<Task>[]): number[] {
  return bars.map((bar) => bar.id);
}

function closedReviewBarsText(closedBars: readonly Readonly<Task>[]): string {
  return closedBars.map((bar) => `\nClosed the review row #${bar.id}, delivered`).join('');
}

function reviewBarText(started: ReviewBarStarted | null): string {
  if (started === null) return '';
  return `${closedReviewBarsText(started.closedBars)}\n${sentencesOf(started.logged.filter(recordClosesNoBar))}`;
}

function ticketWithReviewBarAsJson(ticket: Ticket, started: ReviewBarStarted | null, closedBars: readonly Readonly<Task>[] = []): Record<string, unknown> {
  if (started !== null) return { ...ticketAsJson(ticket), reviewRow: started.bar, closedReviewRows: idsOf(started.closedBars) };
  if (closedBars.length > 0) return { ...ticketAsJson(ticket), closedReviewRows: idsOf(closedBars) };
  return ticketAsJson(ticket);
}

async function addOneTicket(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(ADD_OPTION_NAMES, USAGE);
  commandArguments.rejectExtraPositionals(2, USAGE);

  const title = commandArguments.positionals()[1];
  if (title === undefined || title.trim() === '') {
    throw new OperationRefusal('refused', `agent-progress ticket add needs a title.\n  Usage: ${USAGE}`);
  }
  const writtenType = commandArguments.option('type');
  if (writtenType !== undefined && !VocabularyUtil.ticketTypeIsKnown(writtenType)) {
    throw new OperationRefusal('refused', `"${writtenType}" is not a ticket type. The types are ${TICKET_TYPES.join(', ')}.`);
  }
  const type      = writtenType !== undefined && VocabularyUtil.ticketTypeIsKnown(writtenType) ? writtenType : DEFAULT_TICKET_TYPE;
  const priority  = priorityFrom(commandArguments.option('priority'));
  const model     = agentModelFrom(commandArguments.option('model'));
  const effort    = agentEffortFrom(commandArguments.option('effort'));
  const group     = commandArguments.option('group');
  const dependsOn = dependencyListFrom([commandArguments.option('depends-on') ?? '']);

  // Read before the lock: `--body-file -` waits on a pipe the caller may hold open indefinitely. The id is not: only the lock hold makes it this ticket's.
  requireWorkspace(context.currentDirectory);
  const suppliedBody = await suppliedBodyFor(commandArguments, context);

  const { result: filed, nextLine, dispatcherState } = await openTrackerForWritingThenReadNextLine(commandArguments, context, (change) => {
    const ticket = createTicket(change.workspace, {
      title,
      type,
      ...(priority === undefined ? {} : { priority }),
      ...(group === undefined ? {} : { group }),
      bodyFor: (ticketId) => bodyForNewTicket(suppliedBody, ticketId, title),
      at:      change.at,
    });
    if (dependsOn.length > 0) ticket.frontmatter.dependsOn = dependsOn;
    if (model !== undefined) ticket.frontmatter.model = model;
    if (effort !== undefined) ticket.frontmatter.effort = effort;
    return change.board.fileTicket(ticket, change.at);
  });

  printEntityThenNextLine(
    commandArguments,
    context,
    ticketAsJson(filed.ticket),
    `${sentencesOf(filed.logged)}${priority === 'low' ? ' (low priority: no row until it is started)' : ''}\n  ${filed.ticket.filePath}`,
    NextLineUtil.endWithRunningDispatcherNotice(nextLine, dispatcherState),
  );
}

/** An old status word is named with the word that replaced it, since a reader who typed it meant that one. */
function refuseAnUnknownTicketStatus(writtenStatus: string, retryAdviceFor: (renamedStatus: TicketStatus) => string): never {
  const renamedStatus = LegacyStatusUtil.currentTicketStatusFor(writtenStatus);
  if (renamedStatus !== null) {
    throw new OperationRefusal('refused', `"${writtenStatus}" is the old name of the ticket status ${renamedStatus}; ${retryAdviceFor(renamedStatus)}.`);
  }
  throw new OperationRefusal('refused', `"${writtenStatus}" is not a ticket status. The statuses are ${TICKET_STATUSES.join(', ')}.`);
}

function listAllTickets(commandArguments: ArgumentParser, context: CommandContext): void {
  commandArguments.rejectUnknownOptions(LIST_OPTION_NAMES, USAGE);
  commandArguments.rejectExtraPositionals(1, USAGE);

  const writtenStatus = commandArguments.option('status');
  if (writtenStatus !== undefined && !VocabularyUtil.ticketStatusIsKnown(writtenStatus)) {
    refuseAnUnknownTicketStatus(writtenStatus, (renamedStatus) => `pass --status ${renamedStatus}`);
  }

  const writtenPriority = priorityFrom(commandArguments.option('priority'));

  const workspace = requireWorkspace(context.currentDirectory);
  const listing   = listTickets(workspace);
  const shown     = listing.tickets
    .filter((ticket) => writtenStatus === undefined || ticket.frontmatter.status === writtenStatus)
    .filter((ticket) => writtenPriority === undefined || TicketDefaultsUtil.ticketPriorityOf(ticket.frontmatter) === writtenPriority);

  // Before the listing, so a reader piping the table still sees what was left out of it.
  reportIgnoredTicketFiles(context, listing.malformed);

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
      padColumn(TicketDefaultsUtil.ticketPriorityOf(ticket.frontmatter), LIST_COLUMN_WIDTHS.priority),
      padColumn(ticket.frontmatter.type, LIST_COLUMN_WIDTHS.type),
      padColumn(ticket.frontmatter.task === null ? '-' : `#${ticket.frontmatter.task}`, LIST_COLUMN_WIDTHS.task),
      ticket.frontmatter.title,
      namedAgentText(ticket.frontmatter),
      ticketIsStillOpen(ticket) && unsettled.length > 0 ? `  (${TicketPhraseUtil.waitingOnText(unsettled)})` : '',
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
  const ticket    = requireTicketToShow(workspace, reference);
  const { frontmatter } = ticket;
  const statusById      = new Map(listTickets(workspace).tickets.map((candidate) => [candidate.frontmatter.id, candidate.frontmatter.status]));
  const dependencies    = (frontmatter.dependsOn ?? []).map((identifier) => `#${identifier} (${statusById.get(identifier) ?? 'missing'})`);
  const summary = [
    `Ticket #${frontmatter.id}: ${frontmatter.title}`,
    `  status:   ${frontmatter.status}`,
    `  priority: ${TicketDefaultsUtil.ticketPriorityOf(frontmatter)}`,
    ...(frontmatter.model === undefined ? [] : [`  model:    ${frontmatter.model}`]),
    ...(frontmatter.effort === undefined ? [] : [`  effort:   ${frontmatter.effort}`]),
    ...(frontmatter.hold === undefined ? [] : [`  held:     ${frontmatter.hold === '' ? 'yes' : frontmatter.hold}`]),
    `  type:     ${frontmatter.type}`,
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
  printEntity(commandArguments, context, ticketAsJson(ticket), `${summary}\n\n${ticket.body}`);
}

async function transitionOneTicket(
  targetStatus: TicketStatus,
  reference: string,
  commandArguments: ArgumentParser,
  context: CommandContext,
  checksLegality: boolean,
  reviewBarRequest: AgentAssignment | null = null,
): Promise<void> {
  const branch = commandArguments.option('branch');
  const commit = commandArguments.option('commit');
  const reason = commandArguments.option('reason');
  const tokens = tokenCountFrom(commandArguments);

  const { result: moved, nextLine, dispatcherState } = await openTrackerForWritingThenReadNextLine(commandArguments, context, (change) => {
    const { board }  = change;
    const ticketId   = requireTicket(change, reference).frontmatter.id;
    const move       = board.moveTicket(ticketId, targetStatus, {
      checksLegality,
      ...(branch === undefined ? {} : { branch }),
      ...(commit === undefined ? {} : { commit }),
      ...(reason === undefined ? {} : { reason }),
      ...(tokens === undefined ? {} : { tokens }),
    }, change.at);
    return {
      move,
      startedReviewBar:     reviewBarStartedFor(change, move.ticket, reviewBarRequest),
      unsettled:            board.unsettledDependenciesOf(ticketId),
      holdingBackTicketIds: board.ticketIdsHoldingBack(ticketId),
    };
  });

  const { move, startedReviewBar } = moved;
  const { id }                     = move.ticket.frontmatter;
  // A reopened ticket goes back into the queue a running dispatcher takes from, so it is intake like `ticket add`.
  const closingLines = targetStatus === 'pending' ? NextLineUtil.endWithRunningDispatcherNotice(nextLine, dispatcherState) : nextLine;
  const humanText    = `${sentencesOf(move.logged.filter(recordClosesNoBar))}${closedReviewBarsText(move.closedReviewBars)}${reviewBarText(startedReviewBar)}`;
  const document     = ticketWithReviewBarAsJson(move.ticket, startedReviewBar, move.closedReviewBars);
  printEntityThenNextLine(commandArguments, context, document, humanText, closingLines);

  // A warning, not a refusal: the order is advice to whoever picks work up, and the user may know better.
  if (targetStatus === 'in-progress' && moved.unsettled.length > 0) {
    const notSettledYetText = moved.unsettled.length === 1 ? 'which is not reviewed or delivered yet' : 'which are not reviewed or delivered yet';
    context.standardError(`Ticket #${id} is ${TicketPhraseUtil.waitingOnText(moved.unsettled)}, ${notSettledYetText}.`);
  }
  if (targetStatus === 'in-progress' && move.ticket.frontmatter.hold !== undefined) {
    context.standardError(`Ticket #${id} is held; it was started anyway, and \`agent-progress ticket unhold ${id}\` lifts the hold.`);
  }
  if (targetStatus === 'in-progress' && moved.holdingBackTicketIds.length > 0) {
    context.standardError(`${TicketPhraseUtil.lowPriorityHeldBackText(id, moved.holdingBackTicketIds)}; it was started anyway.`);
  }
}

/** The one verb that may be run on the status the ticket already has: a further review pass is still review. */
async function rereviewOneTicket(
  reference: string,
  commandArguments: ArgumentParser,
  context: CommandContext,
  reviewBarRequest: AgentAssignment | null,
): Promise<void> {
  const { result: rereviewed, nextLine } = await openTrackerForWritingThenReadNextLine(commandArguments, context, (change) => {
    const rereview = change.board.rereviewTicket(requireTicket(change, reference).frontmatter.id, change.at);
    return { rereview, startedReviewBar: reviewBarStartedFor(change, rereview.ticket, reviewBarRequest) };
  });

  const { rereview, startedReviewBar } = rereviewed;
  const humanText                      = `${sentencesOf(rereview.logged)}${reviewBarText(startedReviewBar)}`;
  printEntityThenNextLine(commandArguments, context, ticketWithReviewBarAsJson(rereview.ticket, startedReviewBar), humanText, nextLine);
}

/** Every reference is resolved before the claim is judged, so the first naming no ticket is refused; `3`, `003` and `#3` claim one ticket once. */
async function claimTickets(references: readonly string[], commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  const owner = commandArguments.option('owner');
  const note  = commandArguments.option('note');

  const { result: claimed, nextLine } = await openTrackerForWritingThenReadNextLine(commandArguments, context, (change) => {
    const ticketIds = references.map((reference) => requireTicket(change, reference).frontmatter.id);
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
    printEntityThenNextLine(commandArguments, context, ticketAsJson(onlyTicket), `${TicketPhraseUtil.namedTicketsText(identifiers)} started: ${slotsText}`, nextLine);
    return;
  }
  printEntityThenNextLine(commandArguments, context, tickets.map(ticketAsJson), `${TicketPhraseUtil.namedTicketsText(identifiers)} started as one agent: ${slotsText}`, nextLine);
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

  const linked = await openTrackerForWriting(
    commandArguments,
    context,
    (change) => change.board.linkTicketToTask(requireTicket(change, ticketReference).frontmatter.id, taskId, { movesTheLink }),
  );

  printEntity(commandArguments, context, ticketAsJson(linked), `Ticket #${linked.frontmatter.id} linked to task #${taskId}`);
}

async function setTicketDependencies(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(DEPENDS_OPTION_NAMES, USAGE);

  const [, reference, ...dependencyTexts] = commandArguments.positionals();
  if (reference === undefined) {
    throw new OperationRefusal('refused', `agent-progress ticket depends needs a ticket id, then the ids it waits on (none clears the list).\n  Usage: ${USAGE}`);
  }
  const dependsOn = dependencyListFrom(dependencyTexts);

  const { result: changed, nextLine, dispatcherState } = await openTrackerForWritingThenReadNextLine(
    commandArguments,
    context,
    (change) => change.board.setTicketDependencies(requireTicket(change, reference).frontmatter.id, dependsOn, change.at),
  );

  const closingLines = NextLineUtil.endWithRunningDispatcherNotice(nextLine, dispatcherState);
  printEntityThenNextLine(commandArguments, context, ticketAsJson(changed.ticket), sentencesOf(changed.logged), closingLines);
}

async function setTicketPriority(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(PRIORITY_OPTION_NAMES, USAGE);
  commandArguments.rejectExtraPositionals(3, USAGE);

  const [, reference, writtenPriority] = commandArguments.positionals();
  if (reference === undefined || writtenPriority === undefined) {
    throw new OperationRefusal('refused', `agent-progress ticket priority needs a ticket id and a priority.\n  Usage: ${USAGE}`);
  }
  const priority = requirePriority(writtenPriority);

  const { result: changed, nextLine, dispatcherState } = await openTrackerForWritingThenReadNextLine(
    commandArguments,
    context,
    (change) => change.board.setTicketPriority(requireTicket(change, reference).frontmatter.id, priority, change.at),
  );

  const closingLines = NextLineUtil.endWithRunningDispatcherNotice(nextLine, dispatcherState);
  printEntityThenNextLine(commandArguments, context, ticketAsJson(changed.ticket), sentencesOf(changed.logged), closingLines);
}

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
    const ticketId = requireTicket(change, reference).frontmatter.id;
    return change.board.setTicketAgents(ticketId, {
      ...(model === undefined ? {} : { model }),
      ...(effort === undefined ? {} : { effort }),
    }, change.at);
  });

  const closingLines = NextLineUtil.endWithRunningDispatcherNotice(nextLine, dispatcherState);
  printEntityThenNextLine(commandArguments, context, ticketAsJson(changed.ticket), sentencesOf(changed.logged), closingLines);
}

// Every dispatcher run's builder takes over only a row paused under a dispatcher claim note; any other pause is a person's, resumed by hand.
function resumeBuildHintFor(ticketId: string, pausedRow: Readonly<Task>): string {
  if (!DispatcherClaimNoteUtil.noteIsADispatcherClaimOn(pausedRow.note, ticketId)) {
    return `Its build row #${pausedRow.id} was left paused under a person's note, which the dispatcher never takes over: `
      + `resume it with \`agent-progress task start ${pausedRow.id}\`, or settle the row by hand.`;
  }
  const singleTicketRun = `launch a single-ticket dispatcher run for #${ticketId} (ticketIds: ["${ticketId}"]) to resume it`;
  return `Its build was left paused: the next whole-board dispatcher run resumes it; when none is going or about to be launched, ${singleTicketRun} now.`;
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
    const { board } = change;
    const ticketId  = requireTicket(change, reference).frontmatter.id;
    if (holds) return { holdChange: board.holdTicket(ticketId, reason, change.at), resumeBuildHint: null };
    const holdChange = board.unholdTicket(ticketId, change.at);
    const pausedRow  = board.pausedBuildRowOf(ticketId);
    return { holdChange, resumeBuildHint: pausedRow === null ? null : resumeBuildHintFor(ticketId, pausedRow) };
  });

  const { holdChange, resumeBuildHint } = changed;
  const endedNextLine                   = NextLineUtil.endWithRunningDispatcherNotice(nextLine, dispatcherState);
  const closingLines                    = resumeBuildHint === null ? endedNextLine : `${endedNextLine}\n${resumeBuildHint}`;
  printEntityThenNextLine(commandArguments, context, ticketAsJson(holdChange.ticket), sentencesOf(holdChange.logged), closingLines);
}

function refuseARetiredSubcommand(subcommand: string, commandArguments: ArgumentParser): never {
  const replacement              = RETIRED_SUBCOMMAND_REPLACEMENTS[subcommand] ?? subcommand;
  const targetStatus             = Object.hasOwn(TRANSITION_SUBCOMMANDS, replacement) ? TRANSITION_SUBCOMMANDS[replacement] : undefined;
  const ticketId                 = commandArguments.positionals()[1] ?? '<id>';
  const startReviewCarryOverText = targetStatus === 'in-review' ? ', and takes --start-review the same way' : '';
  throw new OperationRefusal(
    'refused',
    `\`agent-progress ticket ${subcommand}\` was renamed: \`agent-progress ticket ${replacement} ${ticketId}\` moves a ticket to ${targetStatus ?? replacement}`
    + `${startReviewCarryOverText}. Nothing was written.`,
  );
}

async function setTicketStatus(commandArguments: ArgumentParser, context: CommandContext): Promise<void> {
  commandArguments.rejectUnknownOptions(TRANSITION_OPTION_NAMES, USAGE);
  commandArguments.rejectExtraPositionals(3, USAGE);

  const [, reference, writtenStatus] = commandArguments.positionals();
  if (reference === undefined || writtenStatus === undefined) {
    throw new OperationRefusal('refused', `agent-progress ticket status needs a ticket id and a status.\n  Usage: ${USAGE}`);
  }
  if (!VocabularyUtil.ticketStatusIsKnown(writtenStatus)) {
    refuseAnUnknownTicketStatus(writtenStatus, (renamedStatus) => `run \`agent-progress ticket status ${reference} ${renamedStatus}\``);
  }
  return transitionOneTicket(writtenStatus, reference, commandArguments, context, false);
}

export const ticketCommand: CommandHandler = async (commandArguments, context) => {
  const subcommand = commandArguments.positionals()[0];

  if (subcommand !== undefined && Object.hasOwn(RETIRED_SUBCOMMAND_REPLACEMENTS, subcommand)) refuseARetiredSubcommand(subcommand, commandArguments);
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
    const reviewBarRequest = sendsToReview ? reviewBarRequestFrom(commandArguments, 'finish') : null;
    return transitionOneTicket(targetStatus, reference, commandArguments, context, true, reviewBarRequest);
  }

  throw new OperationRefusal(
    'refused',
    `${subcommand === undefined ? 'agent-progress ticket needs a subcommand' : `"${subcommand}" is not an agent-progress ticket subcommand`}.\n  Usage: ${USAGE}`,
  );
};
