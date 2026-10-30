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

import type { HostEnd }                                                                           from '../../lib/agent-host/HostRecord.ts';
import type { AgentAdapter }                                                                      from '../../lib/agent-launch/AgentAdapter.ts';
import type { AgentEffort }                                                                       from '../../lib/agent-launch/AgentLaunchRequest.ts';
import { launchEnvironmentOf }                                                                    from '../../lib/agent-launch/LaunchEnvironment.ts';
import { writeFileAtomically }                                                                    from '../../lib/atomic-file/AtomicFile.ts';
import { GitProcess }                                                                             from '../../lib/git/GitProcess.ts';
import type { GateOutcome, Job, JobKind }                                                         from '../../lib/tracker-model/@types/Job.ts';
import type { DecisionDraft, DecisionWording }                                                    from '../../lib/tracker-model/@types/LifecycleStep.ts';
import type { LogRecord }                                                                         from '../../lib/tracker-model/@types/LogRecord.ts';
import type { Pipeline, PipelineReview }                                                          from '../../lib/tracker-model/@types/Pipeline.ts';
import type { Board }                                                                             from '../../lib/tracker-model/Board.ts';
import { FRESH_AGENT_CAUSE, STOPPED_BY_USER_CAUSE }                                               from '../../lib/tracker-model/JobControls.ts';
import { FIRST_HOST_INSTANCE, HANDOFF_RED_INTERRUPTION }                                          from '../../lib/tracker-model/constants/JobStates.ts';
import { PipelineUtil }                                                                           from '../../lib/tracker-model/utils/PipelineUtil.ts';
import { TicketBodyHashUtil }                                                                     from '../../lib/tracker-model/utils/TicketBodyHashUtil.ts';
import { VocabularyUtil }                                                                         from '../../lib/tracker-model/utils/VocabularyUtil.ts';
import { DISPATCH_PROTOCOL }                                                                      from '../../shared/constants/DispatchProtocol.ts';
import { LIFECYCLE_LIMITS }                                                                       from '../../shared/constants/LifecycleLimits.ts';
import { PRODUCT_NAMES }                                                                          from '../../shared/constants/ProductNames.ts';
import { RED_HANDOFF_RESUME_CALL_BUDGET, SESSION_STOP_GRACE_MILLISECONDS, WIND_DOWN_GRACE_CALLS } from '../../shared/constants/RunnerLimits.ts';
import { type GateConfinement, GateRun }                                                          from '../lifecycle/GateRun.ts';
import {
  agentConfigTouchedBeforeLaunch,
  type JobVerificationSubject,
  launchSnapshotOf,
  type LaunchSnapshot,
  type RefMovesAllowed,
  refMovesAllowedOf,
  retriedFailedBuildJobIdOf,
  VERIFICATION_CHECKS,
  verifyJob
} from '../lifecycle/JobVerification.ts';
import { ReviewOutcome }                                  from '../lifecycle/ReviewOutcome.ts';
import type { TrackerChange }                             from '../tracker/TrackerPipeline.ts';
import type { Workspace }                                 from '../tracker/Workspace.ts';
import type { GateRunSlots }                              from './GateRunSlots.ts';
import { GroupWorktrees }                                 from './GroupWorktrees.ts';
import { HostFleet }                                      from './HostFleet.ts';
import { InstructionFiles, type InstructionFileRead }     from './InstructionFiles.ts';
import type { ProcessHostSandbox, ProcessSandboxRequest } from './ProcessHostSandbox.ts';
import { RedHandoff, type RedHandoffFacts }               from './RedHandoff.ts';
import { RelayInbox }                                     from './RelayInbox.ts';
import { WorkerProfiles, type SandboxFacts }              from './WorkerProfiles.ts';

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
  gateSlots:            GateRunSlots;
  windDownMessage:      string;
  decisionWordingOf:    (draft: DecisionDraft) => DecisionWording;
  log:                  (line: string) => void;
}

export type SetupProgress = 'creating-worktree' | 'worktree-failed' | 'installing' | 'install-failed' | 'installed';

