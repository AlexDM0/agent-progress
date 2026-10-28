/**
 * A build job end to end (design sections 4.4 and 5): the runner prepares the ticket's worktree from the target tip, runs the install line
 * in a sandboxed process host, launches the builder, takes its closing report, closes its input, verifies, gates in a sandboxed process
 * host, and writes the Handoff and finishes the ticket, each step a job state. Observing happens outside the lock, the moves in the hold,
 * and the effects (git, hosts, frames) after it; a step's progress lives on disk in the job folder, so a restart observes it again.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { dirname, join } from 'node:path';

import type { HostEnd }        from '../../lib/agent-host/HostRecord.ts';
import type { AgentAdapter }   from '../../lib/agent-launch/AgentAdapter.ts';
import { launchEnvironmentOf } from '../../lib/agent-launch/LaunchEnvironment.ts';
import { GitProcess }          from '../../lib/git/GitProcess.ts';
import type {
  GateOutcome,
  Job,
  JobKind,
  JobOutcome
} from '../../lib/tracker-model/@types/Job.ts';
import type { DecisionDraft, DecisionWording }                    from '../../lib/tracker-model/@types/LifecycleStep.ts';
import type { LogRecord }                                         from '../../lib/tracker-model/@types/LogRecord.ts';
import type { Board }                                             from '../../lib/tracker-model/Board.ts';
import { FRESH_AGENT_CAUSE, STOPPED_BY_USER_CAUSE }               from '../../lib/tracker-model/JobControls.ts';
import { TicketBodyHashUtil }                                     from '../../lib/tracker-model/utils/TicketBodyHashUtil.ts';
import { DISPATCH_PROTOCOL }                                      from '../../shared/constants/DispatchProtocol.ts';
import { LIFECYCLE_LIMITS }                                       from '../../shared/constants/LifecycleLimits.ts';
import { PRODUCT_NAMES }                                          from '../../shared/constants/ProductNames.ts';
import { SESSION_STOP_GRACE_MILLISECONDS, WIND_DOWN_GRACE_CALLS } from '../../shared/constants/RunnerLimits.ts';
import { gateCacheKeyOf, type GateResultCache }                   from '../lifecycle/GateResultCache.ts';
import { GateRun }                                                from '../lifecycle/GateRun.ts';
import {
  agentConfigTouchedBeforeLaunch,
  type JobVerificationSubject,
  launchSnapshotOf,
  type LaunchSnapshot,
  type RefMovesAllowed,
  VERIFICATION_CHECKS,
  verifyJob
} from '../lifecycle/JobVerification.ts';
import { ReviewOutcome }                     from '../lifecycle/ReviewOutcome.ts';
import type { TrackerChange }                from '../tracker/TrackerPipeline.ts';
import type { Workspace }                    from '../tracker/Workspace.ts';
import { GroupWorktrees }                    from './GroupWorktrees.ts';
import { HostFleet }                         from './HostFleet.ts';
import type { ProcessHostSandbox }           from './ProcessHostSandbox.ts';
import { RelayInbox }                        from './RelayInbox.ts';
import { WorkerProfiles, type SandboxFacts } from './WorkerProfiles.ts';

export interface JobLaunchContext {
  workspace:            Workspace;
  agentAdapter:         AgentAdapter;
  monitorFolder:        string;
  homeDirectory:        string;
  inheritedEnvironment: Readonly<Record<string, string | undefined>>;
  mainLine:             string;
  groupTargetPrefix:    string;
  hostBundlePath:       string;
  codeVersion:          string;
  sandbox:              ProcessHostSandbox;
  gateCache:            GateResultCache;
  windDownMessage:      string;
  decisionWordingOf:    (draft: DecisionDraft) => DecisionWording;
  log:                  (line: string) => void;
}

export type SetupProgress = 'creating-worktree' | 'worktree-failed' | 'installing' | 'install-failed' | 'installed';

/** The stored lines a gate is run and cached by, each `null` when none is stored. */
export interface GateLines {
  checksLine:  string | null;
  installLine: string | null;
  keyCommand:  string | null;
}

export type GateProgress =
  | { verdict: 'pending' }
  /** The key command exited 0 and the gate host has yet to end: a verdict of its own, so the pass that spawns the gate host is not skipped. */
  | { verdict: 'keyed'; treeId: string; keyOutput: string }
  | { verdict: 'judged'; treeId: string; outcome: GateOutcome; cached: boolean; keyOutput: string | null };

type GateKeyReading = { verdict: 'pending' } | { verdict: 'cannot-run' } | { verdict: 'read'; keyOutput: string | null };

export interface BuildJobObservation {
  jobId:    string;
  setup:    SetupProgress;
  /** Top-level assistant turns across every host instance of the job. */
  calls:    number;
  /** The structured report of the newest `result`, `undefined` before one. */
  report:   unknown;
  agentEnd: HostEnd | 'lost' | null;
  gate:     GateProgress;
}

/** What the runner writes in the job folder beside its hosts; only the runner writes there. */
const JOB_FILES = {
  worktreeFailure: 'worktree-failure.txt',
  start:           'start.json',
  windDownSent:    'wind-down-sent',
  inputClosed:     'input-closed',
  stopSent:        'stop-sent',
  profile:         'process-sandbox.sb',
} as const;

