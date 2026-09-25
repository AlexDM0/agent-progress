/**
 * The sequence every mutating command follows, written once: take the lock of `lib/platform/Lock.ts`, read, mutate, write the
 * progress file, write the queued tickets, render through `lib/render/Rerender.ts` — all inside the lock, in that order, so no older
 * render lands last and the progress file is never behind the tickets.
 */
import { agentEffortOf, agentModelOf } from '../lib/constants/AgentSettings';
import { JSON_INDENT }                 from '../lib/constants/Limits';
import { ticketPriorityOf }            from '../lib/constants/Statuses';
import type {
  AgentEffort,
  AgentModel,
  DispatcherState,
  ProgressFile,
  Task,
  Ticket,
  TicketPriority,
  TicketStatus
}                                                     from '../lib/constants/Types';
import { withLock }                         from '../lib/platform/Lock';
import { OperationRefusal }                 from '../lib/platform/OperationRefusal';
import { requireWorkspace, type Workspace } from '../lib/platform/Workspace';
import {
  addTask,
  appendLogEntry,
  concurrencyOf,
  dispatcherStateOf,
  findTask,
  readProgressFile,
  removeTask,
  runningReviewRowsOf,
  transitionTask,
  writeProgressFile,
  type Concurrency
}                                               from '../lib/progress/ProgressStore';
import { rerenderDashboard, type RerenderOutcome } from '../lib/render/Rerender';
import { listTickets, writeTicket }                from '../lib/tickets/TicketStore';
import type { PriorityOperations }                 from '../lib/tickets/TicketTransitions';
import { NextLineUtil }                            from '../lib/utils/NextLineUtil';
import { TicketDependencyUtil }                    from '../lib/utils/TicketDependencyUtil';
import { TimeUtil }                                from '../lib/utils/TimeUtil';
import { TokenCountUtil }                          from '../lib/utils/TokenCountUtil';
import type { CommandContext }                     from './CommandContext';
import type { ArgumentParser }                     from './arguments/ArgumentParser';

/** A ticket in one of these is never built or reviewed again, so neither its agents nor a hold on it can be changed. */
export const TICKET_STATUSES_NO_AGENT_WORKS_AGAIN: readonly TicketStatus[] = ['delivered', 'abandoned'];

export const progressOperations: PriorityOperations = {
  addTask,
  appendLogEntry,
  findTask,
  removeTask,
  transitionTask,
};

export interface TrackerChange {
  progress:                ProgressFile;
  workspace:               Workspace;
  at:                      string;
  writeTicketAfterwards:   (ticket: Ticket) => void;
  /** For a change to the tickets directory other than a write, run after the progress file and the queued tickets and before the render. */
  changeTicketsAfterwards: (step: () => void) => void;
}

/** An unreadable `--at` is refused rather than defaulted to now, which would stamp a bar nobody can explain. */
export function resolveAtOption(commandArguments: ArgumentParser, context: CommandContext): string {
  const now     = context.now();
  const written = commandArguments.option('at');
  if (written === undefined) return TimeUtil.formatLocalIso(now);

  const resolved = TimeUtil.resolveWhen(written, now);
  if (resolved === null) {
    throw new OperationRefusal(
      'refused',
      `--at "${written}" is not a time. Write an ISO 8601 timestamp, \`now\`, or a signed offset from now such as \`-5m\`, \`-2h\`, \`-1d\` or \`+30m\`.`,
    );
  }
  return TimeUtil.formatLocalIso(resolved);
}

