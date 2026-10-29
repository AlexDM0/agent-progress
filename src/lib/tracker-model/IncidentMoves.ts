/**
 * What the moves under an incident and its default do to the board (design sections 5.4 and 8.3): an answer delivered to the waiting
 * job, a park that stops it and keeps the agent's questions in front of User, the findings a delivered ticket's jobs filed, and each
 * kind's fail-safe default. Which move an incident's kind allows is the caller's table; this applies a move already allowed.
 */
import type { Logged, TicketsReadied }                       from './@types/BoardChanges.ts';
import type { DecisionQuestion }                             from './@types/Decision.ts';
import type { Incident, IncidentDefaultCause, IncidentKind } from './@types/Incident.ts';
import type { JobEnding }                                    from './@types/Job.ts';
import type { DecisionDraft, DecisionWording }               from './@types/LifecycleStep.ts';
import type { LogRecord }                                    from './@types/LogRecord.ts';
import type { ReadinessGap }                                 from './@types/Ticket.ts';
import type { AgentQuestions }                               from './AgentQuestions.ts';
import type { BoardRecords }                                 from './BoardRecords.ts';
import { BoardRefusal }                                      from './BoardRefusal.ts';
import type { Decisions }                                    from './Decisions.ts';
import type { Incidents }                                    from './Incidents.ts';
import type { Jobs }                                         from './Jobs.ts';
import type { TicketMoves }                                  from './TicketMoves.ts';
import type { TicketSettings }                               from './TicketSettings.ts';
import { FIRST_RUN_REVIEW_HOLD, PARKED_HOLD_PREFIX }         from './constants/DecisionAndIncidentVocabulary.ts';

const QUESTION_INCIDENT_KINDS: readonly IncidentKind[] = ['system-question', 'malformed-ticket'];

/** A `ticket park` naming no incident: User's own park. */
const USER_PARK_CAUSE = 'user';

const PARKED_JOB_CAUSE = 'parked';

/** Defaults taken once per ticket before the next one of that kind parks instead. */
const DEFAULTS_TAKEN_ONCE: readonly IncidentKind[] = ['setup-failed', 'out-of-calls', 'gate-cannot-run'];

export interface IncidentMovesInput {
  records:        BoardRecords;
  incidentRules:  Incidents;
  decisionRules:  Decisions;
  agentQuestions: AgentQuestions;
  ticketSettings: TicketSettings;
  ticketMoves:    TicketMoves;
  jobRules:       Jobs;
  /** The Board's end of a job, which also rebinds the job's open questions to its ticket. */
  endJob:         (jobId: string, ending: JobEnding, at: string) => Logged;
  requestFresh:   (jobId: string, at: string) => Logged;
}

export class IncidentMoves {
  constructor(private readonly input: IncidentMovesInput) {}

  noteIncident(incidentId: string, text: string, at: string): Logged {
    return this.input.incidentRules.noteIncident(incidentId, text, at);
  }

  answerIncident(incidentId: string, text: string, at: string): Logged {
    const incident = this.requireQuestionIncident(incidentId);
    const handled  = this.input.incidentRules.handleIncident(incidentId, 'incident-answer', at);
    return { logged: [...handled.logged, ...this.input.agentQuestions.answerIncident(incident, text, at)] };
  }

  /**
   * Holds the ticket `parked:<kind>` (`parked:user` with no incident), ends the incident's waiting job `stopped` and opens a `parked`
   * decision to User carrying the agent's questions, or the reason when there are none; all in the caller's hold.
   */
  parkTicket(ticketId: string, reason: string, incidentId: string | null, at: string): Logged {
    const incident = incidentId === null ? null : this.input.incidentRules.requireOpenIncident(incidentId);
    const handled  = incident === null ? [] : this.input.incidentRules.handleIncident(incident.id, 'ticket-park', at).logged;
    const wording  = {
      questions: [{
        question: reason, header: 'parked', multiSelect: false, options: []
      }],
      context: ''
    };
    return { logged: [...handled, ...this.parkUnder(ticketId, incident, wording, at)] };
  }

