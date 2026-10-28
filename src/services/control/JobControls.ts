/**
 * The job and intake kinds of the control contract. Each records in the hold and the runner carries it out, so every one works with the
 * runner down; `job fresh` is a stop whose job ends `replaced`, so the policy launches the next attempt on the same worktree.
 */
import type { ControlCommandOf } from '../../shared/@types/ControlCommand.ts';
import { OperationRefusal }      from '../../shared/OperationRefusal.ts';
import type { TrackerChange }    from '../tracker/TrackerPipeline.ts';

function closeIntake(command: ControlCommandOf<'intake-close'>, change: TrackerChange) {
  if (command.jobId === undefined) throw new OperationRefusal('refused', { kind: 'intake-close-without-job' });
  return change.board.closeIntake(command.jobId, command.proposedDraftSets, change.at);
}

export const JOB_CONTROLS = {
  'job-stop':     (command: ControlCommandOf<'job-stop'>, change: TrackerChange) => change.board.requestJobStop(command.jobId, command.mode, change.at),
  'job-fresh':    (command: ControlCommandOf<'job-fresh'>, change: TrackerChange) => change.board.requestJobStop(command.jobId, 'fresh', change.at),
  'job-stop-all': (command: ControlCommandOf<'job-stop-all'>, change: TrackerChange) => change.board.stopAllJobs(command.mode, change.at),
  'job-message':  (command: ControlCommandOf<'job-message'>, change: TrackerChange) => change.board.messageJob(command.jobId, command.text, change.at),
  'intake-start': (command: ControlCommandOf<'intake-start'>, change: TrackerChange) => change.board.startIntake(command.text, change.at),
  'intake-close': closeIntake,
} as const;
