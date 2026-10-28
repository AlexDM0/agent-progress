/**
 * The runner's one serial pass, design section 2.5: wake-ups coalesce into one queue, and each pass observes outside the lock (host
 * liveness, events past each job's stored cursor, then relay folders, target tips and ended hosts), applies relayed commands, then host
 * events with their cursors, then the lifecycle policy in one `writeTracker` hold, and runs its effects after the lease check.
 */
import { createHash }                          from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join }                                from 'node:path';

import { BUILDER_REPORT_SCHEMA, REVIEWER_REPORT_SCHEMA }            from '../../adapters/reports/ReportSchemas.ts';
import type { JsonSchema }                                          from '../../adapters/reports/ReportValidation.ts';
import { type UsageMarkerReading, UsageMarkerFile }                 from '../../adapters/usage-marker/UsageMarkerFile.ts';
import type { EventLogEntry }                                       from '../../lib/agent-host/EventLog.ts';
import type { AgentAdapter }                                        from '../../lib/agent-launch/AgentAdapter.ts';
import type { AgentLaunchRequest }                                  from '../../lib/agent-launch/AgentLaunchRequest.ts';
import { launchEnvironmentOf }                                      from '../../lib/agent-launch/LaunchEnvironment.ts';
import type { WorkerProfile }                                       from '../../lib/agent-launch/WorkerProfile.ts';
import { GitProcess }                                               from '../../lib/git/GitProcess.ts';
import type { Job, JobKind }                                        from '../../lib/tracker-model/@types/Job.ts';
import type { DecisionDraft, DecisionWording }                      from '../../lib/tracker-model/@types/LifecycleStep.ts';
import type { Board }                                               from '../../lib/tracker-model/Board.ts';
import { JOB_ID_VARIABLE, RELAY_DIRECTORY_VARIABLE }                from '../../shared/Environment.ts';
import { LIFECYCLE_LIMITS }                                         from '../../shared/constants/LifecycleLimits.ts';
import { PRODUCT_NAMES }                                            from '../../shared/constants/ProductNames.ts';
import { SESSION_STOP_GRACE_MILLISECONDS }                          from '../../shared/constants/RunnerLimits.ts';
import { createFolderGateResultCache, createMemoryGateResultCache } from '../lifecycle/GateResultCache.ts';
import { ReviewOutcome }                                            from '../lifecycle/ReviewOutcome.ts';
import type { RenderState }                                         from '../render/RenderState.ts';
import { writeTracker, type TrackerChange }                         from '../tracker/TrackerPipeline.ts';
import { requireProgressFile }                                      from '../tracker/TrackerReader.ts';
import type { Workspace }                                           from '../tracker/Workspace.ts';
import { HostFleet, type HostLiveness }                             from './HostFleet.ts';
import {
  BUILD_JOB_CAUSES,
  type BuildJobObservation,
  JobLaunch,
  type JobLaunchContext
} from './JobLaunch.ts';
import { createProcessHostSandbox }             from './ProcessHostSandbox.ts';
import { RelayInbox, type PendingRelayRequest } from './RelayInbox.ts';
import { RunnerLease }                          from './RunnerLease.ts';
import { type UsageLimitHit, UsageLimits }      from './UsageLimits.ts';
import { WorkerProfiles }                       from './WorkerProfiles.ts';

/** What a session is told at launch; worded by the command line, since services hold no words. */
export interface JobLaunchText {
  firstMessage: string;
  roleBrief:    string;
}

/** What the launch text is filled from: the job's tickets as stored, and the checks line its work is gated by. */
export interface JobLaunchFacts {
  tickets:    readonly { id: string; title: string; body: string }[];
  checksLine: string | null;
}