export type GateStepOutcome = GateOutcome | 'setup-failed';

export type GateProgress =
  | { verdict: 'pending' }
  /** The step at `stepIndex` of the job's steps has yet to end, or to start while every gate slot of the machine is held. */
  | { verdict: 'running'; treeId: string; stepIndex: number }
  /** `step` names the red step, `null` on a pass; `ran` is false when a review left the tree the build's gates passed. */
  | { verdict: 'judged'; treeId: string; outcome: GateStepOutcome; step: string | null; output: string; ran: boolean; exitCode?: number | null };

/** One host of a job's gate run: the joined prepare steps, or one gate. */
interface GateStep {
  kind:        'prepare' | 'gate';
  name:        string;
  line:        string;
  folder:      string;
  in:          string | null;
  confinement: GateConfinement;
}

interface StepVerdict {
  treeId:    string;
  outcome:   GateStepOutcome;
  output:    string;
  exitCode?: number | null;
}

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
  worktreeFailure:        'worktree-failure.txt',
  start:                  'start.json',
  windDownSent:           'wind-down-sent',
  inputClosed:            'input-closed',
  stopSent:               'stop-sent',
  profile:                'process-sandbox.sb',
  instructionsReadPrefix: 'instructions-',
} as const;

const INSTALL_HOST_FOLDER = 'install';
const GATE_PREPARE_HOST_FOLDER = 'gate-prepare';
const GATE_HOST_FOLDER_PREFIX = 'gate-';
const PREPARE_STEP_NAME = 'prepare';
const STEP_VERDICT_SUFFIX = '-verdict.json';
const GATE_LOG_FILE = 'gate.log';
const PROCESS_HOST_INSTANCE = 1;
const REVIEW_JOB_KIND = 'review';

/** The jobs whose session works a ticket's worktree: each is prepared, verified and gated the same way, and only its outcome differs. */
const WORKTREE_JOB_KINDS: readonly JobKind[] = ['build', REVIEW_JOB_KIND];

function isWorktreeJob(job: Readonly<Job>): boolean {
  return WORKTREE_JOB_KINDS.includes(job.kind);
}

const AGENT_CONFIG_DECISION = 'branch-touches-agent-config';

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

