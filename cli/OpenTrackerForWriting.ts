/** Runs the tracker service's write pipeline for a command: the workspace, the `--at` stamp and the skipped-file report are the command line's. */
import { Baton }                                                 from '../src/services/overseer/Baton.ts';
import { overseerFilesIn }                                       from '../src/services/overseer/OverseerFiles.ts';
import { writeTracker, type TrackerChange, type TrackerWritten } from '../src/services/tracker/TrackerPipeline.ts';
import { requireWorkspace }                                      from '../src/services/tracker/Workspace.ts';
import { OperationRefusal }                                      from '../src/shared/OperationRefusal.ts';
import { OVERSEER_NUDGE_TIMEOUT_MILLISECONDS }                   from '../src/shared/constants/OverseerLimits.ts';
import type { CommandContext }                                   from './CommandContext.ts';
import { registerWrittenTracker }                                from './RegisterWrittenTracker.ts';
import type { ArgumentParser }                                   from './arguments/ArgumentParser.ts';
import { NextLineUtil }                                          from './utils/NextLineUtil.ts';
import { OptionValueUtil }                                       from './utils/OptionValueUtil.ts';
import { OutputUtil }                                            from './utils/OutputUtil.ts';

async function writeTrackerForCommand<MutationResult>(
  commandArguments: ArgumentParser,
  context: CommandContext,
  mutate: (change: TrackerChange) => MutationResult | Promise<MutationResult>,
): Promise<TrackerWritten<MutationResult>> {
  // A relayed verb ended at its Hatch; one reaching the tracker under a job wrote something no control command carries.
  if (context.job !== undefined) {
    throw new OperationRefusal('refused', { kind: 'verb-not-relayable', verb: context.commandVerb, jobId: context.job.jobId });
  }
  const workspace = requireWorkspace(context.currentDirectory);
  const at        = OptionValueUtil.atStampFrom(commandArguments, context.now());
  const written   = await writeTracker({
    workspace, at, now: context.now, mutate
  });
  // The store is already written, so a skipped file never fails the command: exit 0, named on standard error.
  OutputUtil.reportIgnoredTicketFiles(context, written.malformedTickets);
  OutputUtil.reportIgnoredEpicFiles(context, written.malformedEpics);
  await registerWrittenTracker(context, workspace);
  await nudgeTheOverseer(workspace.trackerDirectory);
  return written;
}

/**
 * After the lock is released, so the pass it wakes can take it: a body-less `POST /api/nudge` to the live Baton's URL. Silent whatever
 * happens, since the Overseer's watch of the data folder notices the write anyway; the verb itself only recorded.
 */
async function nudgeTheOverseer(trackerDirectory: string): Promise<void> {
  const newest = Baton.newestBatonOf(overseerFilesIn(trackerDirectory).overseerDirectory);
  if (newest.verdict !== 'live') return;
  try {
    await fetch(new URL('api/nudge', newest.record.url), { method: 'POST', signal: AbortSignal.timeout(OVERSEER_NUDGE_TIMEOUT_MILLISECONDS) });
  } catch {
    // Best effort: an Overseer busy, stopping or gone is woken by its watch or its sweep.
  }
}

export async function openTrackerForWriting<MutationResult>(
  commandArguments: ArgumentParser,
  context: CommandContext,
  mutate: (change: TrackerChange) => MutationResult | Promise<MutationResult>,
): Promise<MutationResult> {
  const written = await writeTrackerForCommand(commandArguments, context, mutate);
  return written.result;
}

/** The Next line is read from the Board just written, which only this invocation holds, so it never predates the move. */
export async function openTrackerForWritingThenReadNextLine<MutationResult>(
  commandArguments: ArgumentParser,
  context: CommandContext,
  mutate: (change: TrackerChange) => MutationResult | Promise<MutationResult>,
): Promise<{ result: MutationResult; nextLine: string }> {
  const written = await writeTrackerForCommand(commandArguments, context, mutate);
  return { result: written.result, nextLine: NextLineUtil.nextLineOf(written.board) };
}