const INSTALL_HOST_FOLDER = 'install';
const GATE_HOST_FOLDER = 'gate';
const GATE_KEY_HOST_FOLDER = 'gate-key';
const PROCESS_HOST_INSTANCE = 1;
const REVIEW_JOB_KIND = 'review';

/** The jobs whose session works a ticket's worktree: each is prepared, verified and gated the same way, and only its outcome differs. */
const WORKTREE_JOB_KINDS: readonly JobKind[] = ['build', REVIEW_JOB_KIND];

function isWorktreeJob(job: Readonly<Job>): boolean {
  return WORKTREE_JOB_KINDS.includes(job.kind);
}

const AGENT_CONFIG_DECISION = 'branch-touches-agent-config';

/** The job endings that move a target's ref: the landings V14 lets pass. */
const LANDING_OUTCOMES: readonly JobOutcome[] = ['landed', 'integrated', 'refreshed'];

function callBudgetOf(job: Readonly<Job>): number {
  return job.kind === REVIEW_JOB_KIND ? DISPATCH_PROTOCOL.REVIEWER_API_CALL_BUDGET : DISPATCH_PROTOCOL.BUILDER_API_CALL_BUDGET;
}
const HANDOFF_HEADING = /^## Handoff[ \t]*$/;
const SECTION_HEADING = /^## /;

/** The causes a build job ends with, which the log stores and the notices read back. */
export const BUILD_JOB_CAUSES = {
  noReport:      'no-report',
  attribution:   'attribution',
  setupFailed:   'setup-failed',
  outOfCalls:    'out-of-calls',
  gateFailed:    'gate-failed',
  gateCannotRun: 'gate-cannot-run',
  cannotBuild:   'cannot-build',
} as const;

interface JobStart {
  startCommit:      string;
  bodyHashAtLaunch: string;
  launchSnapshot:   LaunchSnapshot;
}

function ticketIdOf(job: Readonly<Job>): string {
  return job.ticketIds[0] ?? '';
}

function worktreeOf(workspace: Workspace, job: Readonly<Job>): string {
  return join(workspace.rootDirectory, PRODUCT_NAMES.WORKTREES_FOLDER, `ticket-${ticketIdOf(job)}`);
}

function branchOf(job: Readonly<Job>): string {
  return `ticket-${ticketIdOf(job)}`;
}

function jobFolderOf(workspace: Workspace, job: Readonly<Job>): string {
  return HostFleet.jobFolderOf(workspace.trackerDirectory, job.id);
}

function processHostEnd(hostFolder: string): HostEnd | 'lost' | 'pending' {
  const liveness = HostFleet.livenessOf(hostFolder, PROCESS_HOST_INSTANCE);
  if (liveness.verdict === 'ended') return liveness.end;
  return liveness.verdict === 'lost' ? 'lost' : 'pending';
}

function setupProgressOf(context: JobLaunchContext, job: Readonly<Job>, installLine: string | null): SetupProgress {
  const jobFolder = jobFolderOf(context.workspace, job);
  if (existsSync(join(jobFolder, JOB_FILES.worktreeFailure))) return 'worktree-failed';
  if (!existsSync(worktreeOf(context.workspace, job))) return 'creating-worktree';
  if (installLine === null) return 'installed';
  const end = processHostEnd(join(jobFolder, INSTALL_HOST_FOLDER));
  if (end === 'pending') return 'installing';
  return end !== 'lost' && end.reason === 'exited' && end.exitCode === 0 ? 'installed' : 'install-failed';
}

function sessionReadingOf(context: JobLaunchContext, job: Readonly<Job>): { calls: number; report: unknown } {
  const jobFolder = jobFolderOf(context.workspace, job);
  const topLevelMessageIds = new Set<string>();
  let report: unknown = undefined;
  for (let instance = 1; instance <= job.hostInstance; instance += 1) {
    const entries = HostFleet.eventsAfter(jobFolder, instance, 0);
    if (entries === 'malformed') continue;
    for (const entry of entries.filter((logged) => logged.origin === 'agent')) {
      for (const event of context.agentAdapter.eventsOf(entry.line)) {
        if (event.kind === 'assistant-turn' && event.parentToolUseId === null) topLevelMessageIds.add(event.messageId);
        if (event.kind === 'result') report = event.structuredReport;
      }
    }
  }
  return { calls: topLevelMessageIds.size, report };
}

function treeOf(worktree: string): string | null {
  const run = GitProcess.run(worktree, ['rev-parse', '--verify', '--quiet', 'HEAD^{tree}']);
  return run !== null && GitProcess.succeeded(run) ? run.standardOutput.trim() : null;
}

