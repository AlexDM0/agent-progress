/**
 * What runs next, derived from the board and the runner's observations alone: which jobs launch, resume or are replaced, which tickets park,
 * which decisions and incidents open and which incidents take their default. Pure: it reads no clock, file or process, and every count it
 * acts on is read from the log, so a restart derives the same steps.
 */
import type { Decision }               from './@types/Decision.ts';
import type { Incident, IncidentKind } from './@types/Incident.ts';
import type {
  InterruptionCause,
  Job,
  JobKind,
  JobOutcome
} from './@types/Job.ts';
import type { LifecycleLimits }                                from './@types/LifecycleLimits.ts';
import type { LifecycleObservations, LifecycleStep }           from './@types/LifecycleStep.ts';
import type { LogRecord }                                      from './@types/LogRecord.ts';
import type { TicketPriority, TicketStatus }                   from './@types/Ticket.ts';
import type { RunnerState }                                    from './@types/TrackerProgress.ts';
import { CRASH_INTERRUPTION_CAUSES, HANDOFF_RED_INTERRUPTION } from './constants/JobStates.ts';
import { FailedPassUtil }                                      from './utils/FailedPassUtil.ts';
import { TicketDefaultsUtil }                                  from './utils/TicketDefaultsUtil.ts';
import { TicketDependencyUtil }                                from './utils/TicketDependencyUtil.ts';

export interface LifecycleTicket {
  id:           string;
  status:       TicketStatus;
  priority?:    TicketPriority;
  dependsOn?:   readonly string[];
  hold?:        string;
  group?:       string;
  /** A passed review queued it to land: it waits for its merge slot, never for another review. */
  mergeQueued?: boolean;
}

/** The decisions naming a ticket that hold every launch on it until User answers. */
const TICKET_HOLDING_DECISION_KINDS: readonly Decision['kind'][] = ['waiver', 'branch-touches-agent-config'];

export interface LifecycleFacts {
  tickets:                     readonly LifecycleTicket[];
  jobs:                        readonly Readonly<Job>[];
  decisions:                   readonly Readonly<Decision>[];
  incidents:                   readonly Readonly<Incident>[];
  /** The log as stored, then what this hold logged. */
  logRecords:                  readonly LogRecord[];
  readinessPositionByTicketId: ReadonlyMap<string, number>;
  concurrencyLimit:            number;
  runnerState:                 RunnerState;
  pipelineIsSet:               boolean;
  /** The pipeline has a `review` phase; without one no reviewer is ever launched, and a gated build queues to merge. */
  reviewIsSet:                 boolean;
  observations:                LifecycleObservations;
}

/** The jobs a concurrency slot bounds: merge, refresh and merge-agent jobs never wait behind builds, and sessions have no ticket. */
const SLOT_TAKING_JOB_KINDS: readonly JobKind[] = ['build', 'review'];

/** Incidents holding a target's Airlock, which never wait for an orchestrator to boot. */
const AIRLOCK_HOLDING_INCIDENT_KINDS: readonly IncidentKind[] = ['merge-gate-failed', 'resolution-over-threshold'];

/** The jobs whose spent red resumes park their ticket; a merge-gate fixer's Airlock parks its own, aborting the merge. */
const TICKET_WORK_JOB_KINDS: readonly JobKind[] = ['review', 'build'];

/** Sessions, which are never resumed once down: a fresh one boots instead. */
const SESSION_JOB_KINDS: readonly JobKind[] = ['orchestrator', 'product-owner'];

/** A job ended with a report code verified, which breaks a run of crashes across tickets. */
const VERIFIED_OUTCOMES: readonly JobOutcome[] = ['built', 'reviewed', 'round-granted', 'does-not-hold', 'resolved', 'landed', 'integrated', 'refreshed'];

const PRIORITY_RANK: Readonly<Record<TicketPriority, number>> = { high: 0, normal: 1, low: 2 };

