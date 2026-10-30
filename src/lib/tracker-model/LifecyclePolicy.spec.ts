/**
 * The lifecycle policy's rules as claims: each a fact set, what must hold of the steps derived from it, and the mutant of the one line that
 * decides it. What matters is that every rule is watched failing: the claim holds on the policy as written and fails on its mutant, so no rule
 * survives a rewrite unnoticed. A mutant whose text stopped matching its line fails its build, never passes by changing nothing.
 */
import { describe, expect, test } from 'bun:test';

import { mutatedModuleOf, type SourceMutant } from '../../testing/SourceMutant.ts';
import type { Decision }                      from './@types/Decision.ts';
import type { Incident }                      from './@types/Incident.ts';
import type { Job }                           from './@types/Job.ts';
import type { LifecycleLimits }               from './@types/LifecycleLimits.ts';
import type { LifecycleStep }                 from './@types/LifecycleStep.ts';
import type { LogRecord }                     from './@types/LogRecord.ts';
import type { LifecycleFacts }                from './LifecyclePolicy.ts';
import { LifecyclePolicy }                    from './LifecyclePolicy.ts';
import {
  FIXTURE_AT,
  FIXTURE_LIMITS,
  FIXTURE_OBSERVATIONS,
  LIVE_ORCHESTRATOR,
  endedRecord,
  factsWith,
  finishedJobRecords,
  interruptedRecord,
  jobFixture,
  launchedRecord,
  launchedTicketIdsOf,
  stepKindsOf,
  ticketOf,
  ticketRecord
}                                             from './testing/LifecycleFixtures.ts';

const POLICY_MODULE = 'src/lib/tracker-model/LifecyclePolicy.ts';

const FAILED_PASS_MODULE = 'src/lib/tracker-model/utils/FailedPassUtil.ts';

interface PolicyClaim {
  name:    string;
  facts:   LifecycleFacts;
  limits?: LifecycleLimits;
  holds:   (steps: readonly LifecycleStep[]) => boolean;
  mutant:  SourceMutant;
}

function policyLine(find: string, replace: string): SourceMutant {
  return { modulePath: POLICY_MODULE, find, replace };
}

function onboarderJob(): Job {
  return jobFixture({
    id: 'J7', kind: 'onboarder', role: 'onboarder', target: null
  });
}

function checksNotSetOpenedRecord(): LogRecord {
  return {
    at: FIXTURE_AT, kind: 'decision-opened', decisionId: 'E1', fields: { kind: 'checks-not-set', ticketIds: [] }
  };
}

function finishedOnboarderRecords(): LogRecord[] {
  return [launchedRecord('J7', 'onboarder', []), endedRecord('J7', 'failed')];
}

function decisionOf(kind: Decision['kind']): Decision {
  return {
    id: 'E1', kind, ticketIds: [], jobId: null, askedBy: 'runner', requestId: null, questions: [], context: '', openedAt: FIXTURE_AT,
  };
}

function incidentOf(overrides: Partial<Incident>): Incident {
  return {
    id: 'I1', kind: 'blocked', ticketIds: [], jobId: null, facts: {}, defaultMove: 'ticket-park', deliveredInTurn: null, openedAt: FIXTURE_AT, ...overrides,
  };
}

function holdsUnder(nextStepsOf: typeof LifecyclePolicy.nextStepsOf, claim: PolicyClaim): boolean {
  try {
    return claim.holds(nextStepsOf(claim.facts, claim.limits ?? FIXTURE_LIMITS));
  } catch {
    return false;
  }
}

function launchesExactly(ticketIds: readonly string[]): (steps: readonly LifecycleStep[]) => boolean {
  return (steps) => launchedTicketIdsOf(steps).join(' ') === ticketIds.join(' ');
}

const INTERRUPTED_BUILD = jobFixture({
  id: 'J1', ticketIds: ['001'], state: 'interrupted', interruption: 'host-lost'
});

