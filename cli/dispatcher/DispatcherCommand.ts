import { LogUtil }                                                 from '../../src/adapters/utils/LogUtil';
import type { DispatcherState }                                    from '../../src/lib/tracker-model/@types/ProgressFile';
import { DEFAULT_DISPATCHER_STATE, DISPATCHER_STATES }             from '../../src/lib/tracker-model/constants/DispatcherStates';
import { BoardSettingsUtil }                                       from '../../src/lib/tracker-model/utils/BoardSettingsUtil';
import { requireWorkspace }                                        from '../../src/services/tracker/Workspace';
import { OperationRefusal }                                        from '../../src/shared/OperationRefusal';
import type { CommandContext }                                     from '../CommandContext';
import { openTrackerForWriting, printEntity, requireProgressFile } from '../CommandSupport';
import type { CommandHandler }                                     from '../CommandTable';
import type { ArgumentParser }                                     from '../arguments/ArgumentParser';

const USAGE = `agent-progress dispatcher [${DISPATCHER_STATES.join('|')}] [--run <runId>] [--json]`;

const KNOWN_OPTION_NAMES = ['json', 'run'];

/** Only a running dispatcher is a Workflow run that can be resumed. */
const STATE_THAT_HOLDS_A_RUN: DispatcherState = 'running';

/** The read takes no lock and writes nothing, so a tracker that never set a state reads `stopped` and keeps its file as it was. */
function printCurrentState(commandArguments: ArgumentParser, context: CommandContext): void {
  const progress            = requireProgressFile(requireWorkspace(context.currentDirectory));
  const dispatcherState     = progress.dispatcherState ?? DEFAULT_DISPATCHER_STATE;
  const { dispatcherRunId } = progress;
  const entity              = dispatcherRunId === undefined ? { dispatcherState } : { dispatcherState, dispatcherRunId };
  printEntity(commandArguments, context, entity, LogUtil.dispatcherStateTextOf(dispatcherState, dispatcherRunId ?? null));
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
  if (!BoardSettingsUtil.dispatcherStateIsKnown(written)) {
    throw new OperationRefusal('refused', `"${written}" is not a dispatcher state. Write one of ${DISPATCHER_STATES.join(', ')}.\n  Usage: ${USAGE}`);
  }
  if (runId !== undefined && written !== STATE_THAT_HOLDS_A_RUN) {
    throw new OperationRefusal('refused', `A ${written} dispatcher is no run, so --run goes with ${STATE_THAT_HOLDS_A_RUN} alone.\n  Usage: ${USAGE}`);
  }
  if (runId !== undefined && !BoardSettingsUtil.dispatcherRunIdIsWellFormed(runId)) throw new OperationRefusal('refused', `--run needs a Workflow run id.\n  Usage: ${USAGE}`);

  const { logged, previousState } = await openTrackerForWriting(
    commandArguments,
    context,
    (change) => change.board.setDispatcherState(written, runId ?? null, change.at),
  );

  const loggedSentence = logged.map((record) => LogUtil.sentenceOf(record)).join('\n');
  const entity         = runId === undefined ? { dispatcherState: written, previousState } : { dispatcherState: written, dispatcherRunId: runId, previousState };
  printEntity(commandArguments, context, entity, `${loggedSentence} (was ${previousState}).`);
};
