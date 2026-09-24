import type { DispatcherState } from '../../lib/constants/Types';
import { OperationRefusal }     from '../../lib/platform/OperationRefusal';
import { requireWorkspace }     from '../../lib/platform/Workspace';
import {
  appendLogEntry,
  DISPATCHER_STATES,
  dispatcherRunIdIsWellFormed,
  dispatcherStateIsKnown,
  dispatcherStateOf,
  readProgressFile
}                                             from '../../lib/progress/ProgressStore';
import type { CommandContext }                from '../CommandContext';
import { openTrackerForWriting, printEntity } from '../CommandSupport';
import type { CommandHandler }                from '../CommandTable';
import type { ArgumentParser }                from '../arguments/ArgumentParser';

const USAGE = `agent-progress dispatcher [${DISPATCHER_STATES.join('|')}] [--run <runId>] [--json]`;

const KNOWN_OPTION_NAMES = ['json', 'run'];

/** Only a running dispatcher is a Workflow run that can be resumed. */
const STATE_THAT_HOLDS_A_RUN: DispatcherState = 'running';

function stateTextOf(dispatcherState: DispatcherState, dispatcherRunId: string | undefined): string {
  return dispatcherRunId === undefined ? dispatcherState : `${dispatcherState} (run ${dispatcherRunId})`;
}

/** The read takes no lock and writes nothing, so a tracker that never set a state reads `stopped` and keeps its file as it was. */
function printCurrentState(commandArguments: ArgumentParser, context: CommandContext): void {
  const workspace    = requireWorkspace(context.currentDirectory);
  const progressRead = readProgressFile(workspace);
  if (progressRead.verdict !== 'readable') {
    const reason = progressRead.verdict === 'absent' ? 'it is not there' : progressRead.reason;
    throw new OperationRefusal('unrepaired', `${workspace.progressFilePath} cannot be read: ${reason}`);
  }
  const dispatcherState     = dispatcherStateOf(progressRead.progress);
  const { dispatcherRunId } = progressRead.progress;
  const entity              = dispatcherRunId === undefined ? { dispatcherState } : { dispatcherState, dispatcherRunId };
  printEntity(commandArguments, context, entity, stateTextOf(dispatcherState, dispatcherRunId));
}

/** Every write replaces the stored run id: a `running` without `--run` is a launch whose id is not known yet, and an older id would be resumed wrongly. */
export const dispatcherCommand: CommandHandler = async (commandArguments, context) => {
  commandArguments.rejectUnknownOptions(KNOWN_OPTION_NAMES, USAGE);
  commandArguments.rejectExtraPositionals(1, USAGE);

  const written = commandArguments.positional();
  const runId   = commandArguments.option('run');
  if (written === undefined) {
    if (runId !== undefined) {
      throw new OperationRefusal('refused', `--run is stored with the state ${STATE_THAT_HOLDS_A_RUN}: dispatcher ${STATE_THAT_HOLDS_A_RUN} --run <runId>.\n  Usage: ${USAGE}`);
    }
    printCurrentState(commandArguments, context);
    return;
  }
  if (!dispatcherStateIsKnown(written)) {
    throw new OperationRefusal('refused', `"${written}" is not a dispatcher state. Write one of ${DISPATCHER_STATES.join(', ')}.\n  Usage: ${USAGE}`);
  }
  if (runId !== undefined && written !== STATE_THAT_HOLDS_A_RUN) {
    throw new OperationRefusal('refused', `A ${written} dispatcher is no run, so --run goes with ${STATE_THAT_HOLDS_A_RUN} alone.\n  Usage: ${USAGE}`);
  }
  if (runId !== undefined && !dispatcherRunIdIsWellFormed(runId)) throw new OperationRefusal('refused', `--run needs a Workflow run id.\n  Usage: ${USAGE}`);

  const writtenText   = stateTextOf(written, runId);
  const previousState = await openTrackerForWriting(commandArguments, context, (change) => {
    const stateBefore                = dispatcherStateOf(change.progress);
    change.progress.dispatcherState = written;
    if (runId === undefined) delete change.progress.dispatcherRunId;
    else change.progress.dispatcherRunId = runId;
    appendLogEntry(change.progress, change.at, `Dispatcher set to ${writtenText}`);
    return stateBefore;
  });

  const entity = runId === undefined ? { dispatcherState: written, previousState } : { dispatcherState: written, dispatcherRunId: runId, previousState };
  printEntity(commandArguments, context, entity, `Dispatcher set to ${writtenText} (was ${previousState}).`);
};