export interface DrivePassRequest {
  workspace:             Workspace;
  renderState:           RenderState;
  now:                   () => Date;
  formatStamp:           (moment: Date) => string;
  runnerDirectory:       string;
  generation:            number;
  hostBundlePath:        string;
  codeVersion:           string;
  agentAdapter:          AgentAdapter;
  /** The folder the host sockets go under: `<home>/<monitor folder>`. */
  monitorFolder:         string;
  /** Narrowed to the launch allowlist before any session sees it. */
  inheritedEnvironment:  Readonly<Record<string, string | undefined>>;
  mainLine:              string;
  /** The start marker of the managed block a committed CLAUDE.md must no longer hold before launches onto its target. */
  managedBlockMarker:    string;
  installVersionChanged: () => boolean;
  decisionWordingOf:     (draft: DecisionDraft) => DecisionWording;
  launchTextOf:          (job: Readonly<Job>, facts: JobLaunchFacts) => JobLaunchText;
  /** Sent to a session that reached its role's call budget. */
  windDownMessage:       string;
  homeDirectory:         string;
  log:                   (line: string) => void;
  /** The pass stops acting at once; the caller ends the runner `lease-taken-over`. */
  onLeaseTakenOver:      (refusal: unknown) => void;
  /** Called inside the hold after each of its three phases, on the Board being changed; the step a spec reads the order at. */
  afterHoldPhase?:       (phase: 'relayed-commands' | 'host-events' | 'lifecycle', board: Board) => void;
}

/** Derived each pass from the board, git and the runner's state, never stored; later tickets add the other kinds of design section 8.2. */
export type RunnerNotice =
  | { kind: 'install-version-changed' }
  | { kind: 'claude-md-block-committed'; target: string }
  | { kind: 'attribution-found'; ticketId: string }
  // The ticket's newest review reworked past the threshold and was refused another round: User decides whether an invariant ticket is wanted.
  | { kind: 'rounds-not-converging'; ticketId: string };

export interface RunnerStateDocument {
  generation: number;
  passes:     number;
  notices:    RunnerNotice[];
}

export interface DrivePass {
  /** Coalesced: wakes during a pass add exactly one more pass. `forced` runs it even when nothing observed changed. */
  wake:  (forced?: boolean) => void;
  /** Resolves once no pass is running or queued. */
  idle:  () => Promise<void>;
  state: () => RunnerStateDocument;
}

interface HostObservation {
  jobId:    string;
  instance: number;
  liveness: HostLiveness;
  events:   readonly EventLogEntry[];
}

interface Observation {
  hosts:                        readonly HostObservation[];
  pendingRequests:              readonly PendingRelayRequest[];
  targetTips:                   Readonly<Record<string, string | null>>;
  targetsHoldingManagedBlock:   readonly string[];
  buildJobs:                    readonly BuildJobObservation[];
  ticketIdsTouchingAgentConfig: readonly string[];
  usageMarker:                  UsageMarkerReading;
  fingerprint:                  string;
  trackerId:                    string;
}

const GROUP_TARGET_PREFIX = 'group-';
const DEFAULT_MODEL = 'opus';
const DEFAULT_EFFORT = 'medium';
const ROLES_THAT_MAY_ASK: ReadonlySet<string> = new Set(['builder', 'reviewer', 'product-owner']);

/** The jobs whose session owes a closing report: one that exits cleanly without it ends `failed`, cause `no-report`. */
const REPORTING_JOB_KINDS: readonly JobKind[] = ['build', 'review'];

const REPORT_SCHEMA_OF_JOB_KIND: Partial<Record<JobKind, JsonSchema>> = { build: BUILDER_REPORT_SCHEMA, review: REVIEWER_REPORT_SCHEMA };

