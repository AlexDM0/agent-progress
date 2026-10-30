/** The board settings kinds of the control contract: the concurrency limit and the gate pipeline the `gate` verbs write. */
import type { ControlCommandOf as CommandOf } from '../../shared/@types/ControlCommand.ts';
import { OperationRefusal }                   from '../../shared/OperationRefusal.ts';
import type { TrackerChange }                 from '../tracker/TrackerPipeline.ts';

/** A malformed `pipeline.json` is never written over: a hand edit gone wrong is repaired, not lost. */
function requireReadablePipeline(change: TrackerChange): void {
  if (change.malformedPipelineReason === null) return;
  throw new OperationRefusal('refused', { kind: 'malformed-pipeline', filePath: change.workspace.pipelineFilePath, reason: change.malformedPipelineReason });
}

function inReadablePipeline<Result>(change: TrackerChange, apply: () => Result): Result {
  requireReadablePipeline(change);
  return apply();
}

export const SETTING_CONTROLS = {
  'concurrency-set':           (command: CommandOf<'concurrency-set'>, change: TrackerChange) => change.board.setConcurrencyLimit(command.limit, change.at),
  'pipeline-prepare-step-set': (command: CommandOf<'pipeline-prepare-step-set'>, change: TrackerChange) => inReadablePipeline(
    change,
    () => change.board.setPrepareStep(command.step, change.at),
  ),
  'pipeline-gate-add':    (command: CommandOf<'pipeline-gate-add'>, change: TrackerChange) => inReadablePipeline(change, () => change.board.addGate(command.gate, change.at)),
  'pipeline-gates-none':  (_command: CommandOf<'pipeline-gates-none'>, change: TrackerChange) => inReadablePipeline(change, () => change.board.setNoGates(change.at)),
  'pipeline-gate-remove': (command: CommandOf<'pipeline-gate-remove'>, change: TrackerChange) => inReadablePipeline(
    change,
    () => change.board.removeGate(command.name, change.at),
  ),
} as const;