/** A key host that did not exit 0, or was lost, leaves the cache key unknowable: the gate cannot run, and nothing is cached. */
function gateKeyReadingOf(context: JobLaunchContext, job: Readonly<Job>, keyCommand: string | null): GateKeyReading {
  if (keyCommand === null) return { verdict: 'read', keyOutput: null };
  const keyHostFolder = join(jobFolderOf(context.workspace, job), GATE_KEY_HOST_FOLDER);
  const end = processHostEnd(keyHostFolder);
  if (end === 'pending') return { verdict: 'pending' };
  if (end === 'lost' || end.reason !== 'exited' || end.exitCode !== 0) return { verdict: 'cannot-run' };
  const entries = HostFleet.eventsAfter(keyHostFolder, PROCESS_HOST_INSTANCE, 0);
  if (entries === 'malformed') return { verdict: 'cannot-run' };
  return { verdict: 'read', keyOutput: GateRun.keyOutputOf(entries.filter((entry) => entry.origin === 'agent').map((entry) => entry.line).join('\n')) };
}

function gateProgressOf(context: JobLaunchContext, job: Readonly<Job>, checksLine: string, lines: GateLines): GateProgress {
  const treeId = treeOf(worktreeOf(context.workspace, job));
  if (treeId === null) return { verdict: 'pending' };
  const keyReading = gateKeyReadingOf(context, job, lines.keyCommand);
  if (keyReading.verdict === 'pending') return { verdict: 'pending' };
  if (keyReading.verdict === 'cannot-run') return {
    verdict: 'judged', treeId, outcome: 'cannot-run', cached: false, keyOutput: null
  };
  const { keyOutput } = keyReading;
  const gateHostFolder = join(jobFolderOf(context.workspace, job), GATE_HOST_FOLDER);
  const end = processHostEnd(gateHostFolder);
  if (end === 'pending' || end === 'lost') {
    const cached = HostFleet.livenessOf(gateHostFolder, PROCESS_HOST_INSTANCE).verdict === 'unclaimed'
      && context.gateCache.holdsPassOf(gateCacheKeyOf({
        treeId, checksLine, installLine: lines.installLine, keyOutput
      }));
    if (cached) return {
      verdict: 'judged', treeId, outcome: 'passed', cached: true, keyOutput
    };
    return keyOutput === null ? { verdict: 'pending' } : { verdict: 'keyed', treeId, keyOutput };
  }
  const outcome = GateRun.gateOutcomeOf({ exitCode: end.reason === 'exited' ? end.exitCode : null, signalCode: end.signal, output: '' });
  return {
    verdict: 'judged', treeId, outcome, cached: false, keyOutput
  };
}

/** Read outside the lock, for every live build job. */
function observeBuildJobs(context: JobLaunchContext, jobs: readonly Readonly<Job>[], lines: GateLines): BuildJobObservation[] {
  const { checksLine, installLine } = lines;
  return jobs.filter(isWorktreeJob).map((job) => {
    const liveness = HostFleet.livenessOf(jobFolderOf(context.workspace, job), job.hostInstance);
    return {
      jobId:    job.id,
      setup:    job.state === 'preparing' ? setupProgressOf(context, job, installLine) : 'installed',
      ...sessionReadingOf(context, job),
      agentEnd: liveness.verdict === 'ended' ? liveness.end : liveness.verdict === 'lost' ? 'lost' : null,
      gate:     job.state === 'gating' && checksLine !== null ? gateProgressOf(context, job, checksLine, lines) : { verdict: 'pending' },
    };
  });
}

function readJobStart(jobFolder: string): JobStart | null {
  try {
    return JSON.parse(readFileSync(join(jobFolder, JOB_FILES.start), 'utf8')) as JobStart;
  } catch {
    return null;
  }
}

function reportFieldOf(report: unknown, field: string): unknown {
  return typeof report === 'object' && report !== null && Object.hasOwn(report, field) ? (report as Record<string, unknown>)[field] : undefined;
}

/** The Handoff code writes from a verified report: the builder's own handoff, then each Acceptance item's evidence. */
function handoffSectionOf(report: unknown): string {
  const acceptance = reportFieldOf(report, 'acceptance');
  const evidenceLines = (Array.isArray(acceptance) ? acceptance : []).map((entry) => {
    const state = reportFieldOf(entry, 'state') === 'waiver-proposed' ? ' waiver proposed' : '';
    return `- ${String(reportFieldOf(entry, 'item'))}${state} — ${String(reportFieldOf(entry, 'evidence'))}`;
  });
  return `## Handoff\n\n${String(reportFieldOf(report, 'handoff') ?? '').trim()}\n${evidenceLines.length === 0 ? '' : `\n${evidenceLines.join('\n')}\n`}`;
}

/** The body with its `## Handoff` section, the filing template's guidance included, replaced by code's; appended when it has none. */
function bodyWithHandoffOf(body: string, handoffSection: string): string {
  const lines = body.split('\n');
  const headingIndex = lines.findIndex((line) => HANDOFF_HEADING.test(line));
  if (headingIndex < 0) return `${body.replace(/\n*$/, '')}\n\n${handoffSection}`;
  const nextHeadingOffset = lines.slice(headingIndex + 1).findIndex((line) => SECTION_HEADING.test(line));
  const following = nextHeadingOffset < 0 ? [] : lines.slice(headingIndex + 1 + nextHeadingOffset);
  return [...lines.slice(0, headingIndex), ...handoffSection.split('\n'), ...following].join('\n');
}