/** Within a priority rank a review goes first (it holds finished work), then a rebuild, then a ready build. */
const WORK_PHASE_RANK = { review: 0, rebuild: 1, build: 2 } as const;

type WorkPhase = keyof typeof WORK_PHASE_RANK;

/** A ticket with no readiness position ranks before every positioned one, as the ready list orders it. */
const UNRECORDED_READINESS_POSITION = -1;

interface Candidate {
  ticket: LifecycleTicket;
  phase:  WorkPhase;
  step:   LifecycleStep;
}

function isCrash(cause: InterruptionCause | undefined): boolean {
  return cause !== undefined && (CRASH_INTERRUPTION_CAUSES as readonly InterruptionCause[]).includes(cause);
}

function jobLaunchesByJobIdOf(logRecords: readonly LogRecord[]): Map<string, { kind: JobKind; ticketIds: readonly string[]; attempt: number }> {
  const launches = new Map<string, { kind: JobKind; ticketIds: readonly string[]; attempt: number }>();
  for (const record of logRecords) {
    if (record.kind === 'job-launched') launches.set(record.jobId, { kind: record.fields.kind, ticketIds: record.fields.ticketIds, attempt: record.fields.attempt });
  }
  return launches;
}

/** A clock exception: the vendor names the reset as a time, and only `now` can honour it. */
function usageLimitHolds(limits: LifecycleLimits): boolean {
  return limits.usageResetsAt !== null && Date.parse(limits.now) < Date.parse(limits.usageResetsAt);
}

/**
 * Counted crashes since the user last set the board running or the outage last opened, on jobs of different tickets back to back: a crash on
 * the ticket of the one before it starts the run again, and a verified job ending breaks it. A reboot is no counted crash.
 */
function outageIsDue(facts: LifecycleFacts, limits: LifecycleLimits): boolean {
  const launches = jobLaunchesByJobIdOf(facts.logRecords);
  let crashedTicketKeys: string[] = [];
  for (const record of facts.logRecords) {
    if (record.kind === 'runner-set' && record.fields.state === 'running') crashedTicketKeys = [];
    if (record.kind === 'decision-opened' && record.fields.kind === 'outage') crashedTicketKeys = [];
    if (record.kind === 'job-ended' && VERIFIED_OUTCOMES.includes(record.fields.outcome)) crashedTicketKeys = [];
    if (record.kind !== 'job-interrupted' || !isCrash(record.fields.cause)) continue;
    const ticketKey = [...launches.get(record.jobId)?.ticketIds ?? []].sort().join(',');
    if (ticketKey === '') continue;
    crashedTicketKeys = crashedTicketKeys.at(-1) === ticketKey ? [ticketKey] : [...crashedTicketKeys, ticketKey];
  }
  return crashedTicketKeys.length >= limits.CONSECUTIVE_DEAD_AGENTS_BEFORE_STOPPING;
}

/** Back-to-back `replaced` endings of the ticket's jobs since its last `job-lost` incident opened. */
function replacedInARowOf(ticketId: string, facts: LifecycleFacts): number {
  const launches = jobLaunchesByJobIdOf(facts.logRecords);
  let replacedInARow = 0;
  for (const record of facts.logRecords) {
    if (record.kind === 'incident-opened' && record.fields.kind === 'job-lost' && record.fields.ticketIds.includes(ticketId)) replacedInARow = 0;
    if (record.kind !== 'job-ended' || !(launches.get(record.jobId)?.ticketIds.includes(ticketId) ?? false)) continue;
    replacedInARow = record.fields.outcome === 'replaced' ? replacedInARow + 1 : 0;
  }
  return replacedInARow;
}

