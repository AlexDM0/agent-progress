/**
 * The sequence every mutating command follows, written once: take the lock of `lib/platform/Lock.ts`, read the progress file and the
 * tickets into a Board, mutate, write the progress file, then the tickets the Board changed, then render through
 * `lib/render/Rerender.ts` — all inside the lock, in that order, so no older render lands last and the progress file is never behind the tickets.
 */
import { withLock }                                from '../lib/platform/Lock';
import { requireWorkspace, type Workspace }        from '../lib/platform/Workspace';
import { readProgressFile, writeProgressFile }     from '../lib/progress/ProgressStore';
import { rerenderDashboard, type RerenderOutcome } from '../lib/render/Rerender';
import {
  deleteAllTickets,
  listTickets,
  writeTicket,
  type MalformedTicketFile
}                                             from '../lib/tickets/TicketStore';
import { NextLineUtil }                       from '../lib/utils/NextLineUtil';
import { createProgressLogSink }              from '../src/adapters/ProgressLogSink';
import { BoardRefusalWordingUtil }            from '../src/adapters/utils/BoardRefusalWordingUtil';
import type { Concurrency }                   from '../src/lib/tracker-model/@types/Concurrency';
import type { DispatcherState, ProgressFile } from '../src/lib/tracker-model/@types/ProgressFile';
import type {
  AgentEffort,
  AgentModel,
  Ticket,
  TicketPriority
} from '../src/lib/tracker-model/@types/Ticket';
import { Board }                 from '../src/lib/tracker-model/Board';
import { refusalIsBoardRefusal } from '../src/lib/tracker-model/BoardRefusal';
import { createLogger }          from '../src/lib/tracker-model/Logger';
import { ConcurrencyUtil }       from '../src/lib/tracker-model/utils/ConcurrencyUtil';
import { TicketDefaultsUtil }    from '../src/lib/tracker-model/utils/TicketDefaultsUtil';
import { TimeUtil }              from '../src/lib/utils/TimeUtil';
import { TokenCountUtil }        from '../src/lib/utils/TokenCountUtil';
import { OperationRefusal }      from '../src/shared/OperationRefusal';
import { LIMITS }                from '../src/shared/constants/Limits';
import type { CommandContext }   from './CommandContext';
import type { ArgumentParser }   from './arguments/ArgumentParser';