interface HoldContext {
  change:      TrackerChange;
  context:     JobLaunchContext;
  checksLine:  string | null;
  installLine: string | null;
  logged:      LogRecord[];
}

function openIncidentFor(hold: HoldContext, job: Readonly<Job>, kind: 'setup-failed' | 'out-of-calls' | 'blocked' | 'gate-cannot-run', facts: Record<string, string>): void {
  const defaultMoves = {
    'setup-failed': 'worktree-repair', 'out-of-calls': 'job-fresh', 'blocked': 'ticket-park', 'gate-cannot-run': 'gate-retry'
  } as const;
  hold.logged.push(...hold.change.board.openIncident({
    kind, ticketIds: job.ticketIds, jobId: job.id, facts, defaultMove: defaultMoves[kind]
  }, hold.change.at).logged);
}

function endJob(hold: HoldContext, job: Readonly<Job>, ending: Parameters<Board['endJob']>[1]): void {
  hold.logged.push(...hold.change.board.endJob(job.id, ending, hold.change.at).logged);
}

function verifyAndRoute(hold: HoldContext, job: Readonly<Job>, observation: BuildJobObservation): void {
  const { board, at } = hold.change;
  const ticket = board.tickets().find((candidate) => candidate.frontmatter.id === ticketIdOf(job));
  const start = readJobStart(jobFolderOf(hold.context.workspace, job));
  if (ticket === undefined || start === null) {
    endJob(hold, job, { outcome: 'failed', cause: 'git-failed' });
    return;
  }
  const checksDefinitionFiles = board.checksDefinitionFiles();
  const subject: JobVerificationSubject = {
    role:             job.kind === REVIEW_JOB_KIND ? 'reviewer' : 'builder',
    worktreePath:     worktreeOf(hold.context.workspace, job),
    startCommit:      start.startCommit,
    bodyHashAtLaunch: start.bodyHashAtLaunch,
    report:           observation.report,
    ticketBody:       ticket.body,
    jobId:            job.id,
    logRecords:       board.logRecordsSoFar(),
    launchSnapshot:   start.launchSnapshot,
    refMovesAllowed:  refMovesAllowedFor(board, job),
    ...(checksDefinitionFiles === undefined ? {} : { checksDefinitionFiles }),
  };
  const reportVerdict = VERIFICATION_CHECKS.V1(subject);
  if (reportVerdict.verdict === 'refused') {
    endJob(hold, job, { outcome: 'failed', cause: reportVerdict.reason === 'report-invalid' ? BUILD_JOB_CAUSES.noReport : reportVerdict.reason });
    return;
  }
  const outcome = reportFieldOf(observation.report, 'outcome');
  if (outcome === 'blocked') {
    openIncidentFor(hold, job, 'blocked', { reason: String(reportFieldOf(observation.report, 'blockedReason') ?? '') });
    endJob(hold, job, { outcome: 'blocked' });
    return;
  }
  if (outcome === 'wound-down') {
    openIncidentFor(hold, job, 'out-of-calls', { calls: String(observation.calls) });
    endJob(hold, job, { outcome: 'wound-down' });
    return;
  }
  if (outcome === 'cannot-build') {
    endJob(hold, job, { outcome: 'failed', cause: BUILD_JOB_CAUSES.cannotBuild });
    return;
  }
  const verdict = verifyJob(subject);
  if (verdict.verdict === 'refused') {
    if (verdict.check === 'V13') openAgentConfigDecision(hold, job);
    endJob(hold, job, { outcome: 'failed', cause: verdict.check === 'V7' ? BUILD_JOB_CAUSES.attribution : verdict.reason });
    return;
  }
  hold.logged.push(...board.moveJob(job.id, 'gating', at).logged);
}

/** The other jobs' branches, which their own sessions move, and every landing the runner recorded: on its job's target, at its commit. */
function refMovesAllowedFor(board: Board, job: Readonly<Job>): RefMovesAllowed {
  const targetByJobId = new Map<string, string | null>();
  const recordedLandings: { ref: string; commit: string }[] = [];
  for (const record of board.logRecordsSoFar()) {
    if (record.kind === 'job-launched') targetByJobId.set(record.jobId, record.fields.target);
    if (record.kind !== 'job-ended' || !LANDING_OUTCOMES.includes(record.fields.outcome) || record.fields.commit === undefined) continue;
    const target = targetByJobId.get(record.jobId);
    if (target !== undefined && target !== null) recordedLandings.push({ ref: `refs/heads/${target}`, commit: record.fields.commit });
  }
  return {
    ownBranch:        branchOf(job),
    otherJobBranches: board.jobs().filter((other) => other.id !== job.id && isWorktreeJob(other)).map(branchOf),
    recordedLandings,
  };
}

