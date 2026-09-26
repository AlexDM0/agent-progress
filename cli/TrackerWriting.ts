/** Runs the tracker service's write pipeline for a command: the workspace, the `--at` stamp and the render report are the command line's. */
import type { DispatcherState }                                  from '../src/lib/tracker-model/@types/ProgressFile';
import { writeTracker, type TrackerChange, type TrackerWritten } from '../src/services/tracker/TrackerPipeline';
import { requireWorkspace }                                      from '../src/services/tracker/Workspace';
import type { CommandContext }                                   from './CommandContext';
import type { ArgumentParser }                                   from './arguments/ArgumentParser';
import { NextLineUtil }                                          from './utils/NextLineUtil';
import { OptionValueUtil }                                       from './utils/OptionValueUtil';
import { OutputUtil }                                            from './utils/OutputUtil';

async function writeTrackerForCommand<MutationResult>(
  commandArguments: ArgumentParser,
  context: CommandContext,
  mutate: (change: TrackerChange) => MutationResult | Promise<MutationResult>,
): Promise<TrackerWritten<MutationResult>> {
  const workspace = requireWorkspace(context.currentDirectory);
  const at        = OptionValueUtil.resolveAtOption(commandArguments, context.now());
  const written   = await writeTracker({
    workspace, at, now: context.now, renderState: context.renderState, mutate
  });
  OutputUtil.reportRenderProblems(context, written.renderOutcome);
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