/** Back-to-back failed orchestrator jobs since the runner last started. */
function failedOrchestratorBootsOf(facts: LifecycleFacts): number {
  const launches = jobLaunchesByJobIdOf(facts.logRecords);
  let failedBoots = 0;
  for (const record of facts.logRecords) {
    if (record.kind === 'runner-started') failedBoots = 0;
    if (record.kind !== 'job-ended' || launches.get(record.jobId)?.kind !== 'orchestrator') continue;
    failedBoots = record.fields.outcome === 'failed' ? failedBoots + 1 : 0;
  }
  return failedBoots;
}

/** Review rounds granted since the ticket last went into review: the next review is one past them. */
function nextReviewRoundOf(ticketId: string, facts: LifecycleFacts): number {
  const launches = jobLaunchesByJobIdOf(facts.logRecords);
  let grantedRounds = 0;
  for (const record of facts.logRecords) {
    if (record.kind === 'ticket-finished' && record.ticketId === ticketId) grantedRounds = 0;
    if (record.kind === 'job-ended' && record.fields.outcome === 'round-granted' && (launches.get(record.jobId)?.ticketIds.includes(ticketId) ?? false)) grantedRounds += 1;
  }
  return grantedRounds + 1;
}

/** Zero for a ticket no build job was launched for. */
function lastBuildAttemptOf(ticketId: string, facts: LifecycleFacts): number {
  const buildAttempts = [...jobLaunchesByJobIdOf(facts.logRecords).values()]
    .filter((launch) => launch.kind === 'build' && launch.ticketIds.includes(ticketId))
    .map((launch) => launch.attempt);
  return Math.max(0, ...buildAttempts);
}

interface HandoffCycle {
  kind:      JobKind;
  ticketIds: readonly string[];
  attempt:   number;
}

/**
 * The resumes of a handoff cycle, every job of its kind, tickets and attempt, so a fresh session that took over a session the vendor
 * could not resume carries on the same count: its red-handoff resumes, and for a build cycle each review of its tickets that did not
 * hold after the cycle began, since the builder is resumed with that review's findings.
 */
function handoffCycleResumesOf(cycle: HandoffCycle, logRecords: readonly LogRecord[]): number {
  const launches = jobLaunchesByJobIdOf(logRecords);
  const ticketKey = [...cycle.ticketIds].sort().join(',');
  const inTheCycle = (jobId: string): boolean => {
    const launch = launches.get(jobId);
    return launch !== undefined && launch.kind === cycle.kind && launch.attempt === cycle.attempt && [...launch.ticketIds].sort().join(',') === ticketKey;
  };
  let cycleBegan = false;
  let resumes = 0;
  for (const record of logRecords) {
    if (record.kind === 'job-launched' && inTheCycle(record.jobId)) cycleBegan = true;
    if (record.kind === 'job-resumed' && record.fields.cause === HANDOFF_RED_INTERRUPTION && inTheCycle(record.jobId)) resumes += 1;
    const endedReview = record.kind === 'job-ended' && record.fields.outcome === 'does-not-hold' ? launches.get(record.jobId) : undefined;
    if (cycleBegan && cycle.kind === 'build' && endedReview?.kind === 'review' && endedReview.ticketIds.some((ticketId) => cycle.ticketIds.includes(ticketId))) resumes += 1;
  }
  return resumes;
}

function redHandoffResumesOf(job: Readonly<Job>, facts: LifecycleFacts): number {
  return handoffCycleResumesOf(job, facts.logRecords);
}

/**
 * The ticket's newest ended build job was `built`: its review sent it back, and that builder's session is resumed with the findings.
 * An unhold since then starts a fresh attempt instead, so a ticket parked past its resumes does not park again.
 */
function builderReturnsFromReview(ticketId: string, facts: LifecycleFacts): boolean {
  const launches = jobLaunchesByJobIdOf(facts.logRecords);
  let returns = false;
  for (const record of facts.logRecords) {
    if (record.kind === 'ticket-unheld' && record.ticketId === ticketId) returns = false;
    if (record.kind !== 'job-ended') continue;
    const launch = launches.get(record.jobId);
    if (launch?.kind === 'build' && launch.ticketIds.includes(ticketId)) returns = record.fields.outcome === 'built';
  }
  return returns;
}