/** Once per hit: none while one is open, and none again for a hit User already answered, until another job on the ticket ends. */
function openAgentConfigDecision(hold: HoldContext, job: Readonly<Job>): void {
  const { board, at } = hold.change;
  const ticketId = ticketIdOf(job);
  if (agentConfigHitIsSettled(board, ticketId)) return;
  const draft: DecisionDraft = { kind: AGENT_CONFIG_DECISION, ticketIds: [ticketId], jobId: job.id };
  hold.logged.push(...board.openDecision({
    ...draft, askedBy: 'runner', requestId: null, ...hold.context.decisionWordingOf(draft)
  }, at).logged);
}

function agentConfigHitIsSettled(board: Board, ticketId: string): boolean {
  if (board.decisions().some((decision) => decision.kind === AGENT_CONFIG_DECISION && decision.ticketIds.includes(ticketId))) return true;
  const ticketIdsByJobId = new Map<string, readonly string[]>();
  const kindByDecisionId = new Map<string, { kind: string; ticketIds: readonly string[] }>();
  let answeredSinceTheLastJobEnded = false;
  for (const record of board.logRecordsSoFar()) {
    if (record.kind === 'job-launched') ticketIdsByJobId.set(record.jobId, record.fields.ticketIds);
    if (record.kind === 'decision-opened') kindByDecisionId.set(record.decisionId, record.fields);
    if (record.kind === 'job-ended' && (ticketIdsByJobId.get(record.jobId) ?? []).includes(ticketId)) answeredSinceTheLastJobEnded = false;
    const opened = record.kind === 'decision-answered' ? kindByDecisionId.get(record.decisionId) : undefined;
    if (opened?.kind === AGENT_CONFIG_DECISION && opened.ticketIds.includes(ticketId)) answeredSinceTheLastJobEnded = true;
  }
  return answeredSinceTheLastJobEnded;
}

/**
 * V13 before every launch on a branch, resumes included: the tickets of live worktree jobs whose branch past its target, or whose worktree,
 * changes agent configuration, and those with the decision still open. Read outside the lock.
 */
function ticketIdsTouchingAgentConfigOf(context: JobLaunchContext, jobs: readonly Readonly<Job>[]): string[] {
  return jobs.filter(isWorktreeJob).filter((job) => {
    const worktree = worktreeOf(context.workspace, job);
    if (!existsSync(worktree)) return false;
    return agentConfigTouchedBeforeLaunch(worktree, job.target ?? context.mainLine).verdict === 'refused';
  }).map(ticketIdOf);
}

/** In the hold: each observed hit opens its decision once, and holds the ticket until User answered it. */
function holdAgentConfigHits(change: TrackerChange, context: JobLaunchContext, touchingTicketIds: readonly string[]): { held: string[]; logged: LogRecord[] } {
  const hold: HoldContext = {
    change, context, checksLine: null, installLine: null, logged: []
  };
  const held = new Set<string>();
  for (const ticketId of touchingTicketIds) {
    const job = change.board.jobs().find((candidate) => candidate.ticketIds.includes(ticketId));
    if (agentConfigHitIsSettled(change.board, ticketId)) continue;
    if (job !== undefined) openAgentConfigDecision(hold, job);
  }
  for (const decision of change.board.decisions()) {
    if (decision.kind === AGENT_CONFIG_DECISION) decision.ticketIds.forEach((ticketId) => held.add(ticketId));
  }
  return { held: [...held].sort(), logged: hold.logged };
}

function settleGate(hold: HoldContext, job: Readonly<Job>, observation: BuildJobObservation): void {
  const { gate } = observation;
  if (gate.verdict !== 'judged' || hold.checksLine === null) return;
  const { board, at } = hold.change;
  hold.logged.push(...board.recordGateRan({ tree: gate.treeId, outcome: gate.outcome, cached: gate.cached }, at).logged);
  if (gate.outcome === 'cannot-run') {
    openIncidentFor(hold, job, 'gate-cannot-run', { tree: gate.treeId });
    endJob(hold, job, { outcome: 'stopped', cause: BUILD_JOB_CAUSES.gateCannotRun });
    return;
  }
  if (gate.outcome === 'failed') {
    endJob(hold, job, { outcome: 'failed', cause: BUILD_JOB_CAUSES.gateFailed });
    return;
  }
  // The runner, never the gate, records the pass, and only once the gate host's `end` is read.
  const pass = {
    treeId: gate.treeId, checksLine: hold.checksLine, installLine: hold.installLine, keyOutput: gate.keyOutput
  };
  if (!gate.cached) hold.context.gateCache.recordPass(gateCacheKeyOf(pass), pass);
  const headCommit = String(reportFieldOf(observation.report, 'headCommit'));
  if (job.kind === REVIEW_JOB_KIND) {
    const start = readJobStart(jobFolderOf(hold.context.workspace, job));
    hold.logged.push(...ReviewOutcome.settleReviewPass({
      board,
      at,
      job,
      report:            observation.report,
      worktreePath:      worktreeOf(hold.context.workspace, job),
      reviewStartCommit: start?.startCommit ?? headCommit,
      jobFolder:         jobFolderOf(hold.context.workspace, job),
      limits:            LIFECYCLE_LIMITS,
      decisionWordingOf: hold.context.decisionWordingOf,
    }).logged);
    return;
  }
  const ticketBody = board.tickets().find((candidate) => candidate.frontmatter.id === ticketIdOf(job))?.body ?? '';
  const body = { text: bodyWithHandoffOf(ticketBody, handoffSectionOf(observation.report)), appends: false };
  hold.logged.push(...board.editTicket(ticketIdOf(job), { body, allowsPastPending: true }, at).logged);
  endJob(hold, job, { outcome: 'built', commit: headCommit });
  hold.logged.push(...board.moveTicket(ticketIdOf(job), 'in-review', { checksLegality: true, branch: branchOf(job), commit: headCommit }, at).logged);
}

