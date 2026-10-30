/**
 * The Overseer kinds of the control contract. Pausing and resuming write the stored drain flag, `overseerState`, with the Overseer up or
 * down; stopping and restarting are runtime only, so applied to the board they are refused rather than mistaken for a change.
 */
import type { ControlCommand } from '../../shared/@types/ControlCommand.ts';
import { OperationRefusal }    from '../../shared/OperationRefusal.ts';
import type { TrackerChange }  from '../tracker/TrackerPipeline.ts';

function refuseRuntimeOnly(command: ControlCommand): never {
  throw new OperationRefusal('refused', { kind: 'overseer-control-is-runtime-only', commandKind: command.kind });
}

export const OVERSEER_CONTROLS = {
  'overseer-pause':   (_command: ControlCommand, change: TrackerChange) => change.board.setOverseerState('paused', change.at),
  'overseer-resume':  (_command: ControlCommand, change: TrackerChange) => change.board.setOverseerState('running', change.at),
  'overseer-stop':    refuseRuntimeOnly,
  'overseer-restart': refuseRuntimeOnly,
} as const;