/** The ticket's newest ended build job was replaced while interrupted on a red handoff: its fresh successor keeps the attempt. */
function redHandoffCarriesOver(ticketId: string, facts: LifecycleFacts): boolean {
  const launches = jobLaunchesByJobIdOf(facts.logRecords);
  const lastInterruptionByJobId = new Map<string, InterruptionCause>();
  let carriesOver = false;
  for (const record of facts.logRecords) {
    if (record.kind === 'job-interrupted') lastInterruptionByJobId.set(record.jobId, record.fields.cause);
    if (record.kind !== 'job-ended') continue;
    const launch = launches.get(record.jobId);
    if (launch?.kind !== 'build' || !launch.ticketIds.includes(ticketId)) continue;
    carriesOver = record.fields.outcome === 'replaced' && lastInterruptionByJobId.get(record.jobId) === HANDOFF_RED_INTERRUPTION;
  }
  return carriesOver;
}

function targetOf(ticket: LifecycleTicket, observations: LifecycleObservations): string {
  return ticket.group === undefined ? observations.mainLine : `${observations.groupTargetPrefix}${ticket.group}`;
}

function openDecisionOfKind(facts: LifecycleFacts, kind: Decision['kind']): boolean {
  return facts.decisions.some((decision) => decision.kind === kind);
}

function ticketHasAJob(ticketId: string, facts: LifecycleFacts): boolean {
  return facts.jobs.some((job) => job.ticketIds.includes(ticketId));
}

function ticketHasAnOpenJobLostIncident(ticketId: string, facts: LifecycleFacts): boolean {
  return facts.incidents.some((incident) => incident.kind === 'job-lost' && incident.ticketIds.includes(ticketId));
}

/**
 * A held ticket never launches: a hold of any reason, or an incident naming it that the orchestrator has not settled (a `job-lost`, or a
 * build that ended on `setup-failed`, `blocked`, `out-of-calls` or `gate-cannot-run`), so no fresh job races the incident's move.
 */
function ticketIsHeld(ticket: LifecycleTicket, facts: LifecycleFacts): boolean {
  if (ticket.hold !== undefined || ticket.mergeQueued === true) return true;
  if (facts.observations.ticketIdsTouchingAgentConfig.includes(ticket.id)) return true;
  if (facts.decisions.some((decision) => TICKET_HOLDING_DECISION_KINDS.includes(decision.kind) && decision.ticketIds.includes(ticket.id))) return true;
  // A question whose job ended holds its ticket until answered, whatever else holds it, so no fresh agent races the answer.
  if (facts.decisions.some((decision) => decision.kind === 'agent-question' && decision.jobId === null && decision.ticketIds.includes(ticket.id))) return true;
  if (facts.incidents.some((incident) => incident.ticketIds.includes(ticket.id))) return true;
  return facts.observations.targetsHoldingManagedBlock.includes(targetOf(ticket, facts.observations));
}

function jobResumeIsHeld(job: Readonly<Job>, facts: LifecycleFacts): boolean {
  if (job.target !== null && facts.observations.targetsHoldingManagedBlock.includes(job.target)) return true;
  return job.ticketIds.some((ticketId) => facts.observations.ticketIdsTouchingAgentConfig.includes(ticketId));
}

/** A session stopped at its question resumes only once the question is answered, so the resume can carry the answer. */
function jobAwaitsAnAnswer(job: Readonly<Job>, facts: LifecycleFacts): boolean {
  return facts.decisions.some((decision) => decision.jobId === job.id)
    || facts.incidents.some((incident) => incident.jobId === job.id && (incident.kind === 'system-question' || incident.kind === 'malformed-ticket'));
}

