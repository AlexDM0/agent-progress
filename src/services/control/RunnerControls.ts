/**
 * The runner kinds of the control contract. Pausing and resuming write the stored drain flag, `dispatcherState`, with the runner up or
 * down; stopping and restarting are runtime only, so applied to the board they are refused rather than mistaken for a change.
 */
import type { ControlCommand } from '../../shared/@types/ControlCommand.ts';
import { OperationRefusal }    from '../../shared/OperationRefusal.ts';
import type { TrackerChange }  from '../tracker/TrackerPipeline.ts';

function refuseRuntimeOnly(command: ControlCommand): never {
  throw new OperationRefusal('refused', { kind: 'runner-control-is-runtime-only', commandKind: command.kind });
}

export const RUNNER_CONTROLS = {
  'runner-pause':   (_command: ControlCommand, change: TrackerChange) => change.board.setDispatcherState('stopped', change.at),
  'runner-resume':  (_command: ControlCommand, change: TrackerChange) => change.board.setDispatcherState('running', change.at),
  'runner-stop':    refuseRuntimeOnly,
  'runner-restart': refuseRuntimeOnly,
} as const;
