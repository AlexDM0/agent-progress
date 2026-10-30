/**
 * The Airlock moves on a merge job's incident (design sections 6.3 and 8.3), each recorded in the hold for the Airlock to carry out on its
 * next sweep: `merge fixer` sets the slot fixing, `merge review` lets the slot launch its resolution reviewer, `merge land` lands a merged
 * tree whose gate passed, and `merge abort` parks the tickets so the slot aborts their merge. Every one needs an open incident.
 */
import type { Logged }                   from '../../lib/tracker-model/@types/BoardChanges.ts';
import type { Incident }                 from '../../lib/tracker-model/@types/Incident.ts';
import type { Job, AirlockPhase }        from '../../lib/tracker-model/@types/Job.ts';
import { BoardRefusal }                  from '../../lib/tracker-model/BoardRefusal.ts';
import type { ControlCommandOf }         from '../../shared/@types/ControlCommand.ts';
import type { TrackerChange }            from '../tracker/TrackerPipeline.ts';
import { handledUnder, incidentForMove } from './IncidentControls.ts';

type AirlockCommand = ControlCommandOf<'merge-fixer' | 'merge-abort' | 'merge-review' | 'merge-land'>;

interface AirlockMove {
  job:      Readonly<Job>;
  incident: Readonly<Incident>;
}

function airlockMoveOf(command: AirlockCommand, change: TrackerChange): AirlockMove {
  const incident = incidentForMove(change, command, { name: command.jobId, concerns: (open) => open.jobId === command.jobId }, true);
  const job      = change.board.jobById(command.jobId);
  if (incident === null) throw new BoardRefusal({ reason: 'no-open-incident', subject: command.jobId, move: command.kind });
  if (job?.slot === undefined) throw new BoardRefusal({ reason: 'job-holds-no-airlock', jobId: command.jobId });
  return { job, incident };
}

function movedToPhase(change: TrackerChange, move: AirlockMove, phase: AirlockPhase, kind: AirlockCommand['kind']): Logged {
  const { job, incident } = move;
  if (job.slot !== undefined) change.board.setJobSlot(job.id, { ...job.slot, phase });
  return handledUnder(change, incident.id, kind, { logged: [] });
}

function fixMerge(command: ControlCommandOf<'merge-fixer'>, change: TrackerChange): Logged {
  return movedToPhase(change, airlockMoveOf(command, change), 'fixing', command.kind);
}

/** The slot stays `reviewing-resolution`; with its incident settled the Airlock launches the reviewer, as the default would. */
function reviewMerge(command: ControlCommandOf<'merge-review'>, change: TrackerChange): Logged {
  const { incident } = airlockMoveOf(command, change);
  return handledUnder(change, incident.id, command.kind, { logged: [] });
}

/** Legal only with a passing gate stamp on the merged tree the incident names, so no move lands a tree no gate passed. */
function landMerge(command: ControlCommandOf<'merge-land'>, change: TrackerChange): Logged {
  const move = airlockMoveOf(command, change);
  const tree = Object.hasOwn(move.incident.facts, 'tree') ? move.incident.facts['tree'] ?? '' : '';
  const gatePassed = tree !== '' && change.board.logRecordsSoFar().some((record) => (
    record.kind === 'gate-ran' && record.fields.tree === tree && record.fields.outcome === 'passed'
  ));
  if (!gatePassed) throw new BoardRefusal({ reason: 'merge-gate-not-passed', jobId: command.jobId, tree });
  return movedToPhase(change, move, 'landing', command.kind);
}

function abortMerge(command: ControlCommandOf<'merge-abort'>, change: TrackerChange): Logged {
  const { incident } = airlockMoveOf(command, change);
  return change.board.abortMerge(incident.id, change.at);
}

export const AIRLOCK_CONTROLS = {
  'merge-fixer':  fixMerge,
  'merge-abort':  abortMerge,
  'merge-review': reviewMerge,
  'merge-land':   landMerge,
} as const;