/** Only a crash counts toward the bound: a reboot, an answer delivery or a usage limit resumes whatever the count. */
function crashResumesAreSpent(job: Readonly<Job>, limits: LifecycleLimits): boolean {
  return isCrash(job.interruption) && job.crashResumes >= limits.JOB_RESUMES_BEFORE_FRESH;
}

/**
 * An intake conversation survives a reboot: an interrupted product owner resumes by id once any question it asked is answered. Past the
 * crash bound it is never resumed: with a question open it waits `awaiting-answer`, otherwise a fresh session takes its intake over.
 */
function productOwnerStepsOf(job: Readonly<Job>, facts: LifecycleFacts, limits: LifecycleLimits, resumesAreHeld: boolean): LifecycleStep[] {
  const awaitsAnAnswer = jobAwaitsAnAnswer(job, facts);
  if (job.state === 'awaiting-answer') return awaitsAnAnswer ? [] : [{ kind: 'refresh-intake', jobId: job.id }];
  if (crashResumesAreSpent(job, limits)) {
    return [{ kind: awaitsAnAnswer ? 'await-answer' : 'refresh-intake', jobId: job.id }];
  }
  return resumesAreHeld || awaitsAnAnswer ? [] : [{ kind: 'resume-job', jobId: job.id }];
}

/** A red handoff resumes the same session while its cycle has resumes left; the next red ends it and parks its ticket for User. */
function redHandoffStepsOf(job: Readonly<Job>, facts: LifecycleFacts, limits: LifecycleLimits, resumesAreHeld: boolean): LifecycleStep[] {
  const ticketId = job.ticketIds[0];
  if (redHandoffResumesOf(job, facts) >= limits.RED_HANDOFF_RESUMES_BEFORE_PARKING && ticketId !== undefined && TICKET_WORK_JOB_KINDS.includes(job.kind)) {
    return [{
      kind: 'park', ticketId, cause: 'red-resumes-spent', jobId: job.id
    }];
  }
  const resumeIsHeld = resumesAreHeld || jobResumeIsHeld(job, facts) || jobAwaitsAnAnswer(job, facts);
  return resumeIsHeld ? [] : [{ kind: 'resume-job', jobId: job.id }];
}

function crashBoundStepsOf(facts: LifecycleFacts, limits: LifecycleLimits, resumesAreHeld: boolean): LifecycleStep[] {
  const productOwnerSteps = facts.jobs
    .filter((job) => job.kind === 'product-owner' && (job.state === 'interrupted' || job.state === 'awaiting-answer'))
    .flatMap((job) => productOwnerStepsOf(job, facts, limits, resumesAreHeld));
  return [...productOwnerSteps, ...facts.jobs.filter((job) => job.state === 'interrupted' && job.kind !== 'product-owner').flatMap((job): LifecycleStep[] => {
    if (job.interruption === HANDOFF_RED_INTERRUPTION) return redHandoffStepsOf(job, facts, limits, resumesAreHeld);
    if (SESSION_JOB_KINDS.includes(job.kind)) return [{ kind: 'replace-job', jobId: job.id }];
    if (crashResumesAreSpent(job, limits)) return [{ kind: 'replace-job', jobId: job.id }];
    if (resumesAreHeld || jobResumeIsHeld(job, facts) || jobAwaitsAnAnswer(job, facts)) return [];
    return [{ kind: 'resume-job', jobId: job.id }];
  })];
}

/** A builder a review sent back past its cycle's resumes is never resumed again: the review that did not hold is one past the last. */
function reviewResumesAreSpent(ticket: LifecycleTicket, facts: LifecycleFacts, limits: LifecycleLimits): boolean {
  if (ticket.status !== 'in-progress' || !builderReturnsFromReview(ticket.id, facts)) return false;
  const cycle: HandoffCycle = { kind: 'build', ticketIds: [ticket.id], attempt: lastBuildAttemptOf(ticket.id, facts) };
  return handoffCycleResumesOf(cycle, facts.logRecords) > limits.RED_HANDOFF_RESUMES_BEFORE_PARKING;
}

