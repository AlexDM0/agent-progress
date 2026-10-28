/** Runs the tracker service's write pipeline for a command: the workspace, the `--at` stamp and the render report are the command line's. */
import type { DispatcherState }                                  from '../src/lib/tracker-model/@types/TrackerProgress.ts';
import { writeTracker, type TrackerChange, type TrackerWritten } from '../src/services/tracker/TrackerPipeline.ts';
import { requireWorkspace }                                      from '../src/services/tracker/Workspace.ts';
import { OperationRefusal }                                      from '../src/shared/OperationRefusal.ts';
import type { CommandContext }                                   from './CommandContext.ts';
import { registerWrittenDashboard }                              from './RegisterWrittenDashboard.ts';
import type { ArgumentParser }                                   from './arguments/ArgumentParser.ts';
import { NextLineUtil }                                          from './utils/NextLineUtil.ts';
import { OptionValueUtil }                                       from './utils/OptionValueUtil.ts';
import { OutputUtil }                                            from './utils/OutputUtil.ts';

async function writeTrackerForCommand<MutationResult>(
  commandArguments: ArgumentParser,
  context: CommandContext,
  mutate: (change: TrackerChange) => MutationResult | Promise<MutationResult>,
): Promise<TrackerWritten<MutationResult>> {
  // A relayed verb ended at its relay; one reaching the tracker under a job wrote something no control command carries.
  if (context.job !== undefined) {
    throw new OperationRefusal('refused', { kind: 'verb-not-relayable', verb: context.commandVerb, jobId: context.job.jobId });
  }
  const workspace = requireWorkspace(context.currentDirectory);
  const at        = OptionValueUtil.atStampFrom(commandArguments, context.now());
  const written   = await writeTracker({
    workspace, at, now: context.now, renderState: context.renderState, mutate
  });
  OutputUtil.reportRenderProblems(context, written.renderOutcome);
  await registerWrittenDashboard(context, workspace, written.renderOutcome);
  return written;
}

export async function openTrackerForWriting<MutationResult>(
  commandArguments: ArgumentParser,
  context: CommandContext,
  mutate: (change: TrackerChange) => MutationResult | Promise<MutationResult>,
): Promise<MutationResult> {
  const written = await writeTrackerForCommand(commandArguments, context, mutate);
  return written.result;
}

/** The Next line and the dispatcher state are read from the Board just written, which only this invocation holds, so neither predates the move. */
export async function openTrackerForWritingThenReadNextLine<MutationResult>(
  commandArguments: ArgumentParser,
  context: CommandContext,
  mutate: (change: TrackerChange) => MutationResult | Promise<MutationResult>,
): Promise<{ result: MutationResult; nextLine: string; dispatcherState: DispatcherState }> {
  const written = await writeTrackerForCommand(commandArguments, context, mutate);
  return { result: written.result, nextLine: NextLineUtil.nextLineOf(written.board), dispatcherState: written.board.dispatcherState() };
}