const TWO_FAILED_PASSES_WITH_REWORK_BETWEEN: LogRecord[] = [
  ticketRecord('ticket-started', '001'),
  ...finishedJobRecords('J1', 'build', '001', 'failed'),
  ...finishedJobRecords('J2', 'build', '001', 'built', 2),
  ticketRecord('ticket-finished', '001'),
  ...finishedJobRecords('J3', 'review', '001', 'does-not-hold'),
  ticketRecord('ticket-started', '001'),
];

const CRASHES_ON_TWO_TICKETS: LogRecord[] = [
  launchedRecord('J1', 'build', ['001']),
  launchedRecord('J2', 'build', ['002']),
  interruptedRecord('J1', 'agent-crashed'),
  interruptedRecord('J2', 'host-lost'),
];

const USAGE_LIMIT_AHEAD: LifecycleLimits = { ...FIXTURE_LIMITS, usageResetsAt: '2026-10-28T11:00:00+01:00' };

const CLAIMS: PolicyClaim[] = [
  {
    name:   'a resume comes before any launch',
    facts:  factsWith({ tickets: [ticketOf('001', 'in-progress'), ticketOf('002', 'pending')], jobs: [LIVE_ORCHESTRATOR, INTERRUPTED_BUILD] }),
    holds:  (steps) => stepKindsOf(steps).join(' ') === 'resume-job launch-build',
    mutant: policyLine('  steps.push(...crashBoundStepsOf(facts, limits, resumesAreHeld));', ''),
  },
  {
    name:   'a review goes ahead of a ready build of its own rank',
    facts:  factsWith({ tickets: [ticketOf('001', 'pending'), ticketOf('002', 'in-review')], concurrencyLimit: 1 }),
    holds:  launchesExactly(['002']),
    mutant: policyLine('{ review: 0, rebuild: 1, build: 2 }', '{ review: 3, rebuild: 1, build: 2 }'),
  },
  {
    name:  'a rebuild goes ahead of a ready build of its own rank',
    facts: factsWith({
      tickets:          [ticketOf('001', 'pending'), ticketOf('002', 'in-progress')],
      logRecords:       finishedJobRecords('J1', 'build', '002', 'failed'),
      concurrencyLimit: 1,
    }),
    holds:  (steps) => steps.some((step) => step.kind === 'launch-build' && step.ticketId === '002' && step.attempt === 2) && launchedTicketIdsOf(steps).length === 1,
    mutant: policyLine('{ review: 0, rebuild: 1, build: 2 }', '{ review: 0, rebuild: 3, build: 2 }'),
  },
  {
    name:   'a review never goes ahead of a ready build of a higher rank',
    facts:  factsWith({ tickets: [ticketOf('001', 'pending', { priority: 'high' }), ticketOf('002', 'in-review')], concurrencyLimit: 1 }),
    holds:  launchesExactly(['001']),
    mutant: policyLine('    rankOf(a) - rankOf(b)\n', '    0\n'),
  },
  {
    name:   'within a rank the ticket readied first launches first',
    facts:  factsWith({ tickets: [ticketOf('002', 'pending'), ticketOf('003', 'pending')], readinessPositionByTicketId: new Map([['002', 5], ['003', 1]]), concurrencyLimit: 1 }),
    holds:  launchesExactly(['003']),
    mutant: policyLine('    || readinessOf(a) - readinessOf(b)\n', ''),
  },
  {
    name:   'with readiness equal the lower id launches first',
    facts:  factsWith({ tickets: [ticketOf('010', 'pending'), ticketOf('009', 'pending')], concurrencyLimit: 1 }),
    holds:  launchesExactly(['009']),
    mutant: policyLine('Number(a.ticket.id) - Number(b.ticket.id)', 'Number(b.ticket.id) - Number(a.ticket.id)'),
  },
  {
    name:   'a held pending ticket is not ready',
    facts:  factsWith({ tickets: [ticketOf('001', 'pending', { hold: 'by User' })] }),
    holds:  launchesExactly([]),
    mutant: policyLine('  if (ticket.hold !== undefined || ticket.mergeQueued === true) return true;\n', '  if (ticket.mergeQueued === true) return true;\n'),
  },
  {
    name:   'a ticket its passed review queued to merge gets no second review',
    facts:  factsWith({ tickets: [ticketOf('001', 'in-review', { mergeQueued: true })] }),
    holds:  launchesExactly([]),
    mutant: policyLine('  if (ticket.hold !== undefined || ticket.mergeQueued === true) return true;\n', '  if (ticket.hold !== undefined) return true;\n'),
  },
  {
    name:  'an open waiver or agent-config decision naming a ticket holds every launch on it',
    facts: factsWith({
      tickets:   [ticketOf('001', 'in-review')],
      decisions: [{
        id: 'E1', kind: 'waiver', ticketIds: ['001'], jobId: null, askedBy: 'reviewer', requestId: null, questions: [], context: '', openedAt: FIXTURE_AT
      }],
    }),
    holds:  launchesExactly([]),
    mutant: policyLine(
      '  if (facts.decisions.some((decision) => TICKET_HOLDING_DECISION_KINDS.includes(decision.kind) && decision.ticketIds.includes(ticket.id))) return true;\n',
      '',
    ),
  },
  {
    name:   'a pending ticket waits for its dependencies to be reviewed or delivered',
    facts:  factsWith({ tickets: [ticketOf('001', 'in-progress'), ticketOf('002', 'pending', { dependsOn: ['001'] })] }),
    holds:  launchesExactly([]),
    mutant: policyLine('  if (TicketDependencyUtil.unsettledDependenciesOf(ticket.dependsOn ?? [], statusById).length > 0) return null;\n', ''),
  },
  {
    name:   'a group ticket builds from its group branch',
    facts:  factsWith({ tickets: [ticketOf('001', 'pending', { group: 'lifecycle' })] }),
    holds:  (steps) => steps.some((step) => step.kind === 'launch-build' && step.base === 'group-lifecycle'),
    mutant: policyLine('`${observations.groupTargetPrefix}${ticket.group}`', 'observations.mainLine'),
  },
  {
    name:  'a ticket with a live job gets no second one',
    facts: factsWith({
      tickets: [ticketOf('001', 'pending')],
      jobs:    [LIVE_ORCHESTRATOR, jobFixture({
        id: 'J1', ticketIds: ['001'], kind: 'merge', role: null
      })]
    }),
    holds:  launchesExactly([]),
    mutant: policyLine('!ticketIdsSettledThisPass.has(ticket.id) && !ticketHasAJob(ticket.id, facts) && ', '!ticketIdsSettledThisPass.has(ticket.id) && '),
  },
  {
    name:  'a job waiting for an answer keeps its slot',
    facts: factsWith({
      tickets:          [ticketOf('001', 'in-progress'), ticketOf('002', 'pending'), ticketOf('003', 'pending')],
      jobs:             [LIVE_ORCHESTRATOR, jobFixture({ id: 'J1', ticketIds: ['001'], state: 'waiting-for-answer' })],
      concurrencyLimit: 2,
    }),
    holds:  launchesExactly(['002']),
    mutant: policyLine('SLOT_TAKING_JOB_KINDS.includes(job.kind))', 'SLOT_TAKING_JOB_KINDS.includes(job.kind) && job.state !== \'waiting-for-answer\')'),
  },
  {
    name:  'a ticket whose ended job left its question open launches nothing until User answers',
    facts: factsWith({
      tickets:   [ticketOf('001', 'in-review')],
      decisions: [{
        id: 'E1', kind: 'agent-question', ticketIds: ['001'], jobId: null, askedBy: 'builder', requestId: 'request-1', questions: [], context: '', openedAt: FIXTURE_AT
      }],
    }),
    holds:  launchesExactly([]),
    mutant: policyLine('decision.kind === \'agent-question\' && decision.jobId === null && ', 'decision.kind === \'never\' && '),
  },
  {
    name:  'an interrupted job whose question is open resumes only once it is answered, so the resume carries the answer',
    facts: factsWith({
      tickets: [ticketOf('001', 'in-progress')],
      jobs:    [LIVE_ORCHESTRATOR, jobFixture({
        id: 'J1', ticketIds: ['001'], state: 'interrupted', interruption: 'reboot'
      })],
      decisions: [{
        id: 'E1', kind: 'agent-question', ticketIds: ['001'], jobId: 'J1', askedBy: 'builder', requestId: 'request-1', questions: [], context: '', openedAt: FIXTURE_AT
      }],
    }),
    holds:  (steps) => !steps.some((step) => step.kind === 'resume-job'),
    mutant: policyLine(' || jobAwaitsAnAnswer(job, facts)) return [];', ') return [];'),
  },
  {
    name:   'an orchestrator job takes no slot',
    facts:  factsWith({ tickets: [ticketOf('001', 'pending')], concurrencyLimit: 1 }),
    holds:  launchesExactly(['001']),
    mutant: policyLine('= [\'build\', \'review\'];', '= [\'build\', \'review\', \'orchestrator\'];'),
  },
  {
    name:   'launches stop at the concurrency limit',
    facts:  factsWith({ tickets: [ticketOf('001', 'pending'), ticketOf('002', 'pending')], concurrencyLimit: 1 }),
    holds:  launchesExactly(['001']),
    mutant: policyLine('    .slice(0, freeSlotsOf(facts))\n', ''),
  },
  {
    name:   'a job crash-resumed up to the bound is replaced, not resumed',
    facts:  factsWith({ tickets: [ticketOf('001', 'in-progress')], jobs: [LIVE_ORCHESTRATOR, { ...INTERRUPTED_BUILD, crashResumes: FIXTURE_LIMITS.JOB_RESUMES_BEFORE_FRESH }] }),
    holds:  (steps) => stepKindsOf(steps).join(' ') === 'replace-job',
    mutant: policyLine('job.crashResumes >= limits.JOB_RESUMES_BEFORE_FRESH', 'job.crashResumes > limits.JOB_RESUMES_BEFORE_FRESH'),
  },
  {
    name:   'a job interrupted by a reboot resumes whatever its crash count',
    facts:  factsWith({ tickets: [ticketOf('001', 'in-progress')], jobs: [LIVE_ORCHESTRATOR, { ...INTERRUPTED_BUILD, interruption: 'reboot', crashResumes: 5 }] }),
    holds:  (steps) => stepKindsOf(steps).join(' ') === 'resume-job',
    mutant: policyLine('return isCrash(job.interruption) && job.crashResumes', 'return job.crashResumes'),
  },
  {
    name:   'a session that went down is replaced, never resumed',
    facts:  factsWith({ jobs: [{ ...LIVE_ORCHESTRATOR, state: 'interrupted', interruption: 'host-lost' }] }),
    holds:  (steps) => stepKindsOf(steps).join(' ') === 'replace-job',
    mutant: policyLine('    if (SESSION_JOB_KINDS.includes(job.kind)) return [{ kind: \'replace-job\', jobId: job.id }];\n', ''),
  },
  {
    name:   'the second failed pass parks the ticket, rework between them kept, and opens no incident',
    facts:  factsWith({ tickets: [ticketOf('001', 'in-progress')], logRecords: TWO_FAILED_PASSES_WITH_REWORK_BETWEEN }),
    holds:  (steps) => stepKindsOf(steps).join(' ') === 'park',
    mutant: policyLine('>= limits.FAILED_PASSES_BEFORE_PARKING', '> limits.FAILED_PASSES_BEFORE_PARKING'),
  },
  {
    name:   'a review that does not hold is a failed pass',
    facts:  factsWith({ tickets: [ticketOf('001', 'in-progress')], logRecords: TWO_FAILED_PASSES_WITH_REWORK_BETWEEN }),
    holds:  (steps) => stepKindsOf(steps).join(' ') === 'park',
    mutant: { modulePath: FAILED_PASS_MODULE, find: '[\'failed\', \'does-not-hold\']', replace: '[\'failed\']' },
  },
  {
    name:   'a start from review is rework and keeps the failed passes',
    facts:  factsWith({ tickets: [ticketOf('001', 'in-progress')], logRecords: TWO_FAILED_PASSES_WITH_REWORK_BETWEEN }),
    holds:  (steps) => stepKindsOf(steps).join(' ') === 'park',
    mutant: { modulePath: FAILED_PASS_MODULE, find: 'record.kind === \'ticket-started\' && !ticketIsInReview', replace: 'record.kind === \'ticket-started\'' },
  },
  {
    name:   'unholding a ticket starts its failed passes again, so it rebuilds',
    facts:  factsWith({ tickets: [ticketOf('001', 'in-progress')], logRecords: [...TWO_FAILED_PASSES_WITH_REWORK_BETWEEN, ticketRecord('ticket-unheld', '001')] }),
    holds:  (steps) => stepKindsOf(steps).join(' ') === 'launch-build',
    mutant: { modulePath: FAILED_PASS_MODULE, find: '    if (record.kind === \'ticket-unheld\') failedPasses = 0;\n', replace: '' },
  },
  {
    name:   'a ticket parked in this pass does not launch in it',
    facts:  factsWith({ tickets: [ticketOf('001', 'in-progress')], logRecords: TWO_FAILED_PASSES_WITH_REWORK_BETWEEN }),
    holds:  launchesExactly([]),
    mutant: policyLine('!ticketIdsSettledThisPass.has(ticket.id) && !ticketHasAJob', '!ticketHasAJob'),
  },
  {
    name:   'two crashed jobs on different tickets stop dispatching and open the outage decision',
    facts:  factsWith({ logRecords: CRASHES_ON_TWO_TICKETS }),
    holds:  (steps) => stepKindsOf(steps).slice(0, 2).join(' ') === 'stop-dispatching open-decision',
    mutant: policyLine('>= limits.CONSECUTIVE_DEAD_AGENTS_BEFORE_STOPPING', '> limits.CONSECUTIVE_DEAD_AGENTS_BEFORE_STOPPING'),
  },
  {
    name:   'two crashes on one ticket are no outage',
    facts:  factsWith({ logRecords: [launchedRecord('J1', 'build', ['001']), interruptedRecord('J1', 'host-lost'), interruptedRecord('J1', 'host-lost')] }),
    holds:  (steps) => !stepKindsOf(steps).includes('stop-dispatching'),
    mutant: policyLine('crashedTicketKeys.at(-1) === ticketKey ? [ticketKey] : [...crashedTicketKeys, ticketKey]', '[...crashedTicketKeys, ticketKey]'),
  },
  {
    name:   'reboots are never counted toward an outage',
    facts:  factsWith({ logRecords: [...CRASHES_ON_TWO_TICKETS.slice(0, 2), interruptedRecord('J1', 'reboot'), interruptedRecord('J2', 'reboot')] }),
    holds:  (steps) => !stepKindsOf(steps).includes('stop-dispatching'),
    mutant: policyLine('record.kind !== \'job-interrupted\' || !isCrash(record.fields.cause)', 'record.kind !== \'job-interrupted\''),
  },
  {
    name:   'a verified job ending between two crashes breaks the run',
    facts:  factsWith({ logRecords: [...CRASHES_ON_TWO_TICKETS.slice(0, 3), ...finishedJobRecords('J3', 'build', '003', 'built'), interruptedRecord('J2', 'host-lost')] }),
    holds:  (steps) => !stepKindsOf(steps).includes('stop-dispatching'),
    mutant: policyLine('    if (record.kind === \'job-ended\' && VERIFIED_OUTCOMES.includes(record.fields.outcome)) crashedTicketKeys = [];\n', ''),
  },
  {
    name:  'the outage opens once for the crashes that opened it',
    facts: factsWith({
      logRecords: [...CRASHES_ON_TWO_TICKETS, {
        kind: 'decision-opened', decisionId: 'E1', fields: { kind: 'outage', ticketIds: [] }, at: FIXTURE_AT
      }]
    }),
    holds:  (steps) => !stepKindsOf(steps).includes('stop-dispatching'),
    mutant: policyLine('    if (record.kind === \'decision-opened\' && record.fields.kind === \'outage\') crashedTicketKeys = [];\n', ''),
  },
  {
    name:   'an open outage decision holds resumes',
    facts:  factsWith({ tickets: [ticketOf('001', 'in-progress')], jobs: [LIVE_ORCHESTRATOR, INTERRUPTED_BUILD], decisions: [decisionOf('outage')] }),
    holds:  (steps) => !stepKindsOf(steps).includes('resume-job'),
    mutant: policyLine(' || openDecisionOfKind(facts, \'outage\')', ''),
  },
  {
    name:   'a stopped board resumes interrupted jobs but launches nothing new',
    facts:  factsWith({ tickets: [ticketOf('001', 'in-progress'), ticketOf('002', 'pending')], jobs: [LIVE_ORCHESTRATOR, INTERRUPTED_BUILD], dispatcherState: 'stopped' }),
    holds:  (steps) => stepKindsOf(steps).join(' ') === 'resume-job',
    mutant: policyLine('resumesAreHeld || facts.dispatcherState === \'stopped\'', 'resumesAreHeld'),
  },
  {
    name:  'two replaced jobs in a row on one ticket open a job-lost incident defaulting to park',
    facts: factsWith({
      tickets:    [ticketOf('001', 'in-progress')],
      logRecords: [...finishedJobRecords('J1', 'build', '001', 'replaced'), ...finishedJobRecords('J2', 'build', '001', 'replaced', 2)],
    }),
    holds: (steps) => launchedTicketIdsOf(steps).length === 0
      && steps.some((step) => step.kind === 'open-incident' && step.incident.kind === 'job-lost' && step.incident.defaultMove === 'ticket-park'),
    mutant: policyLine('>= limits.REPLACED_JOBS_BEFORE_JOB_LOST', '> limits.REPLACED_JOBS_BEFORE_JOB_LOST'),
  },
  {
    name:  'an open job-lost incident holds the ticket',
    facts: factsWith({
      tickets:    [ticketOf('001', 'in-progress')],
      logRecords: finishedJobRecords('J1', 'build', '001', 'replaced'),
      incidents:  [incidentOf({ kind: 'job-lost', ticketIds: ['001'] })],
    }),
    holds:  launchesExactly([]),
    mutant: policyLine('  if (facts.incidents.some((incident) => incident.ticketIds.includes(ticket.id))) return true;\n', ''),
  },
  {
    name:   'with no checks line nothing launches and one checks-not-set decision opens',
    facts:  factsWith({ tickets: [ticketOf('001', 'pending')], pipelineIsSet: false }),
    holds:  (steps) => stepKindsOf(steps).join(' ') === 'open-decision launch-onboarder',
    mutant: policyLine(' || !facts.pipelineIsSet', ''),
  },
  {
    name:   'an open checks-not-set decision is not opened again',
    facts:  factsWith({ pipelineIsSet: false, decisions: [decisionOf('checks-not-set')], jobs: [LIVE_ORCHESTRATOR, onboarderJob()] }),
    holds:  (steps) => steps.length === 0,
    mutant: policyLine(' && !openDecisionOfKind(facts, \'checks-not-set\')', ''),
  },
  {
    name:   'a live onboarder answers checks-not-set, so no second one launches',
    facts:  factsWith({ pipelineIsSet: false, decisions: [decisionOf('checks-not-set')], jobs: [LIVE_ORCHESTRATOR, onboarderJob()] }),
    holds:  (steps) => !stepKindsOf(steps).includes('launch-onboarder'),
    mutant: policyLine('  if (facts.jobs.some((job) => job.kind === \'onboarder\')) return true;\n', ''),
  },
  {
    name:  'an onboarder launched since checks-not-set opened answered it, though it ended',
    facts: factsWith({
      pipelineIsSet: false,
      decisions:     [decisionOf('checks-not-set')],
      logRecords:    [checksNotSetOpenedRecord(), ...finishedOnboarderRecords()],
    }),
    holds:  (steps) => !stepKindsOf(steps).includes('launch-onboarder'),
    mutant: policyLine('launchedSinceTheDecision = true;', 'launchedSinceTheDecision = false;'),
  },
  {
    name:   'a checks-not-set opened again after the onboarder ended launches a fresh one',
    facts:  factsWith({ pipelineIsSet: false, logRecords: [...finishedOnboarderRecords(), checksNotSetOpenedRecord()] }),
    holds:  (steps) => stepKindsOf(steps).includes('launch-onboarder'),
    mutant: policyLine('\'checks-not-set\') launchedSinceTheDecision = false;', '\'checks-not-set\') launchedSinceTheDecision = true;'),
  },
  {
    name:   'a stopped board launches no onboarder',
    facts:  factsWith({ pipelineIsSet: false, dispatcherState: 'stopped' }),
    holds:  (steps) => !stepKindsOf(steps).includes('launch-onboarder'),
    mutant: policyLine('outageHolds || facts.dispatcherState === \'stopped\'', 'outageHolds'),
  },
  {
    name:   'a usage limit holds launches and resumes until its reset',
    facts:  factsWith({ tickets: [ticketOf('001', 'in-progress'), ticketOf('002', 'pending')], jobs: [LIVE_ORCHESTRATOR, INTERRUPTED_BUILD] }),
    limits: USAGE_LIMIT_AHEAD,
    holds:  (steps) => steps.length === 0,
    mutant: policyLine('limits.usageResetsAt !== null && Date.parse(limits.now) < Date.parse(limits.usageResetsAt)', 'false'),
  },
  {
    name:  'a changed install version holds launches and resumes',
    facts: factsWith({
      tickets:      [ticketOf('001', 'in-progress'), ticketOf('002', 'pending')],
      jobs:         [LIVE_ORCHESTRATOR, INTERRUPTED_BUILD],
      observations: { ...FIXTURE_OBSERVATIONS, installVersionChanged: true },
    }),
    holds:  (steps) => steps.length === 0,
    mutant: policyLine('usageLimitHolds(limits) || facts.observations.installVersionChanged', 'usageLimitHolds(limits)'),
  },
  {
    name:   'a target whose CLAUDE.md holds the managed block launches nothing',
    facts:  factsWith({ tickets: [ticketOf('001', 'pending')], observations: { ...FIXTURE_OBSERVATIONS, targetsHoldingManagedBlock: ['main'] } }),
    holds:  launchesExactly([]),
    mutant: policyLine('  return facts.observations.targetsHoldingManagedBlock.includes(targetOf(ticket, facts.observations));', '  return false;'),
  },
  {
    name:   'a branch that touched agent configuration launches nothing',
    facts:  factsWith({ tickets: [ticketOf('001', 'in-review')], observations: { ...FIXTURE_OBSERVATIONS, ticketIdsTouchingAgentConfig: ['001'] } }),
    holds:  launchesExactly([]),
    mutant: policyLine('  if (facts.observations.ticketIdsTouchingAgentConfig.includes(ticket.id)) return true;\n', ''),
  },
  {
    name:   'with no orchestrator live one boots',
    facts:  factsWith({ jobs: [] }),
    holds:  (steps) => stepKindsOf(steps).join(' ') === 'boot-orchestrator',
    mutant: policyLine(' steps.push({ kind: \'boot-orchestrator\' });', ' steps.push();'),
  },
  {
    name:  'after two failed boots no orchestrator boots and every open incident takes its default',
    facts: factsWith({
      jobs:       [],
      incidents:  [incidentOf({})],
      logRecords: [launchedRecord('J1', 'orchestrator', []), endedRecord('J1', 'failed'), launchedRecord('J2', 'orchestrator', []), endedRecord('J2', 'failed')],
    }),
    holds:  (steps) => steps.length === 1 && steps[0]?.kind === 'default-incident' && steps[0].cause === 'no-orchestrator',
    mutant: policyLine('>= limits.FAILED_ORCHESTRATOR_BOOTS_BEFORE_DEFAULTING', '> limits.FAILED_ORCHESTRATOR_BOOTS_BEFORE_DEFAULTING'),
  },
  {
    name:  'during a reboot a merge-gate-failed takes its default in that pass while a blocked one waits for the fresh session',
    facts: factsWith({
      jobs:      [{ ...LIVE_ORCHESTRATOR, state: 'interrupted', interruption: 'reboot' }],
      incidents: [incidentOf({ id: 'I1', kind: 'merge-gate-failed', defaultMove: 'merge-abort' }), incidentOf({ id: 'I2', kind: 'blocked' })],
    }),
    holds: (steps) => steps.filter((step) => step.kind === 'default-incident')
      .map((step) => (step.kind === 'default-incident' ? `${step.incidentId} ${step.cause}` : '')).join(',') === 'I1 no-orchestrator',
    mutant: policyLine('!orchestratorIsRunning && AIRLOCK_HOLDING_INCIDENT_KINDS', 'false && AIRLOCK_HOLDING_INCIDENT_KINDS'),
  },
  {
    name:   'a resolution over the threshold waits for nobody while no orchestrator is running',
    facts:  factsWith({ jobs: [], incidents: [incidentOf({ kind: 'resolution-over-threshold', defaultMove: 'merge-review' })] }),
    holds:  (steps) => steps.some((step) => step.kind === 'default-incident' && step.cause === 'no-orchestrator'),
    mutant: policyLine('[\'merge-gate-failed\', \'resolution-over-threshold\']', '[\'merge-gate-failed\']'),
  },
  {
    name:  'an incident delivered in a closed turn takes its default',
    facts: factsWith({
      incidents:    [incidentOf({ deliveredInTurn: { jobId: 'J900', chatSequence: 3 } })],
      observations: { ...FIXTURE_OBSERVATIONS, closedDeliveryTurns: [{ jobId: 'J900', chatSequence: 3 }] },
    }),
    holds:  (steps) => steps.length === 1 && steps[0]?.kind === 'default-incident' && steps[0].cause === 'turn-closed',
    mutant: policyLine('  return facts.observations.closedDeliveryTurns.some(', '  return false && facts.observations.closedDeliveryTurns.some('),
  },
  {
    name:   'an incident delivered to an orchestrator that is gone takes its default',
    facts:  factsWith({ incidents: [incidentOf({ deliveredInTurn: { jobId: 'J7', chatSequence: 1 } })] }),
    holds:  (steps) => stepKindsOf(steps).join(' ') === 'default-incident',
    mutant: policyLine('  if (!facts.jobs.some((job) => job.id === turn.jobId)) return true;\n', ''),
  },
  {
    name:   'an undelivered incident keeps waiting',
    facts:  factsWith({ incidents: [incidentOf({})] }),
    holds:  (steps) => steps.length === 0,
    mutant: policyLine('  if (turn === null) return false;\n', '  if (turn === null) return true;\n'),
  },
  {
    name:  'a review after a granted round is the next round',
    facts: factsWith({
      tickets:    [ticketOf('001', 'in-review')],
      logRecords: [ticketRecord('ticket-finished', '001'), ...finishedJobRecords('J1', 'review', '001', 'round-granted')],
    }),
    holds:  (steps) => steps.some((step) => step.kind === 'launch-review' && step.round === 2),
    mutant: policyLine('grantedRounds += 1', 'grantedRounds += 0'),
  },
];

describe('each lifecycle rule holds as written', () => {
  test.each(CLAIMS.map((claim) => [claim.name, claim] as const))('%s', (_name, claim) => {
    expect(holdsUnder(LifecyclePolicy.nextStepsOf, claim)).toBe(true);
  });
});

describe('each lifecycle rule fails under the mutant of its line', () => {
  test.each(CLAIMS.map((claim) => [claim.name, claim] as const))('%s', async (_name, claim) => {
    const mutated = await mutatedModuleOf(POLICY_MODULE, claim.mutant);
    const policy  = mutated['LifecyclePolicy'] as typeof LifecyclePolicy;
    expect(holdsUnder(policy.nextStepsOf, claim)).toBe(false);
  });
});
