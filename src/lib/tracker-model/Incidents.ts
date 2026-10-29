/**
 * The runner's orchestrator's incidents on the board: opened once per question request, delivered in a chat turn, and closed by a move,
 * by their default or by an escalation to the user. A closed incident leaves the board in that hold and lives on in the log.
 */
import type { IncidentClosed, IncidentEscalated, IncidentOpened } from './@types/BoardChanges.ts';
import type { DecisionOpening }                                   from './@types/Decision.ts';
import type {
  Incident,
  IncidentDefaultCause,
  IncidentDeliveryTurn,
  IncidentMove,
  IncidentOpening
}                                                    from './@types/Incident.ts';
import type { BoardRecords }                         from './BoardRecords.ts';
import { BoardRefusal }                              from './BoardRefusal.ts';
import type { Decisions }                            from './Decisions.ts';
import { FIRST_INCIDENT_NUMBER, INCIDENT_ID_PREFIX } from './constants/DecisionAndIncidentVocabulary.ts';
import { NumberedIdUtil }                            from './utils/NumberedIdUtil.ts';

/** What an escalation puts to the user: exactly the agent's questions, with no note of the orchestrator's. */
export type IncidentEscalation = Pick<DecisionOpening, 'askedBy' | 'questions' | 'context'>;

export class Incidents {
  constructor(private readonly records: BoardRecords, private readonly decisionRules: Decisions) {}

  /** In opening order. */
  incidents(): readonly Readonly<Incident>[] {
    return this.records.progress.incidents ?? [];
  }

  incidentById(incidentId: string): Readonly<Incident> | undefined {
    return this.incidents().find((incident) => incident.id === incidentId);
  }

  /** As a decision: a request already open as an incident gives it back, and one answered or open as a decision opens nothing. */
  openIncident(opening: IncidentOpening, at: string): IncidentOpened {
    const requestId = this.records.incidentRequestIdOf(opening);
    const standing  = requestId === null ? null : this.records.questionRequestStanding(opening.jobId, requestId);
    if (standing !== null) return { incident: standing.standing === 'open-incident' ? standing.incident : null, logged: [] };

    const incident: Incident = {
      id:              this.takeNextIncidentId(),
      kind:            opening.kind,
      ticketIds:       [...opening.ticketIds],
      jobId:           opening.jobId,
      facts:           { ...opening.facts },
      defaultMove:     opening.defaultMove,
      deliveredInTurn: null,
      openedAt:        at,
    };
    this.records.progress.incidents ??= [];
    this.records.progress.incidents.push(incident);
    const logged = this.records.logger.log({
      kind:       'incident-opened',
      incidentId: incident.id,
      fields:     { kind: incident.kind, ticketIds: [...incident.ticketIds] },
    }, at);
    return { incident, logged: [logged] };
  }

  /** Delivery is the runner's state, not an event: it is stored and never logged. */
  markIncidentDelivered(incidentId: string, turn: IncidentDeliveryTurn): Readonly<Incident> {
    const incident           = this.requireOpenIncident(incidentId);
    incident.deliveredInTurn = { jobId: turn.jobId, chatSequence: turn.chatSequence };
    return incident;
  }

  handleIncident(incidentId: string, move: IncidentMove, at: string): IncidentClosed {
    const incident = this.closeIncident(incidentId);
    return { incident, logged: [this.records.logger.log({ kind: 'incident-handled', incidentId, fields: { move } }, at)] };
  }

  /** A note records a finding and leaves the incident open, delivered as it was. */
  noteIncident(incidentId: string, text: string, at: string): IncidentClosed {
    const incident = this.requireOpenIncident(incidentId);
    return { incident, logged: [this.records.logger.log({ kind: 'incident-noted', incidentId, fields: { text } }, at)] };
  }

  /**
   * Strikes settled findings off every open `findings-delivered` incident listing them; one left listing none closes, handled by the move
   * that settled its last finding.
   */
  settleListedFindings(ticketIds: readonly string[], move: IncidentMove, at: string): IncidentClosed['logged'] {
    const listing = this.incidents().filter((incident) => incident.kind === 'findings-delivered' && incident.ticketIds.some((ticketId) => ticketIds.includes(ticketId)));
    return listing.flatMap((listed) => {
      const incident     = this.requireOpenIncident(listed.id);
      incident.ticketIds = incident.ticketIds.filter((ticketId) => !ticketIds.includes(ticketId));
      return incident.ticketIds.length === 0 ? [...this.handleIncident(incident.id, move, at).logged] : [];
    });
  }

  /** Takes the incident's own default move; every default shows the warning state its cause names. */
  defaultIncident(incidentId: string, cause: IncidentDefaultCause, at: string): IncidentClosed {
    const incident = this.closeIncident(incidentId);
    return { incident, logged: [this.records.logger.log({ kind: 'incident-defaulted', incidentId, fields: { move: incident.defaultMove, cause } }, at)] };
  }

  /** Opens an `agent-question` decision on the incident's tickets, job and request, then logs the escalation naming it. */
  escalateIncident(incidentId: string, escalation: IncidentEscalation, at: string): IncidentEscalated {
    this.requireOpenIncident(incidentId);
    this.decisionRules.requireQuestions(escalation);
    const incident     = this.closeIncident(incidentId);
    const { decision, logged } = this.decisionRules.openUnmatchedDecision({
      kind:      'agent-question',
      ticketIds: [...incident.ticketIds],
      jobId:     incident.jobId,
      askedBy:   escalation.askedBy,
      requestId: this.records.incidentRequestIdOf(incident),
      questions: escalation.questions,
      context:   escalation.context,
    }, at);
    const escalated = this.records.logger.log({ kind: 'incident-escalated', incidentId, fields: { decisionId: decision.id } }, at);
    return { incident, decision, logged: [...logged, escalated] };
  }

  private closeIncident(incidentId: string): Incident {
    const incident      = this.requireOpenIncident(incidentId);
    const openIncidents = this.records.progress.incidents ?? [];
    openIncidents.splice(openIncidents.indexOf(incident), 1);
    return incident;
  }

  requireOpenIncident(incidentId: string): Incident {
    const incident = this.records.progress.incidents?.find((candidate) => candidate.id === incidentId);
    if (incident !== undefined) return incident;
    if (NumberedIdUtil.wasClosed(incidentId, INCIDENT_ID_PREFIX, this.records.progress.nextIncidentId, FIRST_INCIDENT_NUMBER)) {
      throw new BoardRefusal({ reason: 'incident-closed', incidentId });
    }
    throw new BoardRefusal({ reason: 'unknown-incident', incidentId });
  }

  private takeNextIncidentId(): string {
    const allocated = NumberedIdUtil.allocatedNumberOf(
      this.records.progress.nextIncidentId,
      FIRST_INCIDENT_NUMBER,
      this.incidents().map((incident) => incident.id),
      INCIDENT_ID_PREFIX,
    );
    this.records.progress.nextIncidentId = allocated + 1;
    return `${INCIDENT_ID_PREFIX}${allocated}`;
  }
}