function parkStepsOf(facts: LifecycleFacts, limits: LifecycleLimits): LifecycleStep[] {
  return facts.tickets
    .filter((ticket) => ticket.hold === undefined && (ticket.status === 'in-progress' || ticket.status === 'in-review') && !ticketHasAJob(ticket.id, facts))
    .flatMap((ticket): LifecycleStep[] => {
      if (FailedPassUtil.failedPassesOf(ticket.id, facts.logRecords) >= limits.FAILED_PASSES_BEFORE_PARKING) return [{ kind: 'park', ticketId: ticket.id, cause: 'failed-passes' }];
      return reviewResumesAreSpent(ticket, facts, limits) ? [{ kind: 'park', ticketId: ticket.id, cause: 'red-resumes-spent' }] : [];
    });
}

function jobLostStepsOf(facts: LifecycleFacts, limits: LifecycleLimits): LifecycleStep[] {
  return facts.tickets
    .filter((ticket) => !ticketHasAnOpenJobLostIncident(ticket.id, facts) && !ticketHasAJob(ticket.id, facts))
    .filter((ticket) => replacedInARowOf(ticket.id, facts) >= limits.REPLACED_JOBS_BEFORE_JOB_LOST)
    .map((ticket) => ({
      kind:     'open-incident',
      incident: {
        kind: 'job-lost', ticketIds: [ticket.id], jobId: null, facts: {}, defaultMove: 'ticket-park'
      },
    }));
}

function candidateOf(ticket: LifecycleTicket, facts: LifecycleFacts): Candidate | null {
  const base = targetOf(ticket, facts.observations);
  if (ticket.status === 'in-review') {
    if (!facts.reviewIsSet) return null;
    return {
      ticket,
      phase: 'review',
      step:  {
        kind: 'launch-review', ticketId: ticket.id, round: nextReviewRoundOf(ticket.id, facts), target: base
      }
    };
  }
  const carriesOver = redHandoffCarriesOver(ticket.id, facts) || (ticket.status === 'in-progress' && builderReturnsFromReview(ticket.id, facts));
  const attempt = lastBuildAttemptOf(ticket.id, facts) + (carriesOver ? 0 : 1);
  if (ticket.status === 'in-progress' && (attempt > 1 || carriesOver)) return {
    ticket,
    phase: 'rebuild',
    step:  {
      kind: 'launch-build', ticketId: ticket.id, attempt, base
    }
  };
  if (ticket.status !== 'pending') return null;
  const statusById = new Map(facts.tickets.map((other) => [other.id, other.status]));
  if (TicketDependencyUtil.unsettledDependenciesOf(ticket.dependsOn ?? [], statusById).length > 0) return null;
  return {
    ticket,
    phase: 'build',
    step:  {
      kind: 'launch-build', ticketId: ticket.id, attempt, base
    }
  };
}

function candidateOrder(facts: LifecycleFacts): (a: Candidate, b: Candidate) => number {
  const readinessOf = (candidate: Candidate): number => facts.readinessPositionByTicketId.get(candidate.ticket.id) ?? UNRECORDED_READINESS_POSITION;
  const rankOf      = (candidate: Candidate): number => PRIORITY_RANK[TicketDefaultsUtil.ticketPriorityOf(candidate.ticket)];
  return (a, b) => (
    rankOf(a) - rankOf(b)
    || WORK_PHASE_RANK[a.phase] - WORK_PHASE_RANK[b.phase]
    || readinessOf(a) - readinessOf(b)
    || Number(a.ticket.id) - Number(b.ticket.id)
  );
}

/** A `waiting-for-answer` or `interrupted` job keeps its slot: it is the same job, holding the slot already. */
function freeSlotsOf(facts: LifecycleFacts): number {
  const jobsHoldingASlot = facts.jobs.filter((job) => SLOT_TAKING_JOB_KINDS.includes(job.kind)).length;
  return Math.max(0, facts.concurrencyLimit - jobsHoldingASlot);
}

