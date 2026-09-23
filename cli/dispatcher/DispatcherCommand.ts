import { OperationRefusal } from '../../lib/platform/OperationRefusal';
import { requireWorkspace } from '../../lib/platform/Workspace';
import {
  appendLogEntry,
  DISPATCHER_STATES,
  dispatcherStateIsKnown,
  dispatcherStateOf,
  readProgressFile
}                                             from '../../lib/progress/ProgressStore';
import type { CommandContext }                from '../CommandContext';
import { openTrackerForWriting, printEntity } from '../CommandSupport';
import type { CommandHandler }                from '../CommandTable';
import type { ArgumentParser }                from '../arguments/ArgumentParser';

const USAGE = `agent-progress dispatcher [${DISPATCHER_STATES.join('|')}] [--json]`;

const KNOWN_OPTION_NAMES = ['json'];

/** The read takes no lock and writes nothing, so a tracker that never set a state reads `stopped` and keeps its file as it was. */
function printCurrentState(commandArguments: ArgumentParser, context: CommandContext): void {
  const workspace    = requireWorkspace(context.currentDirectory);
  const progressRead = readProgressFile(workspace);
  if (progressRead.verdict !== 'readable') {
    const reason = progressRead.verdict === 'absent' ? 'it is not there' : progressRead.reason;
    throw new OperationRefusal('unrepaired', `${workspace.progressFilePath} cannot be read: ${reason}`);
  }
  const dispatcherState = dispatcherStateOf(progressRead.progress);
  printEntity(commandArguments, context, { dispatcherState }, dispatcherState);
}

export const dispatcherCommand: CommandHandler = async (commandArguments, context) => {
  commandArguments.rejectUnknownOptions(KNOWN_OPTION_NAMES, USAGE);
  commandArguments.rejectExtraPositionals(1, USAGE);

  const written = commandArguments.positional();
  if (written === undefined) {
    printCurrentState(commandArguments, context);
    return;
  }
  if (!dispatcherStateIsKnown(written)) {
    throw new OperationRefusal('refused', `"${written}" is not a dispatcher state. Write one of ${DISPATCHER_STATES.join(', ')}.\n  Usage: ${USAGE}`);
  }

  const previousState = await openTrackerForWriting(commandArguments, context, (change) => {
    const stateBefore                = dispatcherStateOf(change.progress);
    change.progress.dispatcherState = written;
    appendLogEntry(change.progress, change.at, `Dispatcher set to ${written}`);
    return stateBefore;
  });

  printEntity(commandArguments, context, { dispatcherState: written, previousState }, `Dispatcher set to ${written} (was ${previousState}).`);
};