  /** `ticket ready` of findings: a draft is readied through the completeness check, a v16 leftover has its `first-run review` hold lifted. */
  readyFindings(ticketIds: readonly string[], readinessGapsOf: (body: string) => readonly ReadinessGap[], at: string): TicketsReadied {
    const leftovers = ticketIds.filter((ticketId) => this.input.records.ticketRecordById(ticketId)?.frontmatter.hold === FIRST_RUN_REVIEW_HOLD);
    const drafts    = ticketIds.filter((ticketId) => !leftovers.includes(ticketId));
    const readied   = drafts.length === 0 ? [] : this.input.ticketMoves.readyDraftTickets(drafts, readinessGapsOf, at).logged;
    const unheld    = leftovers.flatMap((ticketId) => [...this.input.ticketSettings.unholdTicket(ticketId, at).logged]);
    return {
      logged:  [...readied, ...unheld, ...this.input.incidentRules.settleListedFindings(ticketIds, 'ticket-ready', at)],
      tickets: [...new Set(ticketIds)].map((ticketId) => this.input.records.requireTicket(ticketId)),
    };
  }

  /** Puts findings before User's low-priority triage: `findingRoute: user`, any `first-run review` hold kept. */
  triageFindings(ticketIds: readonly string[], at: string): Logged {
    const logged = ticketIds.map((ticketId) => {
      const ticket = this.input.records.requireTicket(ticketId);
      ticket.frontmatter.findingRoute = 'user';
      this.input.records.markChanged(ticket);
      return this.input.records.logger.log({ kind: 'ticket-triaged', ticketId, fields: {} }, at);
    });
    return { logged: [...logged, ...this.input.incidentRules.settleListedFindings(ticketIds, 'ticket-triage', at)] };
  }

  /**
   * In the hold that delivers or abandons a ticket: an abandoned finding is struck off its listing incident, and one `findings-delivered`
   * incident lists every draft the ticket's jobs filed for the orchestrator.
   */
  afterTicketSettled(ticketId: string, abandoned: boolean, at: string): LogRecord[] {
    const struck  = abandoned ? this.input.incidentRules.settleListedFindings([ticketId], 'ticket-abandon', at) : [];
    const jobIds  = this.jobIdsOfTicket(ticketId);
    const findings = this.input.records.ticketRecords
      .filter(({ frontmatter }) => frontmatter.status === 'draft' && frontmatter.findingRoute === 'orchestrator'
        && frontmatter.filedByJob !== undefined && jobIds.has(frontmatter.filedByJob))
      .map(({ frontmatter }) => frontmatter.id);
    if (findings.length === 0) return [...struck];
    const opened = this.input.incidentRules.openIncident({
      kind: 'findings-delivered', ticketIds: findings, jobId: null, facts: { ticketId }, defaultMove: 'ticket-triage'
    }, at);
    return [...struck, ...opened.logged];
  }

  /**
   * Each kind's fail-safe default, logged `incident-defaulted`: a question escalates, a park or a merge abort parks, `ticket-triage`
   * triages what is still listed, `job-fresh` asks for a fresh agent, the quiet-job default opens its decision; a repair, retry or fresh
   * agent taken once per ticket parks the next time. The repair, retry and merge agents themselves are the runner's.
   */
  defaultIncident(incidentId: string, cause: IncidentDefaultCause, decisionWordingOf: (draft: DecisionDraft) => DecisionWording, at: string): LogRecord[] {
    const incident = this.input.incidentRules.requireOpenIncident(incidentId);
    const escalation = incident.defaultMove === 'incident-escalate' ? this.input.agentQuestions.escalationOf(incident) : null;
    if (escalation !== null) return [...this.input.incidentRules.escalateIncident(incidentId, escalation, at).logged];
    const takenBefore = DEFAULTS_TAKEN_ONCE.includes(incident.kind) && this.defaultWasTakenBefore(incident);
    const defaulted   = [...this.input.incidentRules.defaultIncident(incidentId, cause, at).logged];
    const parkWording = (ticketId: string): DecisionWording => decisionWordingOf({ kind: 'parked', ticketIds: [ticketId], jobId: null });
    const parkAll     = (): LogRecord[] => incident.ticketIds.flatMap((ticketId) => this.parkUnder(ticketId, incident, parkWording(ticketId), at));
    if (takenBefore) return [...defaulted, ...parkAll()];
    switch (incident.defaultMove) {
      case 'ticket-park':
      case 'merge-abort':
        return [...defaulted, ...parkAll()];
      case 'ticket-triage':
        return [...defaulted, ...this.triageFindings(incident.ticketIds, at).logged];
      case 'job-fresh':
        return [...defaulted, ...this.freshAgentFor(incident, at)];
      case 'open-quiet-job-decision': {
        const draft = { kind: 'quiet-job', ticketIds: incident.ticketIds, jobId: incident.jobId } as const;
        const opened = this.input.decisionRules.openDecision({
          ...draft, askedBy: 'runner', requestId: null, ...decisionWordingOf(draft)
        }, at);
        return [...defaulted, ...opened.logged];
      }
      default:
        return defaulted;
    }
  }