export function tokenCountFrom(commandArguments: ArgumentParser): number | undefined {
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

export function padColumn(text: string, width: number): string {
  return text.length >= width ? `${text} ` : text.padEnd(width);
}

/** The priority is spelled out even where the file leaves it to the default, so a script never has to know what an absent key means. */
export function ticketDocumentOf(ticket: Ticket): Ticket['frontmatter'] & { priority: TicketPriority; filePath: string } {
  return { ...ticket.frontmatter, priority: ticketPriorityOf(ticket.frontmatter), filePath: ticket.filePath };
}

/**
 * Without the lock, for the read-only commands, this reads either the old file or the new one, since it is written atomically. Unreadable is
 * `'unrepaired'`: under the lock the file was there a moment ago, so it vanished or broke under the command.
 */
export function requireProgressFile(workspace: Workspace): ProgressFile {
  const progressRead = readProgressFile(workspace);
  if (progressRead.verdict !== 'readable') {
    const reason = progressRead.verdict === 'absent' ? 'it is not there' : progressRead.reason;
    throw new OperationRefusal('unrepaired', `${workspace.progressFilePath} cannot be read: ${reason}`);
  }
  return progressRead.progress;
}

export function ignoredTicketFileText(malformed: { filePath: string; line: number; reason: string }): string {
  const place = malformed.line > 0 ? ` (line ${malformed.line})` : '';
  return `Ticket file ignored: ${malformed.filePath}${place}: ${malformed.reason}`;
}

export function reportIgnoredTicketFiles(context: CommandContext, malformedTickets: readonly { filePath: string; line: number; reason: string }[]): void {
  for (const malformed of malformedTickets) context.standardError(ignoredTicketFileText(malformed));
}

/** Finishes and delivers every running review row of the tickets, with one log line each, for every move that ends their review. */
export function closeRunningReviewRows(progress: ProgressFile, ticketIds: readonly string[], at: string): Task[] {
  const closedRows = runningReviewRowsOf(progress, ticketIds);
  for (const runningRow of closedRows) {
    transitionTask(progress, runningRow.id, 'finished', at);
    transitionTask(progress, runningRow.id, 'delivered', at);
    appendLogEntry(progress, at, `Closed the review row #${runningRow.id}, delivered: ${runningRow.name}`);
  }
  return closedRows;
}

export function printEntity(commandArguments: ArgumentParser, context: CommandContext, entity: unknown, humanLine: string): void {
  if (commandArguments.flag('json')) {
    context.standardOutput(JSON.stringify(entity, null, JSON_INDENT));
    return;
  }
  context.standardOutput(humanLine);
}

/**
 * What a dispatcher needs to start the next agent: the limit, the agents in flight against it, what is left, and the tickets that could take it —
 * in the order to take them, high first, with low tickets held back while normal or high work is still owed — and where the user left the dispatcher.
 */
export function concurrencyDocumentOf(
  progress: ProgressFile,
  tickets: readonly Ticket[],
): Concurrency & { readyTicketIds: string[]; dispatcherState: DispatcherState; heldTicketIds: string[] } {
  return {
    ...concurrencyOf(progress),
    readyTicketIds:  TicketDependencyUtil.readyTicketIdsOf(tickets.map((ticket) => ticket.frontmatter)),
    dispatcherState: dispatcherStateOf(progress),
    heldTicketIds:   heldTicketIdsOf(tickets),
  };
}

/** Every held ticket a dispatcher could still start a step of, in progress or in review as much as ready. */
function heldTicketIdsOf(tickets: readonly Ticket[]): string[] {
  return tickets
    .filter((ticket) => ticket.frontmatter.hold !== undefined && !TICKET_STATUSES_NO_AGENT_WORKS_AGAIN.includes(ticket.frontmatter.status))
    .map((ticket) => ticket.frontmatter.id);
}

export interface ReadyTicket {
  id:       string;
  priority: TicketPriority;
  model:    AgentModel;
  effort:   AgentEffort;
  /** Present, and true, only on a held ticket. */
  held?:    true;
}

/** Built from `readyTicketIds` and never recomputed, so the two lists cannot disagree on a member or the order; the defaults are resolved here. */
export function readyTicketsOf(readyTicketIds: readonly string[], tickets: readonly Ticket[]): ReadyTicket[] {
  const frontmatterById = new Map(tickets.map((ticket) => [ticket.frontmatter.id, ticket.frontmatter]));
  return readyTicketIds.flatMap((ticketId) => {
    const frontmatter = frontmatterById.get(ticketId);
    if (frontmatter === undefined) return [];
    return [{
      id:       ticketId,
      priority: ticketPriorityOf(frontmatter),
      model:    agentModelOf(frontmatter),
      effort:   agentEffortOf(frontmatter),
      ...(frontmatter.hold === undefined ? {} : { held: true as const }),
    }];
  });
}

export function nextLineFor(progress: ProgressFile, tickets: readonly Ticket[]): string {
  const lowPriorityTicketIds = new Set(tickets.filter((ticket) => ticketPriorityOf(ticket.frontmatter) === 'low').map((ticket) => ticket.frontmatter.id));
  const concurrency          = concurrencyDocumentOf(progress, tickets);
  return NextLineUtil.composeNextLine({
    ...concurrency,
    lowPriorityReadyTicketIds: concurrency.readyTicketIds.filter((ticketId) => lowPriorityTicketIds.has(ticketId)),
  });
}

function trackerReads(): { readProgressFile: typeof readProgressFile; listTickets: typeof listTickets; concurrencyOf: typeof concurrencyOf } {
  return { listTickets, readProgressFile, concurrencyOf };
}

/** The store is already written by the time this runs, so none of these fail the command: exit 0, reason on standard error. */
function reportRenderProblems(context: CommandContext, outcome: RerenderOutcome): void {
  if (outcome.verdict === 'unreadable') {
    context.standardError(`The dashboard was not regenerated: ${outcome.reason}`);
    return;
  }
  if (outcome.verdict === 'rendered-without-page-script') {
    context.standardError(`The dashboard was written without its page script, so the chart is not interactive: ${outcome.reason}`);
  }
  reportIgnoredTicketFiles(context, outcome.malformedTickets);
}

export async function renderDashboard(context: CommandContext, workspace: Workspace): Promise<RerenderOutcome> {
  const outcome = await rerenderDashboard({ workspace, generatedAt: context.now(), reads: trackerReads() });
  reportRenderProblems(context, outcome);
  return outcome;
}

/** For `render` and `open`, whose whole job is the page: an unreadable tracker is their failure, reported once, by the refusal alone. */
export async function renderDashboardOrRefuse(context: CommandContext, workspace: Workspace): Promise<void> {
  const outcome = await rerenderDashboard({ workspace, generatedAt: context.now(), reads: trackerReads() });
  if (outcome.verdict === 'unreadable') {
    throw new OperationRefusal('unrepaired', `The dashboard could not be regenerated: ${outcome.reason}`);
  }
  reportRenderProblems(context, outcome);
}

async function writeTrackerUnderLock<MutationResult, Reading>(
  commandArguments: ArgumentParser,
  context: CommandContext,
  mutate: (change: TrackerChange) => MutationResult | Promise<MutationResult>,
  readAfterWriting: (workspace: Workspace, progress: ProgressFile) => Reading,
): Promise<{ result: MutationResult; reading: Reading }> {
  const workspace = requireWorkspace(context.currentDirectory);
  const at        = resolveAtOption(commandArguments, context);

  return withLock(workspace, async () => {
    const progress = requireProgressFile(workspace);

    const ticketsToWrite: Ticket[] = [];
    const ticketStepsToRun: (() => void)[] = [];
    const result = await mutate({
      at,
      progress,
      workspace,
      writeTicketAfterwards:   (ticket: Ticket) => { ticketsToWrite.push(ticket); },
      changeTicketsAfterwards: (step: () => void) => { ticketStepsToRun.push(step); },
    });

    writeProgressFile(workspace, progress);
    for (const ticket of ticketsToWrite) writeTicket(ticket);
    for (const ticketStep of ticketStepsToRun) ticketStep();
    const reading = readAfterWriting(workspace, progress);
    await renderDashboard(context, workspace);
    return { result, reading };
  }, context.now);
}

export async function openTrackerForWriting<MutationResult>(
  commandArguments: ArgumentParser,
  context: CommandContext,
  mutate: (change: TrackerChange) => MutationResult | Promise<MutationResult>,
): Promise<MutationResult> {
  const { result } = await writeTrackerUnderLock(commandArguments, context, mutate, () => undefined);
  return result;
}

/** The Next line and the dispatcher state are read from the files just written, inside the same lock hold, so neither predates the move. */
export async function openTrackerForWritingThenReadNextLine<MutationResult>(
  commandArguments: ArgumentParser,
  context: CommandContext,
  mutate: (change: TrackerChange) => MutationResult | Promise<MutationResult>,
): Promise<{ result: MutationResult; nextLine: string; dispatcherState: DispatcherState }> {
  const { result, reading } = await writeTrackerUnderLock(
    commandArguments,
    context,
    mutate,
    (workspace, progress) => ({ nextLine: nextLineFor(progress, listTickets(workspace).tickets), dispatcherState: dispatcherStateOf(progress) }),
  );
  return { result, ...reading };
}

/** The human line and the Next line under it, or the entity alone under `--json`, which a script parses and must never find a trailing sentence in. */
export function printEntityThenNextLine(commandArguments: ArgumentParser, context: CommandContext, entity: unknown, humanLine: string, nextLine: string): void {
  printEntity(commandArguments, context, entity, `${humanLine}\n${nextLine}`);
}