/** `calls` counts the current attempt's turns: since the last red handoff's resume, or every instance's when none went red. */
function sessionReadingOf(context: JobLaunchContext, job: Readonly<Job>): { calls: number; report: unknown } {
  const jobFolder = jobFolderOf(context.workspace, job);
  const attemptStartInstance = attemptStartInstanceOf(jobFolder);
  const topLevelMessageIds = new Set<string>();
  let report: unknown = undefined;
  for (let instance = 1; instance <= job.hostInstance; instance += 1) {
    const entries = HostFleet.eventsAfter(jobFolder, instance, 0);
    if (entries === 'malformed') continue;
    for (const entry of entries.filter((logged) => logged.origin === 'agent')) {
      for (const event of context.agentAdapter.eventsOf(entry.line)) {
        if (event.kind === 'assistant-turn' && event.parentToolUseId === null && instance >= attemptStartInstance) topLevelMessageIds.add(event.messageId);
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

function treeOfCommit(worktree: string, commit: string): string | null {
  const run = GitProcess.run(worktree, ['rev-parse', '--verify', '--quiet', `${commit}^{tree}`]);
  return GitProcess.succeeded(run) ? run.standardOutput.trim() : null;
}

/**
 * The prepare steps, joined into one host, then each gate in list order, each in a host folder of its own. A session resumed after a red
 * handoff gates again in fresh folders, suffixed with its host instance, since a host folder runs once.
 */
function gateStepsOf(pipeline: Readonly<Pipeline>, hostInstance: number = FIRST_HOST_INSTANCE): GateStep[] {
  const installLine = PipelineUtil.installLineOf(pipeline);
  const suffix = hostInstance === FIRST_HOST_INSTANCE ? '' : `-${hostInstance}`;
  const prepare: GateStep[] = installLine === null ? [] : [{
    kind:        'prepare',
    name:        PREPARE_STEP_NAME,
    line:        installLine,
    folder:      `${GATE_PREPARE_HOST_FOLDER}${suffix}`,
    in:          null,
    confinement: GateRun.prepareConfinementOf(pipeline.gates),
  }];
  return [...prepare, ...pipeline.gates.map((gate, index): GateStep => ({
    kind: 'gate', name: gate.name, line: gate.run, folder: `${GATE_HOST_FOLDER_PREFIX}${index + 1}${suffix}`, in: gate.in ?? null, confinement: GateRun.gateConfinementOf(gate),
  }))];
}

/** A per-instance marker, so a session resumed after a red handoff gets its own wind-down, closed input and stop. */
function instanceMarkerOf(marker: string, hostInstance: number): string {
  return hostInstance === FIRST_HOST_INSTANCE ? marker : `${marker}-${hostInstance}`;
}

/** The host instance the job's current attempt began in: the one after its last red handoff, the first otherwise. */
function attemptStartInstanceOf(jobFolder: string): number {
  const facts = RedHandoff.redHandoffFactsOf(jobFolder);
  return facts === null ? FIRST_HOST_INSTANCE : facts.interruptedInstance + 1;
}

/** A session working off a red handoff has the short resume budget; the first attempt its role's. */
function attemptCallBudgetOf(trackerDirectory: string, job: Readonly<Job>): number {
  return RedHandoff.redHandoffFactsOf(HostFleet.jobFolderOf(trackerDirectory, job.id)) === null ? callBudgetOf(job) : RED_HANDOFF_RESUME_CALL_BUDGET;
}

function hostOutputOf(hostFolder: string): string {
  const entries = HostFleet.eventsAfter(hostFolder, PROCESS_HOST_INSTANCE, 0);
  return entries === 'malformed' ? '' : entries.filter((entry) => entry.origin === 'agent').map((entry) => `${entry.line}\n`).join('');
}

function readStepVerdict(verdictPath: string): StepVerdict | null {
  try {
    return JSON.parse(readFileSync(verdictPath, 'utf8')) as StepVerdict;
  } catch {
    return null;
  }
}

/**
 * The step's verdict once its host ended, `null` before. Kept in the job folder as it is first read, so a later gate that changes the tree
 * never turns an earlier pass red; it is this job's record of its own run, never a result another job reads.
 */
function stepVerdictOf(context: JobLaunchContext, job: Readonly<Job>, treeId: string, step: GateStep): StepVerdict | null {
  const jobFolder   = jobFolderOf(context.workspace, job);
  const verdictPath = join(jobFolder, `${step.folder}${STEP_VERDICT_SUFFIX}`);
  const kept        = readStepVerdict(verdictPath);
  if (kept !== null && kept.treeId === treeId) return kept;
  const hostFolder = join(jobFolder, step.folder);
  const end = processHostEnd(hostFolder);
  if (end === 'pending') return null;
  const run = { exitCode: end !== 'lost' && end.reason === 'exited' ? end.exitCode : null, signalCode: end === 'lost' ? null : end.signal, output: hostOutputOf(hostFolder) };
  let verdict: StepVerdict;
  if (step.kind === 'prepare') {
    verdict = {
      treeId, outcome: run.exitCode === 0 ? 'passed' : 'setup-failed', output: run.output, exitCode: run.exitCode
    };
  } else {
    const trackedChanges = GateRun.trackedChangesOf(worktreeOf(context.workspace, job));
    verdict = {
      treeId, outcome: GateRun.gateOutcomeOf(run, trackedChanges), output: GateRun.gateErrorOutputOf(run, trackedChanges), exitCode: run.exitCode
    };
  }
  writeFileSync(verdictPath, `${JSON.stringify(verdict)}\n`);
  if (verdict.outcome !== 'passed') writeFileSync(join(jobFolder, GATE_LOG_FILE), `${step.name}\n${verdict.output}`);
  return verdict;
}

/** A reviewer that committed nothing, or only commits back to the tree it was given, leaves the tree the build's gates passed. */
function reviewLeftTheTreeAsItWas(context: JobLaunchContext, job: Readonly<Job>, treeId: string): boolean {
  if (job.kind !== REVIEW_JOB_KIND) return false;
  const start = readJobStart(jobFolderOf(context.workspace, job));
  return start !== null && treeOfCommit(worktreeOf(context.workspace, job), start.startCommit) === treeId;
}

function gateProgressOf(context: JobLaunchContext, job: Readonly<Job>, pipeline: Readonly<Pipeline>): GateProgress {
  const treeId = treeOf(worktreeOf(context.workspace, job));
  if (treeId === null) return { verdict: 'pending' };
  if (reviewLeftTheTreeAsItWas(context, job, treeId)) return {
    verdict: 'judged', treeId, outcome: 'passed', step: null, output: '', ran: false
  };
  for (const [stepIndex, step] of gateStepsOf(pipeline, job.hostInstance).entries()) {
    const verdict = stepVerdictOf(context, job, treeId, step);
    if (verdict === null) return { verdict: 'running', treeId, stepIndex };
    if (verdict.outcome !== 'passed') return {
      verdict: 'judged', treeId, outcome: verdict.outcome, step: step.name, output: verdict.output, ran: true, exitCode: verdict.exitCode ?? null
    };
  }
  return {
    verdict: 'judged', treeId, outcome: 'passed', step: null, output: '', ran: true
  };
}

/** Read outside the lock, for every live build job. */
function observeBuildJobs(context: JobLaunchContext, jobs: readonly Readonly<Job>[], pipeline: Readonly<Pipeline> | null): BuildJobObservation[] {
  const installLine = pipeline === null ? null : PipelineUtil.installLineOf(pipeline);
  return jobs.filter(isWorktreeJob).map((job) => {
    const liveness = HostFleet.livenessOf(jobFolderOf(context.workspace, job), job.hostInstance);
    return {
      jobId:    job.id,
      setup:    job.state === 'preparing' ? setupProgressOf(context, job, installLine) : 'installed',
      ...sessionReadingOf(context, job),
      agentEnd: liveness.verdict === 'ended' ? liveness.end : liveness.verdict === 'lost' ? 'lost' : null,
      gate:     job.state === 'gating' && pipeline !== null ? gateProgressOf(context, job, pipeline) : { verdict: 'pending' },
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
  change:     TrackerChange;
  context:    JobLaunchContext;
  checksLine: string | null;
  logged:     LogRecord[];
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
  const retriedJobId = retriedFailedBuildJobIdOf(board.logRecordsSoFar(), job.id);
  const retriedStart = retriedJobId === null ? null : readJobStart(HostFleet.jobFolderOf(hold.context.workspace.trackerDirectory, retriedJobId));
  const subject: JobVerificationSubject = {
    role:             job.kind === REVIEW_JOB_KIND ? 'reviewer' : 'builder',
    worktreePath:     worktreeOf(hold.context.workspace, job),
    startCommit:      start.startCommit,
    ...(retriedStart === null ? {} : { workStartCommit: retriedStart.startCommit }),
    bodyHashAtLaunch: start.bodyHashAtLaunch,
    report:           observation.report,
    ticketBody:       ticket.body,
    jobId:            job.id,
    logRecords:       board.logRecordsSoFar(),
    launchSnapshot:   start.launchSnapshot,
    refMovesAllowed:  refMovesAllowedFor(hold.context, board, job),
    gates:            board.pipeline()?.gates ?? [],
    instructionFiles: InstructionFiles.trackedInstructionPathsOf(board.pipeline()),
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
    if (RESUMABLE_CUSTOMS_CHECKS.includes(verdict.check)) {
      interruptOnRedHandoff(hold, job, {
        kind: 'customs', name: verdict.check, command: null, fixCommand: null, exitCode: null, fullLogPath: null, output: verdict.reason
      });
      return;
    }
    if (verdict.check === 'V13') openAgentConfigDecision(hold, job);
    endJob(hold, job, { outcome: 'failed', cause: verdict.check === 'V7' ? BUILD_JOB_CAUSES.attribution : verdict.reason });
    return;
  }
  hold.logged.push(...board.moveJob(job.id, 'gating', at).logged);
}

/** The other jobs' branches, which their own sessions move, and the refs the Overseer's own landings and refreshes move or remove. */
function refMovesAllowedFor(context: JobLaunchContext, board: Board, job: Readonly<Job>): RefMovesAllowed {
  const worktreesRoot = join(context.workspace.rootDirectory, PRODUCT_NAMES.WORKTREES_FOLDER);
  const tickets       = board.tickets();
  return refMovesAllowedOf(board.logRecordsSoFar(), {
    ownBranch:             branchOf(job),
    otherJobBranches:      board.jobs().filter((other) => other.id !== job.id && isWorktreeJob(other)).map(branchOf),
    ticketBranchOf:        (ticketId) => `ticket-${ticketId}`,
    releasedGroupBranchOf: (ticketId) => {
      const frontmatter = tickets.find((candidate) => candidate.frontmatter.id === ticketId)?.frontmatter;
      return frontmatter?.releasesGroup === true && frontmatter.group !== undefined ? `${context.groupTargetPrefix}${frontmatter.group}` : null;
    },
    refreshWorktreeOf: (groupBranch) => GroupWorktrees.refreshWorktreeOf(worktreesRoot, groupBranch),
  });
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
    change, context, checksLine: null, logged: []
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

interface RedHandoffCause extends Pick<RedHandoffFacts, 'kind' | 'name' | 'command' | 'fixCommand' | 'exitCode' | 'fullLogPath'> {
  output: string;
}

/**
 * A red gate or Customs check never ends the job: the handover is written in its folder and the job interrupted `handoff-red`, which the
 * lifecycle resumes in the same session while its cycle has resumes left and parks after.
 */
function interruptOnRedHandoff(hold: HoldContext, job: Readonly<Job>, cause: RedHandoffCause): void {
  const jobFolder = jobFolderOf(hold.context.workspace, job);
  const earlier = RedHandoff.redHandoffFactsOf(jobFolder);
  const { output, ...named } = cause;
  mkdirSync(jobFolder, { recursive: true });
  RedHandoff.writeRedHandoff(jobFolder, {
    ...named,
    commit:              GitProcess.resolvedCommitOf(worktreeOf(hold.context.workspace, job), 'HEAD') ?? '',
    handoverPath:        RedHandoff.handoverPathOf(jobFolder),
    resume:              (earlier?.resume ?? 0) + 1,
    resumesAllowed:      LIFECYCLE_LIMITS.RED_HANDOFF_RESUMES_BEFORE_PARKING,
    callBudget:          RED_HANDOFF_RESUME_CALL_BUDGET,
    interruptedInstance: job.hostInstance,
  }, output);
  hold.logged.push(...hold.change.board.interruptJob(job.id, HANDOFF_RED_INTERRUPTION, hold.change.at).logged);
}

function workingOffARedHandoff(context: Pick<JobLaunchContext, 'workspace'>, job: Readonly<Job>): boolean {
  return RedHandoff.redHandoffFactsOf(jobFolderOf(context.workspace, job)) !== null;
}

/** What the last red handoff named, carried into the next one when a resumed session runs past its grace. */
function redHandoffCauseOf(context: Pick<JobLaunchContext, 'workspace'>, job: Readonly<Job>): Omit<RedHandoffCause, 'output'> {
  const facts = RedHandoff.redHandoffFactsOf(jobFolderOf(context.workspace, job));
  return {
    kind:        facts?.kind ?? 'gate',
    name:        facts?.name ?? '',
    command:     facts?.command ?? null,
    fixCommand:  facts?.fixCommand ?? null,
    exitCode:    facts?.exitCode ?? null,
    fullLogPath: facts?.fullLogPath ?? null,
  };
}

/** The Customs checks a resumed session can put right in its own worktree: a dirty worktree, no commit, missing or stale gate claims. */
const RESUMABLE_CUSTOMS_CHECKS: readonly string[] = ['V3', 'V4', 'V15'];

function settleGate(hold: HoldContext, job: Readonly<Job>, observation: BuildJobObservation): void {
  const { gate } = observation;
  if (gate.verdict !== 'judged' || hold.checksLine === null) return;
  const { board, at } = hold.change;
  board.recordPipelineJudgedBy(ticketIdOf(job));
  if (gate.outcome === 'setup-failed') {
    openIncidentFor(hold, job, 'setup-failed', { step: PREPARE_STEP_NAME });
    endJob(hold, job, { outcome: 'stopped', cause: BUILD_JOB_CAUSES.setupFailed });
    return;
  }
  if (gate.ran) hold.logged.push(...board.recordGateRan({ tree: gate.treeId, outcome: gate.outcome, cached: false }, at).logged);
  if (gate.outcome === 'cannot-run') {
    openIncidentFor(hold, job, 'gate-cannot-run', { tree: gate.treeId, gate: gate.step ?? '' });
    endJob(hold, job, { outcome: 'stopped', cause: BUILD_JOB_CAUSES.gateCannotRun });
    return;
  }
  if (gate.outcome === 'failed') {
    hold.context.log(`The ${gate.step ?? ''} gate of job ${job.id} (#${ticketIdOf(job)}) is red on ${gate.treeId}; its output is in ${GATE_LOG_FILE}.`);
    const pipelineGate = board.pipeline()?.gates.find((candidate) => candidate.name === gate.step);
    interruptOnRedHandoff(hold, job, {
      kind:        'gate',
      name:        gate.step ?? '',
      command:     pipelineGate?.run ?? null,
      fixCommand:  pipelineGate?.fix ?? null,
      exitCode:    gate.exitCode ?? null,
      fullLogPath: join(jobFolderOf(hold.context.workspace, job), GATE_LOG_FILE),
      output:      gate.output,
    });
    return;
  }
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
  // A pipeline without a review phase lands a gated build directly: it waits in review only for its merge slot.
  if (board.pipeline()?.review === undefined) hold.logged.push(...board.queueTicketForMerge(ticketIdOf(job), job.target ?? hold.context.mainLine, at).logged);
}

/** A reviewer runs on the pipeline review's `model` and `effort` where set; an effort outside the vocabulary keeps the default. */
function reviewerLaunchSettingsOf(review: Readonly<PipelineReview> | undefined, job: Readonly<Job>): { model?: string; effort?: AgentEffort } {
  if (job.kind !== REVIEW_JOB_KIND || review === undefined) return {};
  return {
    ...(review.model === undefined || review.model === '' ? {} : { model: review.model }),
    ...(review.effort !== undefined && VocabularyUtil.agentEffortIsKnown(review.effort) ? { effort: review.effort } : {}),
  };
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
        const label = board.pipeline()?.review?.name;
        hold.logged.push(...board.startReviewBar(ticketIdOf(job), { round: job.attempt, owner: job.id, ...(label === undefined ? {} : { label }) }, at).logged);
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
      if (observation.calls >= attemptCallBudgetOf(hold.context.workspace.trackerDirectory, job) + WIND_DOWN_GRACE_CALLS) {
        // A resumed session past its grace counts as red again; only a first attempt opens `out-of-calls`.
        if (!workingOffARedHandoff(hold.context, job)) openIncidentFor(hold, job, 'out-of-calls', { calls: String(observation.calls) });
        hold.logged.push(...board.moveJob(job.id, 'stopping', at).logged);
      }
      return;
    case 'stopping':
      if (observation.agentEnd === null) return;
      if (job.stopRequest === undefined && workingOffARedHandoff(hold.context, job)) {
        const output = `The resumed session passed its ${RED_HANDOFF_RESUME_CALL_BUDGET} calls and the ${WIND_DOWN_GRACE_CALLS}-call grace without a report.`;
        interruptOnRedHandoff(hold, job, { ...redHandoffCauseOf(hold.context, job), output });
        return;
      }
      endJob(hold, job, userStopEndingOf(job) ?? { outcome: 'stopped', cause: BUILD_JOB_CAUSES.outOfCalls });
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
    change, context, checksLine: change.board.checksLine(), logged: []
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

/** `worktree` is the ticket's own unless named, as a refresh's resolver names the refresh worktree it resolves in. */
function sandboxFactsFor(context: JobLaunchContext, job: Readonly<Job>, worktree: string = worktreeOf(context.workspace, job)): SandboxFacts {
  const { workspace } = context;
  return WorkerProfiles.sandboxFactsOf({
    repositoryRoot: workspace.rootDirectory,
    dataFolder:     workspace.trackerDirectory,
    monitorFolder:  context.monitorFolder,
    homeDirectory:  context.homeDirectory,
    worktree,
    ownBranch:      branchOf(job),
    mainLine:       context.mainLine,
    groupPrefix:    context.groupTargetPrefix,
    relayDirectory: RelayInbox.relayDirectoryOf(workspace.rootDirectory, job.id),
  });
}

const PATH_SEPARATOR = ':';

/** The profile a gate or prepare step runs under in `worktree`: the step's own network and `writes`, and the job's denies. */
type SandboxContext = Pick<JobLaunchContext, 'homeDirectory' | 'inheritedEnvironment'>;

function processSandboxRequestOf(context: SandboxContext, facts: SandboxFacts, confinement: GateConfinement): ProcessSandboxRequest {
  const adminFolder = GitProcess.run(facts.worktree, ['rev-parse', '--absolute-git-dir']);
  const environment = GateRun.gateEnvironmentOf(launchEnvironmentOf(context.inheritedEnvironment, {}));
  return {
    worktree:             facts.worktree,
    worktreeAdminFolder:  GitProcess.succeeded(adminFolder) ? adminFolder.standardOutput.trim() : null,
    homeDirectory:        context.homeDirectory,
    temporaryDirectory:   Object.hasOwn(environment, 'TMPDIR') ? environment['TMPDIR'] ?? null : null,
    cachePaths:           confinement.writes,
    executableSearchPath: (context.inheritedEnvironment['PATH'] ?? '').split(PATH_SEPARATOR).filter((folder) => folder !== ''),
    deniedWritableRoots:  WorkerProfiles.deniedWritableRootsOf(facts),
    deniedReadableRoots:  WorkerProfiles.deniedReadableRootsOf(facts),
    network:              confinement.network,
  };
}

/** What a process host runs: its argv, its confinement, and a gate's `in` folder, relative to the worktree. */
interface ProcessHostStep {
  argv:        readonly string[];
  confinement: GateConfinement;
  subfolder:   string | null;
}

function spawnProcessHost(context: JobLaunchContext, trackerId: string, job: Readonly<Job>, folderName: string, step: ProcessHostStep): void {
  const { argv: childArgv, confinement, subfolder } = step;
  const jobFolder = jobFolderOf(context.workspace, job);
  const hostFolder = join(jobFolder, folderName);
  if (HostFleet.livenessOf(hostFolder, PROCESS_HOST_INSTANCE).verdict !== 'unclaimed') return;
  const worktree = worktreeOf(context.workspace, job);
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
    workingDirectory: subfolder === null ? worktree : join(worktree, subfolder),
    argv:             context.sandbox.sandboxedArgvOf(profilePath, childArgv),
    environment,
  });
  writeFileSync(profilePath, context.sandbox.profileTextOf(processSandboxRequestOf(context, sandboxFactsFor(context, job), confinement)));
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
  const markerOf = (marker: string): string => instanceMarkerOf(marker, job.hostInstance);
  if (job.state === 'running' && calls >= attemptCallBudgetOf(request.trackerDirectory, job)) {
    await sendOnce(request, job, markerOf(JOB_FILES.windDownSent), [{ kind: 'write', line: request.agentAdapter.chatLineOf(request.windDownMessage) }]);
  }
  if (job.state === 'verifying' || job.state === 'gating') await sendOnce(request, job, markerOf(JOB_FILES.inputClosed), [{ kind: 'close-input' }]);
  if (job.state === 'stopping') await sendOnce(request, job, markerOf(JOB_FILES.stopSent), [{ kind: 'stop', graceMilliseconds: SESSION_STOP_GRACE_MILLISECONDS }]);
}

/** After the hold and the lease check: what each build job's new state asks of git and the hosts. */
async function runBuildJobEffects(context: JobLaunchContext, board: Board, trackerId: string, observations: readonly BuildJobObservation[]): Promise<void> {
  const pipeline = board.pipeline();
  const installLine = pipeline === null ? null : PipelineUtil.installLineOf(pipeline);
  for (const job of board.jobs().filter(isWorktreeJob)) {
    if (job.state === 'preparing') {
      const jobFolder = jobFolderOf(context.workspace, job);
      if (!existsSync(worktreeOf(context.workspace, job)) && !existsSync(join(jobFolder, JOB_FILES.worktreeFailure))) createWorktree(context, job);
      if (existsSync(worktreeOf(context.workspace, job)) && pipeline !== null && installLine !== null) {
        const confinement = GateRun.prepareConfinementOf(pipeline.gates);
        spawnProcessHost(context, trackerId, job, INSTALL_HOST_FOLDER, { argv: GateRun.shellLineArgvOf(installLine), confinement, subfolder: null });
      }
    }
    const calls = observations.find((observation) => observation.jobId === job.id)?.calls ?? 0;
    await deliverBuildJobFrames({ trackerDirectory: context.workspace.trackerDirectory, agentAdapter: context.agentAdapter, windDownMessage: context.windDownMessage }, job, calls);
    if (job.state === 'gating' && pipeline !== null) spawnNextGateStep(context, trackerId, job, pipeline);
  }
}

/** Read afresh, since the hold may have moved the job into gating this pass; a gate waits for a free slot of the machine, a prepare step never. */
function spawnNextGateStep(context: JobLaunchContext, trackerId: string, job: Readonly<Job>, pipeline: Readonly<Pipeline>): void {
  const progress = gateProgressOf(context, job, pipeline);
  if (progress.verdict !== 'running') return;
  const step = gateStepsOf(pipeline, job.hostInstance)[progress.stepIndex];
  if (step === undefined) return;
  const hostFolder = join(jobFolderOf(context.workspace, job), step.folder);
  if (step.kind === 'gate' && !context.gateSlots.tryAcquire(hostFolder)) return;
  spawnProcessHost(context, trackerId, job, step.folder, { argv: GateRun.shellLineArgvOf(step.line), confinement: step.confinement, subfolder: step.in });
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

/** Each host instance's launch keeps the path and content hash of every instruction file its session was given. */
function recordInstructionsRead(jobFolder: string, hostInstance: number, files: readonly InstructionFileRead[]): void {
  mkdirSync(jobFolder, { recursive: true });
  writeFileAtomically(join(jobFolder, `${JOB_FILES.instructionsReadPrefix}${hostInstance}.json`), `${JSON.stringify({ files }, null, 2)}\n`);
}

export const JobLaunch = Object.freeze({
  recordInstructionsRead,
  observeBuildJobs,
  applyBuildJobObservations,
  runBuildJobEffects,
  deliverBuildJobFrames,
  recordJobStart,
  attributionTicketIdsOf,
  someBuildJobAwaitsAPass,
  sandboxFactsFor,
  processSandboxRequestOf,
  worktreeOf,
  isWorktreeJob,
  ticketIdsTouchingAgentConfigOf,
  holdAgentConfigHits,
  sessionReadingOf,
  callBudgetOf,
  reviewerLaunchSettingsOf,
});