/** A job User stopped ends `stopped`; one User freshened ends `replaced`, so the next attempt starts on the same worktree. */
function userStopEndingOf(job: Readonly<Job>): Parameters<Board['endJob']>[1] | null {
  if (job.stopRequest === 'fresh') return { outcome: 'replaced', cause: FRESH_AGENT_CAUSE };
  return job.stopRequest === 'stop' ? { outcome: 'stopped', cause: STOPPED_BY_USER_CAUSE } : null;
}

function applyObservation(hold: HoldContext, observation: BuildJobObservation): void {
  const { board, at } = hold.change;
  const job = board.jobById(observation.jobId);
  if (job === undefined) return;
  switch (job.state) {
    case 'launching': {
      hold.logged.push(...board.moveJob(job.id, 'preparing', at).logged);
      if (job.kind === REVIEW_JOB_KIND) {
        hold.logged.push(...board.startReviewBar(ticketIdOf(job), { round: job.attempt, owner: job.id }, at).logged);
        return;
      }
      const ticket = board.tickets().find((candidate) => candidate.frontmatter.id === ticketIdOf(job));
      if (ticket?.frontmatter.status !== 'pending') return;
      hold.logged.push(...board.moveTicket(ticketIdOf(job), 'in-progress', { checksLegality: true, branch: branchOf(job) }, at).logged);
      return;
    }
    case 'preparing':
      if (observation.setup === 'worktree-failed' || observation.setup === 'install-failed') {
        openIncidentFor(hold, job, 'setup-failed', { step: observation.setup === 'worktree-failed' ? 'worktree' : 'install' });
        endJob(hold, job, { outcome: 'stopped', cause: BUILD_JOB_CAUSES.setupFailed });
      } else if (observation.setup === 'installed') {
        hold.logged.push(...board.moveJob(job.id, 'running', at).logged);
      }
      return;
    case 'running':
      if (observation.calls >= callBudgetOf(job) + WIND_DOWN_GRACE_CALLS) {
        openIncidentFor(hold, job, 'out-of-calls', { calls: String(observation.calls) });
        hold.logged.push(...board.moveJob(job.id, 'stopping', at).logged);
      }
      return;
    case 'stopping':
      if (observation.agentEnd !== null) endJob(hold, job, userStopEndingOf(job) ?? { outcome: 'stopped', cause: BUILD_JOB_CAUSES.outOfCalls });
      return;
    case 'verifying':
      verifyAndRoute(hold, job, observation);
      return;
    case 'gating':
      settleGate(hold, job, observation);
      return;
    default:
  }
}

/** In the hold, after the relayed requests and host events, before the policy: so a ticket finished here gets its review job in this hold. */
function applyBuildJobObservations(change: TrackerChange, context: JobLaunchContext, observations: readonly BuildJobObservation[]): LogRecord[] {
  const hold: HoldContext = {
    change, context, checksLine: change.board.checkCommand() ?? null, installLine: change.board.installCommand() ?? null, logged: []
  };
  for (const observation of observations) applyObservation(hold, observation);
  return hold.logged;
}

/**
 * Whether a build job stands where only another pass moves it: launching, prepared, or its gate judged from the cache. Nothing a later
 * observation reads changes there, so the fingerprint alone would leave it waiting.
 */
function someBuildJobAwaitsAPass(board: Board, observations: readonly BuildJobObservation[]): boolean {
  return observations.some((observation) => {
    const state = board.jobById(observation.jobId)?.state;
    if (state === 'launching') return true;
    if (state === 'preparing') return observation.setup !== 'creating-worktree' && observation.setup !== 'installing';
    return state === 'gating' && observation.gate.verdict === 'judged';
  });
}

/** The tickets whose newest ended job failed `attribution`: each shows the notice until its next job ends. */
function attributionTicketIdsOf(records: readonly LogRecord[]): string[] {
  const ticketIdsByJobId = new Map<string, readonly string[]>();
  const attributed = new Set<string>();
  for (const record of records) {
    if (record.kind === 'job-launched') ticketIdsByJobId.set(record.jobId, record.fields.ticketIds);
    if (record.kind !== 'job-ended') continue;
    for (const ticketId of ticketIdsByJobId.get(record.jobId) ?? []) {
      if (record.fields.cause === BUILD_JOB_CAUSES.attribution) attributed.add(ticketId);
      else attributed.delete(ticketId);
    }
  }
  return [...attributed].sort();
}

