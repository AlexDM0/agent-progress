/**
 * The sequence every mutating command follows, written once: take the lock of `lib/platform/Lock.ts`, read, mutate, write the
 * progress file, write the queued tickets, render through `lib/render/Rerender.ts` — all inside the lock, in that order, so no older
 * render lands last and the progress file is never behind the tickets.
 */
import { JSON_INDENT }                      from '../lib/constants/Limits';
import type { ProgressFile, Ticket }        from '../lib/constants/Types';
import { withLock }                         from '../lib/platform/Lock';
import { OperationRefusal }                 from '../lib/platform/OperationRefusal';
import { requireWorkspace, type Workspace } from '../lib/platform/Workspace';
import {
  addTask,
  appendLogEntry,
  findTask,
  readProgressFile,
  transitionTask,
  writeProgressFile
}                                               from '../lib/progress/ProgressStore';
import { rerenderDashboard, type RerenderOutcome } from '../lib/render/Rerender';
import { listTickets, writeTicket }                from '../lib/tickets/TicketStore';
import type { ProgressOperations }                 from '../lib/tickets/TicketTransitions';
import { TimeUtil }                                from '../lib/utils/TimeUtil';
import type { CommandContext }                     from './CommandContext';
import type { ArgumentParser }                     from './arguments/ArgumentParser';

export const progressOperations: ProgressOperations = {
  addTask,
  appendLogEntry,
  findTask,
  transitionTask,
};

export interface TrackerChange {
  progress:              ProgressFile;
  workspace:             Workspace;
  at:                    string;
  writeTicketAfterwards: (ticket: Ticket) => void;
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

export function printEntity(commandArguments: ArgumentParser, context: CommandContext, entity: unknown, humanLine: string): void {
  if (commandArguments.flag('json')) {
    context.standardOutput(JSON.stringify(entity, null, JSON_INDENT));
    return;
  }
  context.standardOutput(humanLine);
}

function trackerReads(): { readProgressFile: typeof readProgressFile; listTickets: typeof listTickets } {
  return { listTickets, readProgressFile };
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
  for (const malformed of outcome.malformedTickets) {
    const place = malformed.line > 0 ? ` (line ${malformed.line})` : '';
    context.standardError(`Ticket file ignored: ${malformed.filePath}${place}: ${malformed.reason}`);
  }
}

export async function renderDashboard(context: CommandContext, workspace: Workspace): Promise<RerenderOutcome> {
  const outcome = await rerenderDashboard({ workspace, generatedAt: context.now(), reads: trackerReads() });
  reportRenderProblems(context, outcome);
  return outcome;
}

/** An unreadable progress file here is `'unrepaired'`, not `'refused'`: it was there a moment ago, so it vanished under the command. */
export async function openTrackerForWriting<MutationResult>(
  commandArguments: ArgumentParser,
  context: CommandContext,
  mutate: (change: TrackerChange) => MutationResult | Promise<MutationResult>,
): Promise<MutationResult> {
  const workspace = requireWorkspace(context.currentDirectory);
  const at        = resolveAtOption(commandArguments, context);

  return withLock(workspace, async () => {
    const progressRead = readProgressFile(workspace);
    if (progressRead.verdict !== 'readable') {
      const reason = progressRead.verdict === 'absent' ? 'it is not there' : progressRead.reason;
      throw new OperationRefusal('unrepaired', `${workspace.progressFilePath} cannot be used: ${reason}`);
    }

    const ticketsToWrite: Ticket[] = [];
    const result = await mutate({
      at,
      progress:              progressRead.progress,
      workspace,
      writeTicketAfterwards: (ticket: Ticket) => { ticketsToWrite.push(ticket); },
    });

    writeProgressFile(workspace, progressRead.progress);
    for (const ticket of ticketsToWrite) writeTicket(ticket);
    await renderDashboard(context, workspace);
    return result;
  }, context.now);
}