function fileTextOrEmpty(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function targetTipOf(repositoryRoot: string, target: string): string | null {
  return GitProcess.resolvedCommitOf(repositoryRoot, target);
}

function targetHoldsManagedBlock(repositoryRoot: string, target: string, marker: string): boolean {
  const shown = GitProcess.run(repositoryRoot, ['show', `${target}:CLAUDE.md`]);
  return GitProcess.succeeded(shown) && shown.standardOutput.includes(marker);
}

/** Identity, never time: the stored board and log, the pending requests, the unread events, the target tips and each host's verdict. */
function fingerprintOf(
  workspace: Workspace,
  hosts: readonly HostObservation[],
  pending: readonly PendingRelayRequest[],
  tips: Readonly<Record<string, string | null>>,
  buildJobs: readonly BuildJobObservation[],
  usageMarker: UsageMarkerReading,
  ticketIdsTouchingAgentConfig: readonly string[],
): string {
  const digest = createHash('sha256');
  digest.update(`agent-config ${ticketIdsTouchingAgentConfig.join(',')}\n`);
  digest.update(fileTextOrEmpty(workspace.progressFilePath)).update('\0').update(fileTextOrEmpty(workspace.logFilePath)).update('\0');
  digest.update(`usage ${JSON.stringify(usageMarker)}\n`);
  for (const request of pending) digest.update(`request ${request.jobId} ${request.requestId}\n`);
  for (const buildJob of buildJobs) digest.update(`build ${buildJob.jobId} ${buildJob.setup} ${buildJob.calls} ${buildJob.gate.verdict}\n`);
  for (const host of hosts) digest.update(`host ${host.jobId} ${host.instance} ${host.liveness.verdict} ${host.events.at(-1)?.sequence ?? 0}\n`);
  for (const [target, tip] of Object.entries(tips)) digest.update(`tip ${target} ${tip ?? '-'}\n`);
  return digest.digest('hex');
}

function observe(request: DrivePassRequest, jobLaunchContext: JobLaunchContext): Observation {
  const { workspace } = request;
  const progress      = requireProgressFile(workspace);
  const jobs          = progress.jobs ?? [];
  // Events before relay folders: a request a session wrote before its turn's `result` is seen in the same pass as that result.
  const hosts = jobs.map((job): HostObservation => {
    const jobFolder     = HostFleet.jobFolderOf(workspace.trackerDirectory, job.id);
    const afterSequence = job.eventCursor.instance === job.hostInstance ? job.eventCursor.sequence : 0;
    const liveness      = HostFleet.livenessOf(jobFolder, job.hostInstance);
    const events        = HostFleet.eventsAfter(jobFolder, job.hostInstance, afterSequence);
    if (events === 'malformed') request.log(`The event log of job ${job.id}, host instance ${job.hostInstance}, is malformed; its events wait.`);
    return {
      jobId: job.id, instance: job.hostInstance, liveness, events: events === 'malformed' ? [] : events
    };
  });
  const pendingRequests = RelayInbox.pendingRequestsOf(workspace.rootDirectory, jobs);
  const targets         = [...new Set([request.mainLine, ...jobs.flatMap((job) => (job.target === null ? [] : [job.target]))])].sort();
  const targetTips      = Object.fromEntries(targets.map((target) => [target, targetTipOf(workspace.rootDirectory, target)]));
  const targetsHoldingManagedBlock = targets.filter((target) => targetHoldsManagedBlock(workspace.rootDirectory, target, request.managedBlockMarker));
  const buildJobs = JobLaunch.observeBuildJobs(jobLaunchContext, jobs, progress.checkCommand ?? null, progress.installCommand ?? null);
  const ticketIdsTouchingAgentConfig = JobLaunch.ticketIdsTouchingAgentConfigOf(jobLaunchContext, jobs);
  const usageMarker = UsageMarkerFile.read(request.monitorFolder);
  if (usageMarker.verdict === 'malformed') {
    request.log(`The usage marker ${UsageMarkerFile.pathIn(request.monitorFolder)} is malformed (${usageMarker.reason}); no limit is held by it.`);
  }
  return {
    hosts,
    pendingRequests,
    targetTips,
    targetsHoldingManagedBlock,
    buildJobs,
    ticketIdsTouchingAgentConfig,
    usageMarker,
    fingerprint: fingerprintOf(workspace, hosts, pendingRequests, targetTips, buildJobs, usageMarker, ticketIdsTouchingAgentConfig),
    trackerId:   progress.trackerId,
  };
}

/**
 * A question opens its decision and a closing result moves the job to verification in the hold that reads them; the cursor moves with them.
 * A top-level usage refusal interrupts the job instead, and the error result after it is no closing result. Returns the usage limits hit.
 */
function applyHostEvents(change: TrackerChange, adapter: AgentAdapter, hosts: readonly HostObservation[]): UsageLimitHit[] {
  const { board, at } = change;
  const usageLimitHits: UsageLimitHit[] = [];
  for (const host of hosts) {
    if (board.jobById(host.jobId)?.hostInstance !== host.instance) continue;
    let closedWithResult = false;
    for (const entry of host.events) {
      if (entry.origin !== 'agent') continue;
      for (const event of adapter.eventsOf(entry.line)) {
        const state = board.jobById(host.jobId)?.state;
        const refusal = UsageLimits.refusalOf(event);
        if (refusal !== null && state === 'running') {
          const hit = { jobId: host.jobId, ...refusal };
          UsageLimits.interruptLimitedJob(board, hit, at);
          usageLimitHits.push(hit);
        }
        if (event.kind === 'started' && (state === 'launching' || state === 'preparing')) board.moveJob(host.jobId, 'running', at);
        if (event.kind === 'question' && state === 'running') openQuestion(board, host.jobId, event.requestId, event.questions, at);
        if (event.kind === 'result' && state === 'running') {
          board.moveJob(host.jobId, 'verifying', at);
          closedWithResult = true;
        }
      }
    }
    const lastEvent = host.events.at(-1);
    if (lastEvent !== undefined) board.setJobEventCursor(host.jobId, { instance: host.instance, sequence: lastEvent.sequence });
    const job = board.jobById(host.jobId);
    const state = job?.state;
    const hostIsGone = host.liveness.verdict === 'ended' || host.liveness.verdict === 'lost';
    const sessionEndedCleanly = host.liveness.verdict === 'ended' && host.liveness.end.reason === 'exited' && host.liveness.end.exitCode === 0;
    if (sessionEndedCleanly && !closedWithResult && state === 'running' && job !== undefined && REPORTING_JOB_KINDS.includes(job.kind)) {
      board.endJob(host.jobId, { outcome: 'failed', cause: BUILD_JOB_CAUSES.noReport }, at);
    } else if (hostIsGone && !closedWithResult && (state === 'running' || state === 'waiting-for-answer')) {
      board.interruptJob(host.jobId, host.liveness.verdict === 'lost' ? 'host-lost' : 'agent-crashed', at);
    }
  }
  return usageLimitHits;
}

function openQuestion(board: Board, jobId: string, requestId: string, questions: readonly DecisionQuestionShape[], at: string): void {
  const job = board.jobById(jobId);
  if (job === undefined || job.answeredRequestIds.includes(requestId) || board.decisions().some((decision) => decision.requestId === requestId)) return;
  board.openDecision({
    kind:      'agent-question',
    ticketIds: job.ticketIds,
    jobId,
    askedBy:   job.role ?? 'runner',
    requestId,
    questions: questions.map((question) => ({ ...question, options: question.options.map((option) => ({ ...option })) })),
    context:   '',
  }, at);
  board.moveJob(jobId, 'waiting-for-answer', at);
}

type DecisionQuestionShape = Parameters<AgentAdapter['answerLineOf']>[1][number];

function workingDirectoryOf(workspace: Workspace, job: Readonly<Job>): string {
  const worktreesRoot = join(workspace.rootDirectory, PRODUCT_NAMES.WORKTREES_FOLDER);
  const [ticketId] = job.ticketIds;
  const ticketWorktree = ticketId === undefined ? null : join(worktreesRoot, `ticket-${ticketId}`);
  if (ticketWorktree !== null && existsSync(ticketWorktree)) return ticketWorktree;
  // Preparing a ticket's worktree is a later step of the chain; until it exists the session works in a folder of its own.
  const sessionFolder = join(worktreesRoot, 'sessions', job.id);
  mkdirSync(sessionFolder, { recursive: true });
  return sessionFolder;
}

function profileOf(workspace: Workspace, job: Readonly<Job>, workingDirectory: string, relayDirectory: string): WorkerProfile {
  return {
    writableRoots:          [workingDirectory],
    deniedWritableRoots:    [workspace.trackerDirectory],
    deniedReadableRoots:    [join(workspace.trackerDirectory, 'runner')],
    bashNetworkDomains:     [],
    webNetworkDomains:      'none',
    relayDirectory,
    allowedCommandPrefixes: [],
    deniedCommandPrefixes:  [],
    askUser:                job.role !== null && ROLES_THAT_MAY_ASK.has(job.role),
    skills:                 false,
    subagents:              [],
    attribution:            'none',
    instructionsRoot:       workspace.rootDirectory,
    gitHooksDirectory:      join(workspace.rootDirectory, '.githooks'),
    commitSigning:          { kind: 'unsigned' },
  };
}

/** A builder runs confined by the per-job profile of design section 4.4; the other roles get theirs with the later tickets that run them. */
function launchProfileOf(jobLaunchContext: JobLaunchContext, board: Board, job: Readonly<Job>, workingDirectory: string, relayDirectory: string): WorkerProfile {
  if (!JobLaunch.isWorktreeJob(job)) return profileOf(jobLaunchContext.workspace, job, workingDirectory, relayDirectory);
  const ticket = board.tickets().find((candidate) => candidate.frontmatter.id === job.ticketIds[0]);
  const role = job.kind === 'review' ? 'reviewer' : 'builder';
  return WorkerProfiles.profileOf(role, JobLaunch.sandboxFactsFor(jobLaunchContext, job), ticket?.frontmatter.network ?? []);
}

function launchFactsOf(board: Board, job: Readonly<Job>): JobLaunchFacts {
  return {
    tickets: board.tickets()
      .filter((ticket) => job.ticketIds.includes(ticket.frontmatter.id))
      .map((ticket) => ({ id: ticket.frontmatter.id, title: ticket.frontmatter.title, body: ticket.body })),
    checksLine: board.checkCommand() ?? null,
  };
}

function launchHost(request: DrivePassRequest, jobLaunchContext: JobLaunchContext, board: Board, trackerId: string, job: Readonly<Job>): void {
  const { workspace, agentAdapter } = request;
  const jobFolder        = HostFleet.jobFolderOf(workspace.trackerDirectory, job.id);
  const relayDirectory   = RelayInbox.relayDirectoryOf(workspace.rootDirectory, job.id);
  mkdirSync(join(relayDirectory, 'requests'), { recursive: true });
  const workingDirectory = workingDirectoryOf(workspace, job);
  const text             = request.launchTextOf(job, launchFactsOf(board, job));
  if (JobLaunch.isWorktreeJob(job)) JobLaunch.recordJobStart(jobLaunchContext, board, job);
  const launchRequest: AgentLaunchRequest = {
    sessionId:         agentAdapter.sessionIdOf(trackerId, job.id),
    resume:            job.state === 'running' && job.hostInstance > 1,
    workingDirectory,
    firstMessage:      text.firstMessage,
    roleBrief:         text.roleBrief,
    model:             DEFAULT_MODEL,
    effort:            DEFAULT_EFFORT,
    environment:       launchEnvironmentOf(request.inheritedEnvironment, { [JOB_ID_VARIABLE]: job.id, [RELAY_DIRECTORY_VARIABLE]: relayDirectory }),
    profile:           launchProfileOf(jobLaunchContext, board, job, workingDirectory, relayDirectory),
    jobFilesDirectory: jobFolder,
    reportSchema:      REPORT_SCHEMA_OF_JOB_KIND[job.kind] ?? null,
  };
  HostFleet.writeLaunchFiles({
    jobFolder,
    instance:        job.hostInstance,
    jobId:           job.id,
    trackerId,
    monitorFolder:   request.monitorFolder,
    hostCodeVersion: request.codeVersion,
    workingDirectory,
    plan:            agentAdapter.planOf(launchRequest),
  });
  HostFleet.spawnHost({ bundlePath: request.hostBundlePath, jobFolder, instance: job.hostInstance });
  request.log(`Spawned host instance ${job.hostInstance} of job ${job.id} (${job.kind}${job.ticketIds.length === 0 ? '' : ` #${job.ticketIds.join(', #')}`}).`);
}

/**
 * A job launching, or resumed into `running`, whose current instance nobody claimed yet; spawning twice is harmless, since the claim is
 * exclusive. A build job launches its session only once its worktree is prepared, as it moves into `running`.
 */
function jobsNeedingAHost(board: Board, trackerDirectory: string, spawnedInstances: ReadonlySet<string>, heldTicketIds: readonly string[]): readonly Readonly<Job>[] {
  return board.jobs().filter((job) => ((job.state === 'launching' && !JobLaunch.isWorktreeJob(job)) || job.state === 'running')
    && job.role !== null
    && !job.ticketIds.some((ticketId) => heldTicketIds.includes(ticketId))
    && !spawnedInstances.has(`${job.id}:${job.hostInstance}`)
    && HostFleet.livenessOf(HostFleet.jobFolderOf(trackerDirectory, job.id), job.hostInstance).verdict === 'unclaimed');
}

function noticesOf(request: DrivePassRequest, observation: Observation, attributionTicketIds: readonly string[], nonConvergingTicketIds: readonly string[]): RunnerNotice[] {
  return [
    ...(request.installVersionChanged() ? [{ kind: 'install-version-changed' } as const] : []),
    ...observation.targetsHoldingManagedBlock.map((target) => ({ kind: 'claude-md-block-committed', target }) as const),
    ...attributionTicketIds.map((ticketId) => ({ kind: 'attribution-found', ticketId }) as const),
    ...nonConvergingTicketIds.map((ticketId) => ({ kind: 'rounds-not-converging', ticketId }) as const),
  ];
}

export function createDrivePass(request: DrivePassRequest): DrivePass {
  const spawnedInstances = new Set<string>();
  let lastFingerprint: string | null = null;
  let running: Promise<void> | null = null;
  let wokenAgain = false;
  let forcedNext = false;
  let state: RunnerStateDocument = { generation: request.generation, passes: 0, notices: [] };
  let stopped = false;
  let resetTimer: ReturnType<typeof setTimeout> | null = null;
  const sandbox = createProcessHostSandbox();
  const jobLaunchContext: JobLaunchContext = {
    workspace:            request.workspace,
    agentAdapter:         request.agentAdapter,
    monitorFolder:        request.monitorFolder,
    homeDirectory:        request.homeDirectory,
    inheritedEnvironment: request.inheritedEnvironment,
    mainLine:             request.mainLine,
    groupTargetPrefix:    GROUP_TARGET_PREFIX,
    hostBundlePath:       request.hostBundlePath,
    codeVersion:          request.codeVersion,
    sandbox,
    // Trusted on disk only while no gate can write the data folder; unsandboxed gates keep their passes in memory, lost on a restart.
    gateCache:            sandbox.isUsable() ? createFolderGateResultCache(join(request.workspace.trackerDirectory, 'gates')) : createMemoryGateResultCache(),
    windDownMessage:      request.windDownMessage,
    decisionWordingOf:    request.decisionWordingOf,
    log:                  request.log,
  };

  /** The marker first, so another board's runner holds its launches before this one's limited sessions are even stopped. */
  async function stopLimitedJobs(board: Board, trackerId: string, hits: readonly UsageLimitHit[]): Promise<void> {
    UsageLimits.markHits(request.monitorFolder, request.agentAdapter.vendor, trackerId, hits);
    for (const hit of hits) {
      const job = board.jobById(hit.jobId);
      if (job === undefined) continue;
      await HostFleet.sendFrames(HostFleet.jobFolderOf(request.workspace.trackerDirectory, job.id), job.hostInstance, [
        { kind: 'stop', graceMilliseconds: SESSION_STOP_GRACE_MILLISECONDS },
      ]);
    }
  }

  /** A clock exception (design section 7.6): the vendor names its reset as a time, so the pass that resumes the limited jobs waits for it. */
  function scheduleThePassAtTheReset(usageResetsAt: string | null): void {
    if (resetTimer !== null) clearTimeout(resetTimer);
    resetTimer = null;
    const delay = UsageLimits.millisecondsUntilReset(usageResetsAt, request.now());
    if (delay === null) return;
    resetTimer = setTimeout(() => {
      resetTimer = null;
      wake(true);
    }, delay);
    resetTimer.unref();
  }

  async function runOnePass(forced: boolean): Promise<void> {
    const observation = observe(request, jobLaunchContext);
    if (!forced && observation.fingerprint === lastFingerprint) return;
    const at = request.formatStamp(request.now());
    const installVersionChanged = request.installVersionChanged();
    const written = await writeTracker({
      workspace:   request.workspace,
      at,
      now:         request.now,
      renderState: request.renderState,
      mutate:      (change) => {
        const replies = RelayInbox.applyPendingRequests(change, request.workspace.rootDirectory, observation.pendingRequests);
        request.afterHoldPhase?.('relayed-commands', change.board);
        const usageLimitHits = applyHostEvents(change, request.agentAdapter, observation.hosts);
        request.afterHoldPhase?.('host-events', change.board);
        const buildJobRecords = JobLaunch.applyBuildJobObservations(change, jobLaunchContext, observation.buildJobs);
        const usageResetsAt = UsageLimits.usageResetsAtOf(observation.usageMarker, usageLimitHits);
        const agentConfigHold = JobLaunch.holdAgentConfigHits(change, jobLaunchContext, observation.ticketIdsTouchingAgentConfig);
        const observations = {
          mainLine:                     request.mainLine,
          groupTargetPrefix:            GROUP_TARGET_PREFIX,
          installVersionChanged,
          targetsHoldingManagedBlock:   observation.targetsHoldingManagedBlock,
          ticketIdsTouchingAgentConfig: agentConfigHold.held,
          closedDeliveryTurns:          [],
        };
        change.board.advanceLifecycle({ ...LIFECYCLE_LIMITS, now: at, usageResetsAt }, observations, request.decisionWordingOf);
        request.afterHoldPhase?.('lifecycle', change.board);
        return {
          replies,
          usageLimitHits,
          usageResetsAt,
          attributionTicketIds:     JobLaunch.attributionTicketIdsOf([...change.storedLogRecords, ...buildJobRecords]),
          agentConfigHeldTicketIds: agentConfigHold.held,
          nonConvergingTicketIds:   ReviewOutcome.nonConvergingTicketIdsOf(change.board.logRecordsSoFar(), LIFECYCLE_LIMITS),
        };
      },
    });
    try {
      RunnerLease.requireNewestGeneration(request.runnerDirectory, request.generation);
    } catch (refusal) {
      stopped = true;
      request.onLeaseTakenOver(refusal);
      return;
    }
    RelayInbox.writeReplies(written.result.replies);
    await stopLimitedJobs(written.board, observation.trackerId, written.result.usageLimitHits);
    scheduleThePassAtTheReset(written.result.usageResetsAt);
    await JobLaunch.runBuildJobEffects(jobLaunchContext, written.board, observation.trackerId, observation.buildJobs);
    for (const job of jobsNeedingAHost(written.board, request.workspace.trackerDirectory, spawnedInstances, written.result.agentConfigHeldTicketIds)) {
      spawnedInstances.add(`${job.id}:${job.hostInstance}`);
      launchHost(request, jobLaunchContext, written.board, observation.trackerId, job);
    }
    state = {
      generation: request.generation,
      passes:     state.passes + 1,
      notices:    noticesOf(request, observation, written.result.attributionTicketIds, written.result.nonConvergingTicketIds),
    };
    const settled = observe(request, jobLaunchContext);
    lastFingerprint = settled.fingerprint;
    if (JobLaunch.someBuildJobAwaitsAPass(written.board, settled.buildJobs)) {
      forcedNext = true;
      wokenAgain = true;
    }
  }

  async function drain(): Promise<void> {
    do {
      wokenAgain = false;
      const forced = forcedNext;
      forcedNext = false;
      try {
        await runOnePass(forced);
      } catch (thrown) {
        request.log(`A drive pass failed and waits for the next wake-up: ${thrown instanceof Error ? thrown.message : String(thrown)}`);
      }
    } while (wokenAgain && !stopped);
    running = null;
  }

  function wake(forced = false): void {
    if (stopped) return;
    forcedNext ||= forced;
    if (running !== null) {
      wokenAgain = true;
      return;
    }
    running = drain();
  }

  return {
    wake,
    idle:  () => running ?? Promise.resolve(),
    state: () => state,
  };
}