function sandboxFactsFor(context: JobLaunchContext, job: Readonly<Job>): SandboxFacts {
  const { workspace } = context;
  return WorkerProfiles.sandboxFactsOf({
    repositoryRoot: workspace.rootDirectory,
    dataFolder:     workspace.trackerDirectory,
    monitorFolder:  context.monitorFolder,
    homeDirectory:  context.homeDirectory,
    worktree:       worktreeOf(workspace, job),
    ownBranch:      branchOf(job),
    mainLine:       context.mainLine,
    groupPrefix:    context.groupTargetPrefix,
    relayDirectory: RelayInbox.relayDirectoryOf(workspace.rootDirectory, job.id),
  });
}

/** What a process host's profile takes from the board: whether its ticket names a network, and the stored cache paths. */
interface HostConfinement {
  network:    boolean;
  cachePaths: readonly string[];
}

const PATH_SEPARATOR = ':';

function spawnProcessHost(context: JobLaunchContext, trackerId: string, job: Readonly<Job>, folderName: string, childArgv: readonly string[], confinement: HostConfinement): void {
  const jobFolder = jobFolderOf(context.workspace, job);
  const hostFolder = join(jobFolder, folderName);
  if (HostFleet.livenessOf(hostFolder, PROCESS_HOST_INSTANCE).verdict !== 'unclaimed') return;
  const worktree = worktreeOf(context.workspace, job);
  const facts = sandboxFactsFor(context, job);
  const adminFolder = GitProcess.run(worktree, ['rev-parse', '--absolute-git-dir']);
  const profilePath = join(hostFolder, JOB_FILES.profile);
  const environment = GateRun.gateEnvironmentOf(launchEnvironmentOf(context.inheritedEnvironment, {}));
  HostFleet.writeProcessLaunchFile({
    hostFolder,
    instance:         PROCESS_HOST_INSTANCE,
    jobId:            job.id,
    socketName:       `${job.id}/${folderName}`,
    trackerId,
    monitorFolder:    context.monitorFolder,
    hostCodeVersion:  context.codeVersion,
    workingDirectory: worktree,
    argv:             context.sandbox.sandboxedArgvOf(profilePath, childArgv),
    environment,
  });
  writeFileSync(profilePath, context.sandbox.profileTextOf({
    worktree,
    worktreeAdminFolder:  GitProcess.succeeded(adminFolder) ? adminFolder.standardOutput.trim() : null,
    homeDirectory:        context.homeDirectory,
    temporaryDirectory:   Object.hasOwn(environment, 'TMPDIR') ? environment['TMPDIR'] ?? null : null,
    cachePaths:           confinement.cachePaths,
    executableSearchPath: (context.inheritedEnvironment['PATH'] ?? '').split(PATH_SEPARATOR).filter((folder) => folder !== ''),
    deniedWritableRoots:  WorkerProfiles.deniedWritableRootsOf(facts),
    deniedReadableRoots:  WorkerProfiles.deniedReadableRootsOf(facts),
    network:              confinement.network,
  }));
  HostFleet.spawnHost({ bundlePath: context.hostBundlePath, jobFolder: hostFolder, instance: PROCESS_HOST_INSTANCE });
  context.log(`Spawned the ${folderName} host of job ${job.id} (#${ticketIdOf(job)})${context.sandbox.isUsable() ? ' under sandbox-exec' : ', unsandboxed'}.`);
}

/** A group ticket's branch forks off the group's tip, so the group's worktree is created from the main line's tip at its first launch. */
function createWorktree(context: JobLaunchContext, job: Readonly<Job>): void {
  const { rootDirectory } = context.workspace;
  const worktree = worktreeOf(context.workspace, job);
  const target = job.target ?? context.mainLine;
  const group = target.startsWith(context.groupTargetPrefix)
    ? GroupWorktrees.prepareGroupWorktree(rootDirectory, join(rootDirectory, PRODUCT_NAMES.WORKTREES_FOLDER), target, context.mainLine)
    : null;
  const branchExists = GitProcess.resolvedCommitOf(rootDirectory, `refs/heads/${branchOf(job)}`) !== null;
  const run = group?.verdict === 'git-failed' ? null : GitProcess.run(rootDirectory, branchExists
    ? ['worktree', 'add', worktree, branchOf(job)]
    : ['worktree', 'add', '-b', branchOf(job), worktree, target]);
  if (GitProcess.succeeded(run)) return;
  const errorText = group?.verdict === 'git-failed' ? group.reason : run?.standardError.trim() ?? 'git did not run';
  mkdirSync(jobFolderOf(context.workspace, job), { recursive: true });
  writeFileSync(join(jobFolderOf(context.workspace, job), JOB_FILES.worktreeFailure), `${errorText}\n`);
  context.log(`Creating the worktree of job ${job.id} failed: ${errorText}`);
}

/** What a build job's frames are worded and filed with. */
export interface BuildJobFrameRequest {
  trackerDirectory: string;
  agentAdapter:     Pick<AgentAdapter, 'chatLineOf'>;
  windDownMessage:  string;
}

