import { LogUtil }               from '../../../src/adapters/utils/LogUtil.ts';
import { StatusWordingUtil }     from '../../../src/adapters/utils/StatusWordingUtil.ts';
import type { DispatcherState }  from '../../../src/lib/tracker-model/@types/ProgressFile.ts';
import { readingBoardOf }        from '../../../src/lib/tracker-model/ReadingBoard.ts';
import { DISPATCHER_STATES }     from '../../../src/lib/tracker-model/constants/DispatcherStates.ts';
import { BoardSettingsUtil }     from '../../../src/lib/tracker-model/utils/BoardSettingsUtil.ts';
import { requireProgressFile }   from '../../../src/services/tracker/TrackerReader.ts';
import { requireWorkspace }      from '../../../src/services/tracker/Workspace.ts';
import { OperationRefusal }      from '../../../src/shared/OperationRefusal.ts';
import type { CommandContext }   from '../../CommandContext.ts';
import type { CommandHandler }   from '../../CommandTable.ts';
import { openTrackerForWriting } from '../../TrackerWriting.ts';
import type { ArgumentParser }   from '../../arguments/ArgumentParser.ts';
import { OutputUtil }            from '../../utils/OutputUtil.ts';

const USAGE = `agent-progress dispatcher [${DISPATCHER_STATES.join('|')}] [--run <runId>] [--json]`;

const KNOWN_OPTION_NAMES = ['json', 'run'];

/** Only a running dispatcher is a Workflow run that can be resumed. */
const STATE_THAT_HOLDS_A_RUN: DispatcherState = 'running';

/** The read takes no lock and writes nothing, so a tracker that never set a state reads `stopped` and keeps its file as it was. */
function printCurrentState(commandArguments: ArgumentParser, context: CommandContext): void {
  // Built over progress.json alone, so a broken log or ticket file does not stop this read.
  const board           = readingBoardOf(requireProgressFile(requireWorkspace(context.currentDirectory)), []);
  const dispatcherState = board.dispatcherState();
  const dispatcherRunId = board.dispatcherRunId();
  const entity          = dispatcherRunId === undefined ? { dispatcherState } : { dispatcherState, dispatcherRunId };
  OutputUtil.printEntity(commandArguments, context, entity, LogUtil.dispatcherStateTextOf(dispatcherState, dispatcherRunId ?? null));
}

/** Every write replaces the stored run id: a `running` without `--run` is a launch whose id is not known yet, and an older id would be resumed wrongly. */
export const dispatcherCommand: CommandHandler = async (commandArguments, context) => {
  commandArguments.rejectUnknownOptions(KNOWN_OPTION_NAMES, USAGE);
  commandArguments.rejectExtraPositionals(1, USAGE);

  const written = commandArguments.positional();
  const runId   = commandArguments.option('run');
  if (written === undefined) {
    if (runId !== undefined) {
      const stateWord = StatusWordingUtil.dispatcherStateWordFor(STATE_THAT_HOLDS_A_RUN);
      throw new OperationRefusal('refused', `--run is stored with the state ${stateWord}: dispatcher ${STATE_THAT_HOLDS_A_RUN} --run <runId>.\n  Usage: ${USAGE}`);
    }
    printCurrentState(commandArguments, context);
    return;
  }
  if (!BoardSettingsUtil.dispatcherStateIsKnown(written)) {
    const stateWordsText = DISPATCHER_STATES.map(StatusWordingUtil.dispatcherStateWordFor).join(', ');
    throw new OperationRefusal('refused', `"${written}" is not a dispatcher state. Write one of ${stateWordsText}.\n  Usage: ${USAGE}`);
  }
  if (runId !== undefined && written !== STATE_THAT_HOLDS_A_RUN) {
    const writtenStateWord = StatusWordingUtil.dispatcherStateWordFor(written);
    const runStateWord     = StatusWordingUtil.dispatcherStateWordFor(STATE_THAT_HOLDS_A_RUN);
    throw new OperationRefusal('refused', `A ${writtenStateWord} dispatcher is no run, so --run goes with ${runStateWord} alone.\n  Usage: ${USAGE}`);
  }
  if (runId !== undefined && !BoardSettingsUtil.dispatcherRunIdIsWellFormed(runId)) throw new OperationRefusal('refused', `--run needs a Workflow run id.\n  Usage: ${USAGE}`);

  const { logged, previousState } = await openTrackerForWriting(
    commandArguments,
    context,
    (change) => change.board.setDispatcherState(written, runId ?? null, change.at),
  );

  const loggedSentence = logged.map((record) => LogUtil.sentenceOf(record)).join('\n');
  const entity         = runId === undefined ? { dispatcherState: written, previousState } : { dispatcherState: written, dispatcherRunId: runId, previousState };
  OutputUtil.printEntity(commandArguments, context, entity, `${loggedSentence} (was ${StatusWordingUtil.dispatcherStateWordFor(previousState)}).`);
};