  private freshAgentFor(incident: Readonly<Incident>, at: string): LogRecord[] {
    const job = incident.jobId === null ? undefined : this.input.jobRules.jobById(incident.jobId);
    if (job === undefined || job.state === 'stopping') return [];
    return [...this.input.requestFresh(job.id, at).logged];
  }

  private requireQuestionIncident(incidentId: string): Readonly<Incident> {
    const incident = this.input.incidentRules.requireOpenIncident(incidentId);
    if (!QUESTION_INCIDENT_KINDS.includes(incident.kind)) throw new BoardRefusal({ reason: 'incident-not-a-question', incidentId, kind: incident.kind });
    return incident;
  }

  private parkUnder(ticketId: string, incident: Readonly<Incident> | null, fallback: DecisionWording, at: string): LogRecord[] {
    const {
      records, ticketSettings, decisionRules, jobRules, agentQuestions
    } = this.input;
    const ticket = records.requireTicket(ticketId);
    const logged: LogRecord[] = [];
    if (ticket.frontmatter.hold !== undefined) logged.push(...ticketSettings.unholdTicket(ticketId, at).logged);
    logged.push(...ticketSettings.holdTicket(ticketId, `${PARKED_HOLD_PREFIX}${incident?.kind ?? USER_PARK_CAUSE}`, at).logged);
    const waitingJob = incident?.jobId === null || incident === null ? undefined : jobRules.jobById(incident.jobId);
    // A merge job is the runner's to abort, restoring its Airlock worktree; only a session waiting on its question ends here.
    if (waitingJob?.state === 'waiting-for-answer') logged.push(...this.input.endJob(waitingJob.id, { outcome: 'stopped', cause: PARKED_JOB_CAUSE }, at).logged);
    const agentQuestionsOfIncident: DecisionQuestion[] | null = incident === null ? null : agentQuestions.questionsOf(incident);
    const wording = agentQuestionsOfIncident === null ? fallback : { questions: agentQuestionsOfIncident, context: fallback.questions[0]?.question ?? '' };
    logged.push(...decisionRules.openDecision({
      kind: 'parked', ticketIds: [ticketId], jobId: null, askedBy: 'runner', requestId: null, ...wording
    }, at).logged);
    return logged;
  }

  private jobIdsOfTicket(ticketId: string): Set<string> {
    const launched = [...this.input.records.storedLogRecords, ...this.input.records.loggedRecords]
      .flatMap((record) => (record.kind === 'job-launched' && record.fields.ticketIds.includes(ticketId) ? [record.jobId] : []));
    const live = this.input.jobRules.jobs().filter((job) => job.ticketIds.includes(ticketId)).map((job) => job.id);
    return new Set([...launched, ...live]);
  }

  /** A default of this kind on any of these tickets was already taken: its `incident-defaulted` record follows the opening naming them. */
  private defaultWasTakenBefore(incident: Readonly<Incident>): boolean {
    const records = [...this.input.records.storedLogRecords, ...this.input.records.loggedRecords];
    const sameKindIds = new Set(records.flatMap((record) => (record.kind === 'incident-opened' && record.fields.kind === incident.kind
      && record.incidentId !== incident.id && record.fields.ticketIds.some((ticketId) => incident.ticketIds.includes(ticketId)) ? [record.incidentId] : [])));
    return records.some((record) => record.kind === 'incident-defaulted' && sameKindIds.has(record.incidentId));
  }
}