async function sendOnce(request: BuildJobFrameRequest, job: Readonly<Job>, marker: string, frames: Parameters<typeof HostFleet.sendFrames>[2]): Promise<void> {
  const jobFolder = HostFleet.jobFolderOf(request.trackerDirectory, job.id);
  await HostFleet.sendFramesOnce(join(jobFolder, marker), jobFolder, job.hostInstance, frames);
}

/** What a build job's state asks of its live Watcher, each frame once: the wind-down turn over its call budget, closed input, a stop. */
async function deliverBuildJobFrames(request: BuildJobFrameRequest, job: Readonly<Job>, calls: number): Promise<void> {
  if (job.state === 'running' && calls >= callBudgetOf(job)) {
    await sendOnce(request, job, JOB_FILES.windDownSent, [{ kind: 'write', line: request.agentAdapter.chatLineOf(request.windDownMessage) }]);
  }
  if (job.state === 'verifying' || job.state === 'gating') await sendOnce(request, job, JOB_FILES.inputClosed, [{ kind: 'close-input' }]);
  if (job.state === 'stopping') await sendOnce(request, job, JOB_FILES.stopSent, [{ kind: 'stop', graceMilliseconds: SESSION_STOP_GRACE_MILLISECONDS }]);
}

/** After the hold and the lease check: what each build job's new state asks of git and the hosts. */
async function runBuildJobEffects(context: JobLaunchContext, board: Board, trackerId: string, observations: readonly BuildJobObservation[]): Promise<void> {
  const checksLine = board.checkCommand() ?? null;
  const installLine = board.installCommand() ?? null;
  const keyCommand = board.gateKeyCommand() ?? null;
  const cachePaths = board.gateCachePaths() ?? [];
  for (const job of board.jobs().filter(isWorktreeJob)) {
    const ticket = board.tickets().find((candidate) => candidate.frontmatter.id === ticketIdOf(job));
    const gateConfinement = { network: (ticket?.frontmatter.network ?? []).length > 0, cachePaths };
    if (job.state === 'preparing') {
      const jobFolder = jobFolderOf(context.workspace, job);
      if (!existsSync(worktreeOf(context.workspace, job)) && !existsSync(join(jobFolder, JOB_FILES.worktreeFailure))) createWorktree(context, job);
      if (existsSync(worktreeOf(context.workspace, job)) && installLine !== null) {
        spawnProcessHost(context, trackerId, job, INSTALL_HOST_FOLDER, GateRun.checksLineArgvOf(installLine), { network: true, cachePaths });
      }
    }
    const calls = observations.find((observation) => observation.jobId === job.id)?.calls ?? 0;
    await deliverBuildJobFrames({ trackerDirectory: context.workspace.trackerDirectory, agentAdapter: context.agentAdapter, windDownMessage: context.windDownMessage }, job, calls);
    if (job.state === 'gating' && checksLine !== null) {
      // The key command runs in a host of its own under the gate's profile, never in the runner, and the gate waits for its output.
      if (keyCommand !== null) spawnProcessHost(context, trackerId, job, GATE_KEY_HOST_FOLDER, GateRun.keyCommandArgvOf(keyCommand), gateConfinement);
      const keyReading = gateKeyReadingOf(context, job, keyCommand);
      if (keyReading.verdict !== 'read') continue;
      const treeId = treeOf(worktreeOf(context.workspace, job));
      const cached = treeId !== null && context.gateCache.holdsPassOf(gateCacheKeyOf({
        treeId, checksLine, installLine, keyOutput: keyReading.keyOutput
      }));
      if (!cached) spawnProcessHost(context, trackerId, job, GATE_HOST_FOLDER, GateRun.checksLineArgvOf(checksLine), gateConfinement);
    }
  }
}

/**
 * Written as the session's host is first spawned: the commit verification measures from, the body hash V6 compares with, and the refs,
 * worktree HEADs and hooks folder V13 and V14 compare with.
 */
function recordJobStart(context: JobLaunchContext, board: Board, job: Readonly<Job>): void {
  const startPath = join(jobFolderOf(context.workspace, job), JOB_FILES.start);
  if (existsSync(startPath)) return;
  const ticket = board.tickets().find((candidate) => candidate.frontmatter.id === ticketIdOf(job));
  const worktree = worktreeOf(context.workspace, job);
  const startCommit = GitProcess.resolvedCommitOf(worktree, 'HEAD');
  const launchSnapshot = launchSnapshotOf(worktree);
  if (ticket === undefined || startCommit === null || launchSnapshot === null) return;
  const start: JobStart = { startCommit, bodyHashAtLaunch: TicketBodyHashUtil.bodyHashOf(ticket.body), launchSnapshot };
  mkdirSync(dirname(startPath), { recursive: true });
  writeFileSync(startPath, `${JSON.stringify(start, null, 2)}\n`);
}

export const JobLaunch = Object.freeze({
  observeBuildJobs,
  applyBuildJobObservations,
  runBuildJobEffects,
  deliverBuildJobFrames,
  recordJobStart,
  attributionTicketIdsOf,
  someBuildJobAwaitsAPass,
  sandboxFactsFor,
  worktreeOf,
  isWorktreeJob,
  ticketIdsTouchingAgentConfigOf,
  holdAgentConfigHits,
  sessionReadingOf,
});