function launchStepsOf(facts: LifecycleFacts, ticketIdsSettledThisPass: ReadonlySet<string>): LifecycleStep[] {
  return facts.tickets
    .filter((ticket) => !ticketIdsSettledThisPass.has(ticket.id) && !ticketHasAJob(ticket.id, facts) && !ticketIsHeld(ticket, facts))
    .flatMap((ticket) => candidateOf(ticket, facts) ?? [])
    .sort(candidateOrder(facts))
    .slice(0, freeSlotsOf(facts))
    .map((candidate) => candidate.step);
}

function mergeRefusalAwaitsUser(ticketId: string, facts: LifecycleFacts): boolean {
  return facts.decisions.some((decision) => decision.kind === 'merge-refused' && decision.ticketIds.includes(ticketId));
}

/**
 * Without a review phase only a gate's settling queues a build to land, so a ticket already in review when the phase went is queued here;
 * a refused merge took it out of the queue for User, so it waits for the answer.
 */
function mergeQueueStepsOf(facts: LifecycleFacts, ticketIdsSettledThisPass: ReadonlySet<string>): LifecycleStep[] {
  if (facts.reviewIsSet) return [];
  return facts.tickets
    .filter((ticket) => ticket.status === 'in-review' && !ticketIsHeld(ticket, facts) && !ticketHasAJob(ticket.id, facts) && !ticketIdsSettledThisPass.has(ticket.id))
    .filter((ticket) => !mergeRefusalAwaitsUser(ticket.id, facts))
    .map((ticket): LifecycleStep => ({ kind: 'queue-merge', ticketId: ticket.id, target: targetOf(ticket, facts.observations) }));
}

function turnIsClosed(incident: Readonly<Incident>, facts: LifecycleFacts): boolean {
  const turn = incident.deliveredInTurn;
  if (turn === null) return false;
  if (!facts.jobs.some((job) => job.id === turn.jobId)) return true;
  return facts.observations.closedDeliveryTurns.some((closed) => closed.jobId === turn.jobId && closed.chatSequence === turn.chatSequence);
}

function turnSpentItsBudget(incident: Readonly<Incident>, facts: LifecycleFacts): boolean {
  const turn = incident.deliveredInTurn;
  return turn !== null && facts.observations.budgetSpentDeliveryTurns.some((spent) => spent.jobId === turn.jobId && spent.chatSequence === turn.chatSequence);
}

/**
 * A delivered incident defaults when its turn closes. While no orchestrator is running, one holding an Airlock defaults at once and the
 * others wait for a fresh session; while none can come up, every one defaults.
 */
function incidentDefaultStepsOf(facts: LifecycleFacts, noOrchestratorCanComeUp: boolean, orchestratorIsRunning: boolean): LifecycleStep[] {
  return facts.incidents.flatMap((incident): LifecycleStep[] => {
    if (noOrchestratorCanComeUp) return [{ kind: 'default-incident', incidentId: incident.id, cause: 'no-orchestrator' }];
    if (turnIsClosed(incident, facts)) return [{ kind: 'default-incident', incidentId: incident.id, cause: 'turn-closed' }];
    if (turnSpentItsBudget(incident, facts)) return [{ kind: 'default-incident', incidentId: incident.id, cause: 'turn-budget' }];
    if (!orchestratorIsRunning && AIRLOCK_HOLDING_INCIDENT_KINDS.includes(incident.kind)) return [{ kind: 'default-incident', incidentId: incident.id, cause: 'no-orchestrator' }];
    return [];
  });
}

