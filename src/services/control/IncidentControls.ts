/**
 * The incident kinds of the control contract and the check every move naming an incident passes (design section 8.3): the incident must
 * be open and of a kind whose row in the Bouncer's table allows the move, and a finding move names only findings it lists. The move then
 * marks it handled in the same hold. User may run each move too, so the check holds whoever names the incident.
 */
import { TicketAcceptanceUtil }               from '../../adapters/tickets/utils/TicketAcceptanceUtil.ts';
import type { Logged }                        from '../../lib/tracker-model/@types/BoardChanges.ts';
import type { Incident, IncidentMove }        from '../../lib/tracker-model/@types/Incident.ts';
import { BoardRefusal }                       from '../../lib/tracker-model/BoardRefusal.ts';
import type { ControlCommand }                from '../../shared/@types/ControlCommand.ts';
import type { ControlCommandOf as CommandOf } from '../../shared/@types/ControlCommand.ts';
import { OperationRefusal }                   from '../../shared/OperationRefusal.ts';
import type { TrackerChange }                 from '../tracker/TrackerPipeline.ts';
import { ticketIdOfReference }                from './ControlTicketLookup.ts';
import { RoleCommandPolicy }                  from './RoleCommandPolicy.ts';

/** Refuses a move the named incident does not allow, as the relay refuses it; the board refuses an unknown or closed incident. */
export function requireIncidentAllows(change: TrackerChange, incidentId: string, command: ControlCommand): void {
  const incident = change.board.requireOpenIncident(incidentId);
  const reason = RoleCommandPolicy.incidentMoveVerdictOf(incident, command);
  if (reason !== null) throw new OperationRefusal('refused', { kind: 'role-command-refused', reason, commandKind: command.kind });
}

/** The job or ticket a repair or Airlock move acts on, and which incidents are its own. */
export interface MoveSubject {
  /** `J4` or `#12`, as a refusal names it. */
  name:     string;
  concerns: (incident: Readonly<Incident>) => boolean;
}

/**
 * The incident a repair or Airlock move handles. A named one must be open, its subject's and allow the move; with none named the move acts
 * on its subject's one open incident that allows it, or applies as a plain User control, except where `requiresIncident`.
 */
export function incidentForMove(
  change: TrackerChange,
  command: ControlCommand & { incidentId?: string },
  subject: MoveSubject,
  requiresIncident: boolean,
): Readonly<Incident> | null {
  if (command.incidentId !== undefined) {
    requireIncidentAllows(change, command.incidentId, command);
    const named = change.board.requireOpenIncident(command.incidentId);
    if (!subject.concerns(named)) throw new OperationRefusal('refused', { kind: 'role-command-refused', reason: 'incident-move-not-allowed', commandKind: command.kind });
    return named;
  }
  const allowing = change.board.incidents().filter((incident) => subject.concerns(incident) && RoleCommandPolicy.incidentMoveVerdictOf(incident, command) === null);
  if (allowing.length > 1) {
    throw new BoardRefusal({
      reason: 'several-open-incidents', subject: subject.name, move: command.kind, incidentIds: allowing.map((incident) => incident.id)
    });
  }
  const [only] = allowing;
  if (only !== undefined) return only;
  if (requiresIncident) throw new BoardRefusal({ reason: 'no-open-incident', subject: subject.name, move: command.kind });
  return null;
}

/** The move, then the incident marked handled by it, unless the move closed it already (a park, a ready or a triage of its last finding). */
export function handledUnder(change: TrackerChange, incidentId: string | undefined, move: IncidentMove, applied: Logged): Logged {
  if (incidentId === undefined || change.board.incidentById(incidentId) === undefined) return applied;
  return { ...applied, logged: [...applied.logged, ...change.board.handleIncident(incidentId, move, change.at).logged] };
}

function answerIncident(command: CommandOf<'incident-answer'>, change: TrackerChange) {
  requireIncidentAllows(change, command.incidentId, command);
  return change.board.answerIncident(command.incidentId, command.text, change.at);
}

function noteIncident(command: CommandOf<'incident-note'>, change: TrackerChange) {
  requireIncidentAllows(change, command.incidentId, command);
  return change.board.noteIncident(command.incidentId, command.text, change.at);
}

function escalateIncident(command: CommandOf<'incident-escalate'>, change: TrackerChange) {
  requireIncidentAllows(change, command.incidentId, command);
  return change.board.escalateQuestionIncident(command.incidentId, change.at);
}

function parkTicket(command: CommandOf<'ticket-park'>, change: TrackerChange) {
  if (command.incidentId !== undefined) requireIncidentAllows(change, command.incidentId, command);
  return change.board.parkTicket(ticketIdOfReference(change, command.ticketReference), command.reason, command.incidentId ?? null, change.at);
}

function triageTickets(command: CommandOf<'ticket-triage'>, change: TrackerChange) {
  if (command.incidentId !== undefined) requireIncidentAllows(change, command.incidentId, command);
  return change.board.triageTickets(command.ticketReferences.map((reference) => ticketIdOfReference(change, reference)), change.at);
}

/** Under a `findings-delivered` incident a v16 leftover is readied too, by lifting its `first-run review` hold. */
export function readyTickets(command: CommandOf<'ticket-ready'>, change: TrackerChange) {
  const ticketIds = command.ticketReferences.map((reference) => ticketIdOfReference(change, reference));
  if (command.incidentId === undefined) return change.board.readyDraftTickets(ticketIds, TicketAcceptanceUtil.readinessGapsOf, change.at);
  requireIncidentAllows(change, command.incidentId, command);
  return change.board.readyFindings(ticketIds, TicketAcceptanceUtil.readinessGapsOf, change.at);
}

export const INCIDENT_CONTROLS = {
  'ticket-triage':     triageTickets,
  'ticket-park':       parkTicket,
  'incident-answer':   answerIncident,
  'incident-note':     noteIncident,
  'incident-escalate': escalateIncident,
} as const;