export interface TrackerChange {
  board:                          Board;
  workspace:                      Workspace;
  at:                             string;
  malformedTickets:               readonly MalformedTicketFile[];
  /** How many entries the log held when it was read, before anything this invocation logged. */
  storedLogEntryCount:            number;
  /** `clear --all`: after the progress file and the changed tickets, before the render; the callback gets the deleted file count. */
  deleteAllTicketFilesAfterwards: (onDeleted: (deletedTicketCount: number) => void) => void;
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
  return { ...ticket.frontmatter, priority: TicketDefaultsUtil.ticketPriorityOf(ticket.frontmatter), filePath: ticket.filePath };
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

export function printEntity(commandArguments: ArgumentParser, context: CommandContext, entity: unknown, humanLine: string): void {
  if (commandArguments.flag('json')) {
    context.standardOutput(JSON.stringify(entity, null, LIMITS.JSON_INDENT));
    return;
  }
  context.standardOutput(humanLine);
}

/** A Board for the commands that only read: what it would log goes nowhere, and nothing it holds is written. */
export function boardForReading(progress: ProgressFile, tickets: Ticket[]): Board {
  return new Board({ progress, tickets, logger: createLogger(() => undefined) });
}

/**
 * What a dispatcher needs to start the next agent: the limit, the agents in flight against it, what is left, and the tickets that could take it —
 * in the order to take them, high first, with low tickets held back while normal or high work is still owed — and where the user left the dispatcher.
 */
export function concurrencyDocumentOf(board: Board): Concurrency & { readyTicketIds: string[]; dispatcherState: DispatcherState; heldTicketIds: string[] } {
  return {
    ...board.concurrency(),
    readyTicketIds:  board.readyTickets().map((ticket) => ticket.frontmatter.id),
    dispatcherState: board.dispatcherState(),
    heldTicketIds:   board.heldTicketIds(),
  };
}

export interface ReadyTicket {
  id:       string;
  priority: TicketPriority;
  model:    AgentModel;
  effort:   AgentEffort;
  /** Present, and true, only on a held ticket. */
  held?:    true;
}

/** Read from the Board's ready tickets, as `readyTicketIds` is, so the two lists cannot disagree on a member or the order; defaults resolved here. */
export function readyTicketsOf(board: Board): ReadyTicket[] {
  return board.readyTickets().map(({ frontmatter }) => ({
    id:       frontmatter.id,
    priority: TicketDefaultsUtil.ticketPriorityOf(frontmatter),
    model:    TicketDefaultsUtil.agentModelOf(frontmatter),
    effort:   TicketDefaultsUtil.agentEffortOf(frontmatter),
    ...(frontmatter.hold === undefined ? {} : { held: true as const }),
  }));
}

export function nextLineFor(board: Board): string {
  const lowPriorityReadyTickets = board.readyTickets().filter((ticket) => TicketDefaultsUtil.ticketPriorityOf(ticket.frontmatter) === 'low');
  return NextLineUtil.composeNextLine({
    ...concurrencyDocumentOf(board),
    lowPriorityReadyTicketIds: lowPriorityReadyTickets.map((ticket) => ticket.frontmatter.id),
  });
}

function trackerReads(): { readProgressFile: typeof readProgressFile; listTickets: typeof listTickets; concurrencyOf: (progress: ProgressFile) => Concurrency } {
  return {
    listTickets,
    readProgressFile,
    concurrencyOf: (progress) => ConcurrencyUtil.concurrencyOf(progress.tasks, progress.concurrencyLimit),
  };
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

/** A Board refusal is one the caller can act on, worded here at the edge; nothing has been written when it is thrown. */
async function mutateRefusingInWords<MutationResult>(
  mutate: (change: TrackerChange) => MutationResult | Promise<MutationResult>,
  change: TrackerChange,
): Promise<MutationResult> {
  try {
    return await mutate(change);
  } catch (error) {
    if (refusalIsBoardRefusal(error)) throw new OperationRefusal('refused', BoardRefusalWordingUtil.messageOf(error.detail));
    throw error;
  }
}

async function writeTrackerUnderLock<MutationResult, Reading>(
  commandArguments: ArgumentParser,
  context: CommandContext,
  mutate: (change: TrackerChange) => MutationResult | Promise<MutationResult>,
  readAfterWriting: (board: Board) => Reading,
): Promise<{ result: MutationResult; reading: Reading }> {
  const workspace = requireWorkspace(context.currentDirectory);
  const at        = resolveAtOption(commandArguments, context);

  return withLock(workspace, async () => {
    const progress            = requireProgressFile(workspace);
    const listing             = listTickets(workspace);
    const storedLogEntryCount = progress.log.length;
    const board               = new Board({ progress, tickets: listing.tickets, logger: createLogger(createProgressLogSink(progress.log)) });

    const deletionCallbacks: ((deletedTicketCount: number) => void)[] = [];
    const result = await mutateRefusingInWords(mutate, {
      at,
      board,
      workspace,
      malformedTickets:               listing.malformed,
      storedLogEntryCount,
      deleteAllTicketFilesAfterwards: (onDeleted) => { deletionCallbacks.push(onDeleted); },
    });

    writeProgressFile(workspace, progress);
    for (const ticket of board.changedTickets()) writeTicket(ticket);
    for (const onDeleted of deletionCallbacks) onDeleted(deleteAllTickets(workspace));
    const reading = readAfterWriting(board);
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

/** The Next line and the dispatcher state are read from the Board just written, inside the same lock hold, so neither predates the move. */
export async function openTrackerForWritingThenReadNextLine<MutationResult>(
  commandArguments: ArgumentParser,
  context: CommandContext,
  mutate: (change: TrackerChange) => MutationResult | Promise<MutationResult>,
): Promise<{ result: MutationResult; nextLine: string; dispatcherState: DispatcherState }> {
  const { result, reading } = await writeTrackerUnderLock(
    commandArguments,
    context,
    mutate,
    (board) => ({ nextLine: nextLineFor(board), dispatcherState: board.dispatcherState() }),
  );
  return { result, ...reading };
}

/** The human line and the Next line under it, or the entity alone under `--json`, which a script parses and must never find a trailing sentence in. */
export function printEntityThenNextLine(commandArguments: ArgumentParser, context: CommandContext, entity: unknown, humanLine: string, nextLine: string): void {
  printEntity(commandArguments, context, entity, `${humanLine}\n${nextLine}`);
}