/** One onboarder answers each `checks-not-set`: live now, or launched since the newest one opened, which this pass may be opening. */
function onboarderAnsweredChecksNotSet(facts: LifecycleFacts): boolean {
  if (facts.jobs.some((job) => job.kind === 'onboarder')) return true;
  let launchedSinceTheDecision = false;
  for (const record of facts.logRecords) {
    if (record.kind === 'decision-opened' && record.fields.kind === 'checks-not-set') launchedSinceTheDecision = false;
    if (record.kind === 'job-launched' && record.fields.kind === 'onboarder') launchedSinceTheDecision = true;
  }
  return launchedSinceTheDecision;
}

/** A decision about the whole board, which names no ticket and no job. */
function boardDecisionStepOf(kind: Decision['kind']): LifecycleStep {
  return { kind: 'open-decision', decision: { kind, ticketIds: [], jobId: null } };
}

function ticketIdsOfStep(step: LifecycleStep): readonly string[] {
  if (step.kind === 'park') return [step.ticketId];
  return step.kind === 'open-incident' ? step.incident.ticketIds : [];
}

function nextStepsOf(facts: LifecycleFacts, limits: LifecycleLimits): LifecycleStep[] {
  const outageNow               = facts.runnerState !== 'paused' && outageIsDue(facts, limits);
  const versionOrUsageHolds     = usageLimitHolds(limits) || facts.observations.installVersionChanged;
  const outageHolds             = outageNow || openDecisionOfKind(facts, 'outage');
  const resumesAreHeld          = versionOrUsageHolds || !facts.pipelineIsSet || outageHolds;
  const newWorkIsHeld           = resumesAreHeld || facts.runnerState === 'paused';
  const bootsKeepFailing        = failedOrchestratorBootsOf(facts) >= limits.FAILED_ORCHESTRATOR_BOOTS_BEFORE_DEFAULTING;
  const noOrchestratorCanComeUp = usageLimitHolds(limits) || (bootsKeepFailing && !facts.observations.orchestratorHasAnswered);
  const orchestratorMayBoot     = !usageLimitHolds(limits) && (!bootsKeepFailing || facts.observations.orchestratorBootRetryDue);
  const orchestratorIsLive      = facts.jobs.some((job) => job.kind === 'orchestrator');
  const orchestratorIsRunning   = facts.jobs.some((job) => job.kind === 'orchestrator' && job.state === 'running');

  const steps: LifecycleStep[] = [];
  if (outageNow) steps.push({ kind: 'pause-runner', cause: 'outage' }, boardDecisionStepOf('outage'));
  if (!facts.pipelineIsSet && !openDecisionOfKind(facts, 'checks-not-set')) steps.push(boardDecisionStepOf('checks-not-set'));
  const onboarderIsHeld = versionOrUsageHolds || outageHolds || facts.runnerState === 'paused';
  if (!facts.pipelineIsSet && !onboarderIsHeld && !onboarderAnsweredChecksNotSet(facts)) steps.push({ kind: 'launch-onboarder' });
  steps.push(...crashBoundStepsOf(facts, limits, resumesAreHeld));
  if (!orchestratorIsLive && orchestratorMayBoot && !facts.observations.installVersionChanged) steps.push({ kind: 'boot-orchestrator' });
  const parkSteps    = parkStepsOf(facts, limits);
  const jobLostSteps = jobLostStepsOf(facts, limits);
  steps.push(...parkSteps, ...jobLostSteps);
  const ticketIdsSettledThisPass = new Set([...parkSteps, ...jobLostSteps].flatMap(ticketIdsOfStep));
  if (!newWorkIsHeld) steps.push(...mergeQueueStepsOf(facts, ticketIdsSettledThisPass), ...launchStepsOf(facts, ticketIdsSettledThisPass));
  steps.push(...incidentDefaultStepsOf(facts, noOrchestratorCanComeUp, orchestratorIsRunning));
  return steps;
}

export const LifecyclePolicy = {
  nextStepsOf,
  outageIsDue,
  handoffCycleResumesOf,
} as const;
