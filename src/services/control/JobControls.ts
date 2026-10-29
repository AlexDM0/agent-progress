/**
 * The job and intake kinds of the control contract. Each records in the hold and the runner carries it out, so every one works with the
 * runner down; `job fresh` is a stop whose job ends `replaced`, so the policy launches the next attempt on the same worktree. Naming an
 * incident marks it handled by the move in the same hold.
 */
import { BoardRefusal }                        from '../../lib/tracker-model/BoardRefusal.ts';
import type { ControlCommandOf }               from '../../shared/@types/ControlCommand.ts';
import { OperationRefusal }                    from '../../shared/OperationRefusal.ts';
import type { TrackerChange }                  from '../tracker/TrackerPipeline.ts';
import { handledUnder, requireIncidentAllows } from './IncidentControls.ts';

function closeIntake(command: ControlCommandOf<'intake-close'>, change: TrackerChange) {
  if (command.jobId === undefined) throw new OperationRefusal('refused', { kind: 'intake-close-without-job' });
  return change.board.closeIntake(command.jobId, command.proposedDraftSets, change.at);
}

function freshAgent(command: ControlCommandOf<'job-fresh'>, change: TrackerChange) {
  if (command.incidentId !== undefined) requireIncidentAllows(change, command.incidentId, command);
  return handledUnder(change, command.incidentId, 'job-fresh', change.board.requestJobStop(command.jobId, 'fresh', change.at));
}

/** A chat turn under an incident never reaches a job waiting on User's answer, nor User's own product-owner session. */
function messageJob(command: ControlCommandOf<'job-message'>, change: TrackerChange) {
  if (command.incidentId === undefined) return change.board.messageJob(command.jobId, command.text, change.at);
  requireIncidentAllows(change, command.incidentId, command);
  const job = change.board.jobById(command.jobId);
  if (job?.kind === 'product-owner') throw new BoardRefusal({ reason: 'job-is-product-owner', jobId: command.jobId });
  const ticketAwaitsUser = change.board.decisions().some((decision) => decision.kind === 'agent-question'
    && decision.ticketIds.some((ticketId) => job?.ticketIds.includes(ticketId) === true));
  if (job?.state === 'waiting-for-answer' || ticketAwaitsUser) throw new BoardRefusal({ reason: 'job-awaits-user-answer', jobId: command.jobId });
  return handledUnder(change, command.incidentId, 'job-message', change.board.messageJob(command.jobId, command.text, change.at));
}

export const JOB_CONTROLS = {
  'job-stop':     (command: ControlCommandOf<'job-stop'>, change: TrackerChange) => change.board.requestJobStop(command.jobId, command.mode, change.at),
  'job-fresh':    freshAgent,
  'job-stop-all': (command: ControlCommandOf<'job-stop-all'>, change: TrackerChange) => change.board.stopAllJobs(command.mode, change.at),
  'job-message':  messageJob,
  'intake-start': (command: ControlCommandOf<'intake-start'>, change: TrackerChange) => change.board.startIntake(command.text, change.at),
  'intake-close': closeIntake,
} as const;
