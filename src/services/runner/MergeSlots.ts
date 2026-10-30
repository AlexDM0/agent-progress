/**
 * The merge slots, one per target, run by the runner after each pass (design section 6): allocation, the one merge-in against the recorded
 * tip, a resolver for a conflict git cannot settle, the gate on the merged tree and the compare-and-swap landing. The main line lands in the
 * main checkout; a group's tickets and its refreshes land in the group's own worktree, and its release ticket lands the bundle on the main
 * line. Every phase is written on the merge job's slot in its own hold, and every outcome ends the job or opens what User or the orchestrator
 * answers, so nothing loops.
 */
import { readCurrentBranch }           from '../../lib/git/BranchIntegration.ts';
import { GitProcess }                  from '../../lib/git/GitProcess.ts';
import { predictMerge, predictMerges } from '../../lib/git/MergeTree.ts';
import type { DecisionKind }           from '../../lib/tracker-model/@types/Decision.ts';
import type {
  GateOutcome,
  Job,
  JobEnding,
  MergeSlot,
  SlotPhase
}                                          from '../../lib/tracker-model/@types/Job.ts';
import type { DecisionDraft, DecisionWording } from '../../lib/tracker-model/@types/LifecycleStep.ts';
import type { Board }                          from '../../lib/tracker-model/Board.ts';
import { BoardRefusal }                        from '../../lib/tracker-model/BoardRefusal.ts';
import type { MergeCandidate, MergeTargetOf }  from '../../lib/tracker-model/MergeSlotClaims.ts';
import { MERGE_PRIORITY_RANK }                 from '../../lib/tracker-model/MergeSlotClaims.ts';
import { PARKED_HOLD_PREFIX }                  from '../../lib/tracker-model/constants/DecisionAndIncidentVocabulary.ts';
import { HANDOFF_RED_INTERRUPTION }            from '../../lib/tracker-model/constants/JobStates.ts';
import { MergeQueueUtil, type MergeForecast }  from '../../lib/tracker-model/utils/MergeQueueUtil.ts';
import type { MergeSlotLimits }                from '../../shared/constants/MergeSlotLimits.ts';
import { RED_HANDOFF_RESUME_CALL_BUDGET }      from '../../shared/constants/RunnerLimits.ts';
import { LANDING_OUTCOME_OF_REFUSAL, Landing } from '../lifecycle/Landing.ts';
import { MergeRun }                            from '../lifecycle/MergeRun.ts';
import { GroupWorktrees }                      from './GroupWorktrees.ts';
import { RedHandoff }                          from './RedHandoff.ts';

export interface MergeSlotHold {
  board: Board;
  at:    string;
}

/** One fenced `writeTracker` hold: the caller checks its lease after it. */
export type MergeSlotHoldRunner = <Result>(mutate: (hold: MergeSlotHold) => Result) => Promise<Result>;

/** What the merge agent's session reported and how many top-level calls it made, read from its event log. */
export interface MergeAgentReading {
  calls:  number;
  report: unknown;
}

export interface MergeSlotsContext {
  /** The main checkout, where the main line is fast-forwarded. */
  repositoryRoot:        string;
  mainLine:              string;
  groupTargetPrefix:     string;
  /** Where the group worktrees and the refresh worktrees live, beside the ticket worktrees. */
  worktreesRoot:         string;
  worktreeOf:            (ticketId: string) => string;
  limits:                MergeSlotLimits;
  /** T1b-P14's finding: with the per-job ref denies holding, a target moved by someone else requeues silently. */
  refDeniesHold:         boolean;
  hold:                  MergeSlotHoldRunner;
  gateMergedTree:        (worktreePath: string, treeId: string) => Promise<MergedTreeGate>;
  mergeAgentReadingOf:   (job: Readonly<Job>) => MergeAgentReading;
  /** The job's own host, an agent's or a process host's, is alive. */
  hostIsLive:            (job: Readonly<Job>) => boolean;
  stopMergeAgent:        (job: Readonly<Job>) => Promise<void>;
  decisionWordingOf:     (draft: DecisionDraft) => DecisionWording;
  /** Keeps an Airlock incident's facts beside the merge job, for the agent its move or default launches once the incident is closed. */
  keepAirlockFacts:      (mergeJob: Readonly<Job>, facts: Readonly<Record<string, string>>) => void;
  /** The job's own folder, where a merge-gate fixer's red handoff is written for its resumed session. */
  jobFolderOf:           (job: Readonly<Job>) => string;
  /** How often a fixer whose fix left the merged tree red is resumed before the merge parks. */
  redHandoffResumes:     number;
  /** `run pause` opens no new slot; a slot already open finishes. */
  dispatchIsStopped:     () => boolean;
  /** A removal git declined after a refresh or a release: the Overseer logs it and shows it as a notice while the leftover stands. */
  reportDeclinedCleanup: (declined: DeclinedCleanup) => void;
}

/** The merged tree's gate: its outcome and what the checks line printed, whose tail a merge-gate fixer is given. */
export interface MergedTreeGate {
  /** `setup-failed` when a prepare step did not exit 0: no gate judged the tree. */
  outcome: GateOutcome | 'setup-failed';
  /** The red gate or the failed prepare step; `null` on a pass. */
  step:    string | null;
  output:  string;
}

/** A red gate is the Airlock's own incident; a gate that could not run and a failed prepare step are the ones a build job opens too. */
const MERGE_GATE_INCIDENT_KINDS = { 'failed': 'merge-gate-failed', 'cannot-run': 'gate-cannot-run', 'setup-failed': 'setup-failed' } as const;

function treeOfCommit(worktree: string, commit: string): string | null {
  const run = GitProcess.run(worktree, ['rev-parse', '--verify', '--quiet', `${commit}^{tree}`]);
  return GitProcess.succeeded(run) ? run.standardOutput.trim() : null;
}

/** The merged tree is the branch's own tree, and the newest gate run on it passed: the merge changed nothing the gates judged. */
function mergedTreeWasLastPassed(board: Board, worktree: string, job: Readonly<Job>, treeId: string): boolean {
  const branchTip = job.slot?.branchTip;
  if (branchTip === undefined || treeOfCommit(worktree, branchTip) !== treeId) return false;
  const newestRunOnTheTree = board.logRecordsSoFar().findLast((record) => record.kind === 'gate-ran' && record.fields.tree === treeId);
  return newestRunOnTheTree?.kind === 'gate-ran' && newestRunOnTheTree.fields.outcome === 'passed';
}

/** The Airlock agents a slot launches on an incident's move or default, each bounded by its own launches and call budget. */
type AirlockAgentRole = 'merge-fix' | 'resolution-review';

/** The parked holds an Airlock agent's outcome leaves: a merged tree still failing after its fixers, or a resolution whose claims fail. */
type AirlockParkCause = 'merge-gate-failed' | 'merge-resolution-rejected';

export interface DeclinedCleanup {
  cleanup:     'refresh' | 'release';
  groupBranch: string;
  /** Git's own reason, as `GroupWorktrees` hands it back. */
  reason:      string;
}

/** The `dirty-main-checkout` notice: the target checkout's branch, or the files blocking the fast-forward. */
export interface HeldTarget {
  target:        string;
  branch:        string | null;
  blockingFiles: readonly string[];
}

export interface MergeSlots {
  /** Advances every slot as far as it goes without waiting, then allocates; resolves with the targets whose landings wait. */
  sweep: () => Promise<readonly HeldTarget[]>;
}

/** A sweep stops after this many rounds of advancing and allocating, so a slot that keeps moving waits for the next pass. */
const ROUNDS_PER_SWEEP = 8;

const MERGE_REFUSED_CAUSES = {
  outOfCalls:         'out-of-calls',
  cannotResolve:      'cannot-resolve',
  unresolved:         'merge-unresolved',
  noReport:           'no-report',
  gitFailed:          'git-failed',
  releaseBehindGroup: 'release-behind-group',
} as const;

/** The causes a merge job ends with when it frees its slot and its ticket waits in the queue again. */
const REQUEUE_CAUSES = { orphaned: 'orphaned', targetMoved: 'target-moved', targetHeld: 'target-held' } as const;

const MERGE_ABORTED_CAUSE = 'merge-aborted';

const RED_RESUMES_SPENT_CAUSE = 'red-resumes-spent';

const LANDING_REFUSED_DECISION: DecisionKind = 'landing-refused';

/** A refused refresh names no ticket: its `merge-refused` context starts with the group's target, which keeps the next refresh waiting. */
const REFRESH_REFUSAL_SEPARATOR = ': ';

function reportFieldOf(report: unknown, field: string): unknown {
  return typeof report === 'object' && report !== null && Object.hasOwn(report, field) ? (report as Record<string, unknown>)[field] : undefined;
}

function slotOf(job: Readonly<Job>): Readonly<MergeSlot> {
  if (job.slot === undefined) throw new Error(`Merge job ${job.id} holds no slot.`);
  return job.slot;
}

function ticketIdOf(job: Readonly<Job>): string {
  return job.ticketIds[0] ?? '';
}

function isRefresh(job: Readonly<Job>): boolean {
  return job.kind === 'refresh';
}

function mergeAgentOf(board: Board, job: Readonly<Job>): Readonly<Job> | undefined {
  return board.jobs().find((candidate) => candidate.kind === 'merge-agent' && candidate.parentJobId === job.id);
}

/** The ticket's trailing run of merge jobs ended by an unrecorded target move: what parks it after TARGET_MOVED_MERGES_BEFORE_PARKING. */
function targetMovesInARowOf(board: Board, ticketId: string): number {
  const mergeJobIds = new Set<string>();
  let movesInARow = 0;
  for (const record of board.logRecordsSoFar()) {
    if (record.kind === 'job-launched' && record.fields.kind === 'merge' && record.fields.ticketIds.includes(ticketId)) mergeJobIds.add(record.jobId);
    if (record.kind !== 'job-ended' || !mergeJobIds.has(record.jobId)) continue;
    movesInARow = record.fields.cause === REQUEUE_CAUSES.targetMoved ? movesInARow + 1 : 0;
  }
  return movesInARow;
}

function uncommittedPathsOf(directory: string): string[] | null {
  const status = GitProcess.run(directory, ['status', '--porcelain=v1', '--untracked-files=no']);
  if (!GitProcess.succeeded(status)) return null;
  return status.standardOutput.split('\n').filter((line) => line !== '').map((line) => line.slice('XY '.length));
}

function launchesUnder(board: Board, job: Readonly<Job>, role: AirlockAgentRole): number {
  return board.logRecordsSoFar().filter((record) => (
    record.kind === 'job-launched' && record.fields.parentJobId === job.id && record.fields.role === role
  )).length;
}

/** How often the agent's session was resumed after a red handoff. */
function redResumesOf(board: Board, agent: Readonly<Job>): number {
  return board.logRecordsSoFar().filter((record) => record.kind === 'job-resumed' && record.jobId === agent.id && record.fields.cause === HANDOFF_RED_INTERRUPTION).length;
}

function tailOf(output: string, lineCount: number): string {
  return output.trimEnd().split('\n').slice(-lineCount).join('\n');
}

function forecastOf(prediction: ReturnType<typeof predictMerge>): MergeForecast {
  return prediction.verdict;
}

export function createMergeSlots(context: MergeSlotsContext): MergeSlots {
  const { mainLine, groupTargetPrefix } = context;
  const targetOf: MergeTargetOf = (ticket) => (
    ticket.group === undefined || ticket.releasesGroup === true ? mainLine : `${groupTargetPrefix}${ticket.group}`
  );
  const groupOf = (target: string): string => target.slice(groupTargetPrefix.length);
  const heldTargets = new Map<string, HeldTarget>();

  /** Main lands in the main checkout; a group branch in its own worktree, created from the main line's tip when the group has none yet. */
  function targetDirectoryOf(target: string): string | null {
    if (target === mainLine) return context.repositoryRoot;
    const prepared = GroupWorktrees.prepareGroupWorktree(context.repositoryRoot, context.worktreesRoot, target, mainLine);
    return prepared.verdict === 'ready' ? prepared.path : null;
  }

  function slotWorktreeOf(job: Readonly<Job>): string {
    return isRefresh(job) ? GroupWorktrees.refreshWorktreeOf(context.worktreesRoot, job.target ?? '') : context.worktreeOf(ticketIdOf(job));
  }

  function openDecision(hold: MergeSlotHold, kind: DecisionKind, ticketIds: readonly string[], decisionContext: string): void {
    const draft: DecisionDraft = { kind, ticketIds, jobId: null };
    hold.board.openDecision({
      ...draft, askedBy: 'runner', requestId: null, questions: context.decisionWordingOf(draft).questions, context: decisionContext
    }, hold.at);
  }

  function setPhase(hold: MergeSlotHold, job: Readonly<Job>, phase: SlotPhase): void {
    hold.board.setJobSlot(job.id, { ...slotOf(job), phase });
  }

  function removeRefreshWorktree(job: Readonly<Job>): void {
    const reason = GroupWorktrees.removeWorktree(context.repositoryRoot, slotWorktreeOf(job));
    if (reason !== null) context.reportDeclinedCleanup({ cleanup: 'refresh', groupBranch: job.target ?? '', reason });
  }

  /** Frees the slot with the worktree back at its recorded start, a refresh's removed; the ticket stays queued unless the caller took it out. */
  async function freeSlot(job: Readonly<Job>, ending: JobEnding, inHold: (hold: MergeSlotHold) => void = () => undefined): Promise<void> {
    const worktree = slotWorktreeOf(job);
    MergeRun.restoreBranchTip(worktree, MergeRun.sidesOf(job, slotOf(job)).startTip);
    if (isRefresh(job)) removeRefreshWorktree(job);
    await context.hold((hold) => {
      const agent = mergeAgentOf(hold.board, job);
      if (agent !== undefined) hold.board.endJob(agent.id, { outcome: 'stopped', cause: ending.cause ?? 'merge-ended' }, hold.at);
      hold.board.endJob(job.id, ending, hold.at);
      inHold(hold);
    });
  }

  /** The merge aborts, the slot frees and User is asked; a `reportKind` also opens the orchestrator's incident, with no job waiting. */
  async function refuseMerge(job: Readonly<Job>, cause: string, notes: string, reportKind: unknown = null): Promise<void> {
    const ticketIds = isRefresh(job) ? [] : [ticketIdOf(job)];
    await freeSlot(job, { outcome: 'failed', cause }, (hold) => {
      ticketIds.forEach((ticketId) => hold.board.setTicketMergeQueued(ticketId, false, hold.at));
      openDecision(hold, 'merge-refused', ticketIds, isRefresh(job) ? `${job.target ?? ''}${REFRESH_REFUSAL_SEPARATOR}${notes}` : notes);
      if (reportKind !== 'malformed-ticket' && reportKind !== 'system-blocker') return;
      hold.board.openIncident({
        kind:        reportKind === 'malformed-ticket' ? 'malformed-ticket' : 'system-question',
        ticketIds,
        jobId:       null,
        facts:       { notes, mergeJobId: job.id },
        defaultMove: 'incident-escalate',
      }, hold.at);
    });
  }

  /** A release carries the group's whole tip to the main line; one forked before a later landing or refresh would deliver work main lacks. */
  async function releaseGapOf(job: Readonly<Job>): Promise<string | null> {
    if (isRefresh(job) || slotOf(job).target !== mainLine) return null;
    const ticketId = ticketIdOf(job);
    const group = await context.hold((hold) => {
      const ticket = hold.board.tickets().find((candidate) => candidate.frontmatter.id === ticketId);
      return ticket?.frontmatter.releasesGroup === true ? ticket.frontmatter.group : undefined;
    });
    if (group === undefined) return null;
    const groupBranch = `${groupTargetPrefix}${group}`;
    const groupTip    = GitProcess.resolvedCommitOf(context.repositoryRoot, `refs/heads/${groupBranch}`);
    if (groupTip === null) return null;
    const descends = GitProcess.run(context.repositoryRoot, ['merge-base', '--is-ancestor', groupTip, slotOf(job).branchTip]);
    return GitProcess.succeeded(descends) ? null : `The release branch of #${ticketId} does not hold ${groupBranch}'s tip ${groupTip}.`;
  }

  async function runMergeIn(job: Readonly<Job>): Promise<boolean> {
    const worktree = slotWorktreeOf(job);
    const slot     = slotOf(job);
    if (isRefresh(job)) {
      const prepared = GroupWorktrees.prepareRefreshWorktree(context.repositoryRoot, context.worktreesRoot, slot.target, slot.targetTip);
      if (prepared.verdict === 'git-failed') {
        await refuseMerge(job, MERGE_REFUSED_CAUSES.gitFailed, prepared.reason);
        return true;
      }
    }
    if (MergeRun.mergeIsInProgress(worktree)) {
      // A live holder keeps its slot; only a merge-in left behind by nobody is aborted and requeued.
      if (context.hostIsLive(job)) return false;
      await freeSlot(job, { outcome: 'stopped', cause: REQUEUE_CAUSES.orphaned });
      return true;
    }
    const releaseGap = await releaseGapOf(job);
    if (releaseGap !== null) {
      await refuseMerge(job, MERGE_REFUSED_CAUSES.releaseBehindGroup, releaseGap);
      return true;
    }
    const merge = MergeRun.mergeInOnce(worktree, MergeRun.sidesOf(job, slot));
    if (merge.verdict === 'merged' || merge.verdict === 'already-descends') {
      await context.hold((hold) => setPhase(hold, job, 'gating'));
      return true;
    }
    if (merge.verdict === 'conflicted') {
      await context.hold((hold) => {
        hold.board.launchJob({
          kind: 'merge-agent', role: 'resolver', ticketIds: job.ticketIds, parentJobId: job.id, attempt: 1, target: slot.target,
        }, hold.at);
        setPhase(hold, job, 'resolving');
      });
      return true;
    }
    await refuseMerge(job, MERGE_REFUSED_CAUSES.gitFailed, merge.verdict === 'git-failed' ? merge.reason : 'unknown commit');
    return true;
  }

  async function settleResolver(job: Readonly<Job>, agent: Readonly<Job>): Promise<boolean> {
    const reading = context.mergeAgentReadingOf(agent);
    if (agent.state === 'running' && reading.calls >= context.limits.RESOLVER_API_CALL_BUDGET) {
      await context.stopMergeAgent(agent);
      await refuseMerge(job, MERGE_REFUSED_CAUSES.outOfCalls, `The resolver reached its ${context.limits.RESOLVER_API_CALL_BUDGET} calls.`);
      return true;
    }
    if (agent.state !== 'verifying') return false;
    // Its report is in: nothing else closes a merge agent's session, so the runner stops it before settling the slot.
    await context.stopMergeAgent(agent);
    const notes     = String(reportFieldOf(reading.report, 'notes') ?? '');
    const outcome    = reportFieldOf(reading.report, 'outcome');
    const worktree   = slotWorktreeOf(job);
    if (outcome === 'cannot-resolve') {
      await refuseMerge(job, MERGE_REFUSED_CAUSES.cannotResolve, notes, reportFieldOf(reading.report, 'reportKind') ?? null);
      return true;
    }
    if (outcome !== 'resolved') {
      await refuseMerge(job, MERGE_REFUSED_CAUSES.noReport, notes);
      return true;
    }
    const resolvedFiles = reportFieldOf(reading.report, 'resolvedFiles');
    if (!MergeRun.resolutionIsSound(worktree, MergeRun.sidesOf(job, slotOf(job)), Array.isArray(resolvedFiles) ? resolvedFiles.map(String) : [])) {
      await refuseMerge(job, MERGE_REFUSED_CAUSES.unresolved, notes);
      return true;
    }
    const resolutionLines = MergeRun.resolutionLinesOf(worktree) ?? Number.POSITIVE_INFINITY;
    const overThreshold   = resolutionLines > context.limits.RESOLUTION_REVIEW_THRESHOLD_LINES;
    await context.hold((hold) => {
      hold.board.endJob(agent.id, { outcome: 'resolved', ...(MergeRun.headOf(worktree) === null ? {} : { commit: MergeRun.headOf(worktree) ?? '' }) }, hold.at);
      if (!overThreshold) {
        setPhase(hold, job, 'gating');
        return;
      }
      setPhase(hold, job, 'reviewing-resolution');
      const facts = {
        lines:       String(resolutionLines),
        files:       Array.isArray(resolvedFiles) ? resolvedFiles.map(String).join(', ') : '',
        tree:        MergeRun.treeOf(worktree) ?? '',
        mergeCommit: MergeRun.headOf(worktree) ?? '',
      };
      context.keepAirlockFacts(job, facts);
      hold.board.openIncident({
        kind: 'resolution-over-threshold', ticketIds: job.ticketIds, jobId: job.id, facts, defaultMove: 'merge-review',
      }, hold.at);
    });
    return true;
  }

  async function runResolving(job: Readonly<Job>): Promise<boolean> {
    const agent = await context.hold((hold) => mergeAgentOf(hold.board, job));
    // An unfinished resolver keeps the slot, interrupted or not: it resumes into the merge left on disk.
    if (agent !== undefined) return settleResolver(job, agent);
    // Its resolver ended with no usable result (replaced or stopped): the slot is orphaned, whatever the merge left on disk.
    await freeSlot(job, { outcome: 'stopped', cause: REQUEUE_CAUSES.orphaned });
    return true;
  }

  async function runGate(job: Readonly<Job>, hasOpenIncident: boolean): Promise<boolean> {
    if (hasOpenIncident) return false;
    const worktree = slotWorktreeOf(job);
    const treeId   = MergeRun.treeOf(worktree);
    if (treeId === null) {
      await refuseMerge(job, MERGE_REFUSED_CAUSES.gitFailed, 'The merged tree cannot be read.');
      return true;
    }
    const landsUngated = await context.hold((hold) => {
      if (!mergedTreeWasLastPassed(hold.board, worktree, job, treeId)) return false;
      setPhase(hold, job, 'landing');
      return true;
    });
    if (landsUngated) return true;
    const { outcome, step, output } = await context.gateMergedTree(worktree, treeId);
    const fixersSpent = await context.hold((hold) => {
      if (outcome !== 'setup-failed') hold.board.recordGateRan({ tree: treeId, outcome, cached: false }, hold.at);
      const fixer = mergeAgentOf(hold.board, job);
      if (outcome === 'passed') {
        if (fixer !== undefined) hold.board.endJob(fixer.id, { outcome: 'resolved', commit: MergeRun.headOf(worktree) ?? treeId }, hold.at);
        setPhase(hold, job, 'landing');
        return false;
      }
      if (outcome === 'failed' && fixer !== undefined) return resumeOrSpendTheFixer(hold, job, fixer, { step: step ?? '', output, worktree });
      if (outcome === 'failed' && launchesUnder(hold.board, job, 'merge-fix') >= context.limits.MERGE_FIX_ATTEMPTS) return true;
      const facts = { tree: treeId, gate: step ?? '', gateTail: tailOf(output, context.limits.CHECK_OUTPUT_TAIL_LINES) };
      if (outcome === 'failed') context.keepAirlockFacts(job, facts);
      hold.board.openIncident({
        kind:        MERGE_GATE_INCIDENT_KINDS[outcome],
        ticketIds:   job.ticketIds,
        jobId:       job.id,
        facts,
        defaultMove: outcome === 'failed' ? 'merge-abort' : 'gate-retry',
      }, hold.at);
      return false;
    });
    if (fixersSpent) await abortAndPark(job, 'merge-gate-failed', tailOf(output, context.limits.CHECK_OUTPUT_TAIL_LINES));
    return true;
  }

  /**
   * A fixer whose fix left the merged tree red is resumed in its own session, handed the gate's failure, while its handoff cycle has resumes
   * left; past them it ends `failed` and the merge parks. Returns whether the fixers are spent.
   */
  function resumeOrSpendTheFixer(hold: MergeSlotHold, job: Readonly<Job>, fixer: Readonly<Job>, red: { step: string; output: string; worktree: string }): boolean {
    const resumes = redResumesOf(hold.board, fixer);
    if (resumes >= context.redHandoffResumes) {
      hold.board.endJob(fixer.id, { outcome: 'failed', cause: RED_RESUMES_SPENT_CAUSE }, hold.at);
      return true;
    }
    const fixerFolder = context.jobFolderOf(fixer);
    RedHandoff.writeRedHandoff(fixerFolder, {
      kind:                'gate',
      name:                red.step,
      command:             null,
      fixCommand:          null,
      commit:              MergeRun.headOf(red.worktree) ?? '',
      exitCode:            null,
      handoverPath:        RedHandoff.handoverPathOf(fixerFolder),
      fullLogPath:         null,
      resume:              resumes + 1,
      resumesAllowed:      context.redHandoffResumes,
      callBudget:          RED_HANDOFF_RESUME_CALL_BUDGET,
      interruptedInstance: fixer.hostInstance,
    }, red.output);
    hold.board.interruptJob(fixer.id, HANDOFF_RED_INTERRUPTION, hold.at);
    setPhase(hold, job, 'fixing');
    return false;
  }

  /** The merge aborts, the slot frees and the ticket is held `parked:<cause>` with a `parked` decision; a refresh has no ticket, so User is asked. */
  async function abortAndPark(job: Readonly<Job>, cause: AirlockParkCause, notes: string): Promise<boolean> {
    if (isRefresh(job)) {
      await refuseMerge(job, cause, notes);
      return true;
    }
    const ticketId = ticketIdOf(job);
    await freeSlot(job, { outcome: 'failed', cause }, (hold) => {
      hold.board.setTicketMergeQueued(ticketId, false, hold.at);
      hold.board.holdTicket(ticketId, `${PARKED_HOLD_PREFIX}${cause}`, hold.at);
      openDecision(hold, 'parked', [ticketId], notes);
    });
    return true;
  }

  /** A merge-gate fixer or a resolution reviewer, launched once its incident's move or default let the slot go on, and settled by its report. */
  async function runAirlockAgent(job: Readonly<Job>, hasOpenIncident: boolean, role: AirlockAgentRole): Promise<boolean> {
    if (hasOpenIncident) return false;
    const { agent, launched } = await context.hold((hold) => ({ agent: mergeAgentOf(hold.board, job), launched: launchesUnder(hold.board, job, role) }));
    if (agent !== undefined) return settleAirlockAgent(job, agent, role);
    const attempts = role === 'merge-fix' ? context.limits.MERGE_FIX_ATTEMPTS : 1;
    if (launched >= attempts) {
      // Its agent ended with no usable result (replaced or stopped): the slot is orphaned, as a resolver's would be.
      await freeSlot(job, { outcome: 'stopped', cause: REQUEUE_CAUSES.orphaned });
      return true;
    }
    await context.hold((hold) => hold.board.launchJob({
      kind: 'merge-agent', role, ticketIds: job.ticketIds, parentJobId: job.id, attempt: launched + 1, target: slotOf(job).target,
    }, hold.at));
    return true;
  }

  /**
   * At its budget or on `cannot-resolve` with a `reportKind` the merge is refused as a resolver's is; a fixer's `resolved` and a reviewer's
   * `resolved` (its claims hold) gate the merged tree again; a reviewer's plain `cannot-resolve` rejects the resolution and parks.
   */
  async function settleAirlockAgent(job: Readonly<Job>, agent: Readonly<Job>, role: AirlockAgentRole): Promise<boolean> {
    const reading = context.mergeAgentReadingOf(agent);
    const budget  = role === 'merge-fix' ? await context.hold((hold) => fixerBudgetOf(hold.board, agent)) : context.limits.RESOLUTION_REVIEWER_API_CALL_BUDGET;
    if (agent.state === 'running' && reading.calls >= budget) {
      await context.stopMergeAgent(agent);
      await refuseMerge(job, MERGE_REFUSED_CAUSES.outOfCalls, `The ${role} agent reached its ${budget} calls.`);
      return true;
    }
    if (agent.state !== 'verifying') return false;
    await context.stopMergeAgent(agent);
    const notes      = String(reportFieldOf(reading.report, 'notes') ?? '');
    const outcome    = reportFieldOf(reading.report, 'outcome');
    const reportKind = reportFieldOf(reading.report, 'reportKind') ?? null;
    if (outcome === 'cannot-resolve' && role === 'resolution-review' && reportKind === null) return abortAndPark(job, 'merge-resolution-rejected', notes);
    if (outcome !== 'resolved') {
      await refuseMerge(job, outcome === 'cannot-resolve' ? MERGE_REFUSED_CAUSES.cannotResolve : MERGE_REFUSED_CAUSES.noReport, notes, reportKind);
      return true;
    }
    const worktree = slotWorktreeOf(job);
    await context.hold((hold) => {
      const head = MergeRun.headOf(worktree);
      // A fixer waits through the gate of its fix, so a red one resumes the same session; the gate's pass ends it `resolved`.
      if (role === 'merge-fix') hold.board.moveJob(agent.id, 'gating', hold.at);
      else hold.board.endJob(agent.id, { outcome: 'resolved', ...(head === null ? {} : { commit: head }) }, hold.at);
      setPhase(hold, job, 'gating');
    });
    return true;
  }

  /** A fixer resumed after a red gate has the short resume budget, its calls counted from the resume. */
  function fixerBudgetOf(board: Board, agent: Readonly<Job>): number {
    return redResumesOf(board, agent) > 0 ? RED_HANDOFF_RESUME_CALL_BUDGET : context.limits.MERGE_FIXER_API_CALL_BUDGET;
  }

  function currentBranchIn(directory: string): string | null {
    const branch = readCurrentBranch(directory);
    return branch.verdict === 'on-branch' ? branch.branch : null;
  }

  /** Rechecked every sweep: each held target's checkout back on its branch with nothing uncommitted clears its notice. */
  function recheckHeldTargets(): void {
    for (const target of [...heldTargets.keys()]) {
      const directory = target === mainLine ? context.repositoryRoot : GroupWorktrees.groupWorktreeOf(context.worktreesRoot, target);
      if (currentBranchIn(directory) === target && (uncommittedPathsOf(directory) ?? ['?']).length === 0) heldTargets.delete(target);
    }
  }

  /** What the landing does on the board once git moved the target: deliver, approve a group's ticket, or record a refresh. */
  function landOnTheBoard(hold: MergeSlotHold, job: Readonly<Job>, commit: string): void {
    const slot     = slotOf(job);
    const ticketId = ticketIdOf(job);
    if (isRefresh(job)) {
      hold.board.recordMergeLanded(job.id, { target: slot.target, commit, kind: 'integrated' }, hold.at);
      hold.board.endJob(job.id, { outcome: 'refreshed', commit }, hold.at);
      return;
    }
    if (slot.target !== mainLine) {
      hold.board.moveTicket(ticketId, 'reviewed', { checksLegality: true }, hold.at);
      hold.board.recordMergeLanded(job.id, { target: slot.target, commit, kind: 'integrated' }, hold.at);
      hold.board.endJob(job.id, { outcome: 'integrated', commit }, hold.at);
      return;
    }
    const tickets  = hold.board.tickets();
    const group    = tickets.find((candidate) => candidate.frontmatter.id === ticketId)?.frontmatter.group;
    // The bundle's integrated tickets go with the release; one delivered already stays as it is.
    const released = group === undefined ? [] : hold.board.releaseBundleTicketIdsOf(group).filter((bundleTicketId) => (
      bundleTicketId !== ticketId && tickets.some((candidate) => candidate.frontmatter.id === bundleTicketId && candidate.frontmatter.status === 'reviewed')
    ));
    hold.board.releaseTickets([ticketId, ...released], { branch: `ticket-${ticketId}`, commit }, hold.at);
    hold.board.recordMergeLanded(job.id, { target: mainLine, commit, kind: 'landed' }, hold.at);
    hold.board.endJob(job.id, { outcome: 'landed', commit }, hold.at);
  }

  /** After the landing hold: a refresh's temporary worktree goes, and a release removes the group's worktree and deletes its branch. */
  function cleanUpAfterLanding(job: Readonly<Job>, releasedGroup: string | undefined): void {
    if (isRefresh(job)) removeRefreshWorktree(job);
    if (releasedGroup === undefined) return;
    const groupBranch = `${groupTargetPrefix}${releasedGroup}`;
    const reason      = GroupWorktrees.removeGroup(context.repositoryRoot, context.worktreesRoot, groupBranch);
    if (reason !== null) context.reportDeclinedCleanup({ cleanup: 'release', groupBranch, reason });
  }

  async function runLanding(job: Readonly<Job>): Promise<boolean> {
    const ticketId     = ticketIdOf(job);
    const slot         = slotOf(job);
    const mergedCommit = MergeRun.headOf(slotWorktreeOf(job));
    const directory    = targetDirectoryOf(slot.target);
    if (mergedCommit === null || directory === null) {
      await refuseMerge(job, MERGE_REFUSED_CAUSES.gitFailed, mergedCommit === null ? 'The merged commit cannot be read.' : `The ${slot.target} worktree cannot be prepared.`);
      return true;
    }
    let releasedGroup: string | undefined = undefined;
    const landed = await context.hold((hold) => {
      const ticket = hold.board.tickets().find((candidate) => candidate.frontmatter.id === ticketId);
      const ticketRefusal = ticket === undefined ? null : Landing.ticketRefusalOf([ticket]);
      if (ticketRefusal !== null) return ticketRefusal;
      const verdict = Landing.landOnTarget({
        target:            { branch: slot.target, directory },
        mergedCommit,
        expectedTargetTip: slot.targetTip,
        recordedLandings:  hold.board.recordedLandingsOn(slot.target),
        hookPolicy:        'hooks-off',
      });
      if (verdict.verdict === 'refused') return verdict;
      if (slot.target === mainLine && ticket?.frontmatter.releasesGroup === true) releasedGroup = ticket.frontmatter.group;
      landOnTheBoard(hold, job, verdict.commit);
      return verdict;
    });
    if (landed.verdict !== 'refused') {
      cleanUpAfterLanding(job, releasedGroup);
      return true;
    }
    switch (LANDING_OUTCOME_OF_REFUSAL[landed.reason]) {
      case 'requeue-from-branch-tip':
        await freeSlot(job, { outcome: 'stopped', cause: 'target-moved-by-a-recorded-landing' });
        return true;
      case 'open-target-moved':
        return settleMovedTarget(job, landed.facts.targetTip ?? '');
      case 'hold-target':
        heldTargets.set(slot.target, { target: slot.target, branch: currentBranchIn(directory), blockingFiles: landed.facts.blockingFiles ?? [] });
        await freeSlot(job, { outcome: 'stopped', cause: REQUEUE_CAUSES.targetHeld });
        return true;
      case 'hold-ticket':
        await freeSlot(job, { outcome: 'failed', cause: landed.reason }, (hold) => {
          hold.board.setTicketMergeQueued(ticketId, false, hold.at);
          hold.board.holdTicket(ticketId, `${LANDING_REFUSED_DECISION}:${landed.reason}`, hold.at);
          openDecision(hold, LANDING_REFUSED_DECISION, [ticketId], landed.reason);
        });
        return true;
      case 'finish-board-side':
        return true;
    }
  }

  /** Q38: requeued silently while the ref denies hold, parked after TARGET_MOVED_MERGES_BEFORE_PARKING moves in a row; else one decision per tip. */
  async function settleMovedTarget(job: Readonly<Job>, newTip: string): Promise<boolean> {
    const ticketId = ticketIdOf(job);
    if (!context.refDeniesHold) {
      return context.hold((hold) => {
        if (hold.board.decisions().some((decision) => decision.kind === 'target-moved' && decision.context === newTip)) return false;
        openDecision(hold, 'target-moved', [], newTip);
        return true;
      });
    }
    await freeSlot(job, { outcome: 'stopped', cause: REQUEUE_CAUSES.targetMoved }, (hold) => {
      if (isRefresh(job) || targetMovesInARowOf(hold.board, ticketId) < context.limits.TARGET_MOVED_MERGES_BEFORE_PARKING) return;
      hold.board.holdTicket(ticketId, `${PARKED_HOLD_PREFIX}target-moved`, hold.at);
      openDecision(hold, 'parked', [ticketId], REQUEUE_CAUSES.targetMoved);
    });
    return true;
  }

  async function advance(job: Readonly<Job>, hasOpenIncident: boolean): Promise<boolean> {
    switch (slotOf(job).phase) {
      case 'merge-in':
        return runMergeIn(job);
      case 'resolving':
        return runResolving(job);
      case 'gating':
        return runGate(job, hasOpenIncident);
      case 'landing':
        return runLanding(job);
      case 'reviewing-resolution':
        return runAirlockAgent(job, hasOpenIncident, 'resolution-review');
      case 'fixing':
        return runAirlockAgent(job, hasOpenIncident, 'merge-fix');
    }
  }

  /** A parked candidate, by its incident's `merge abort` default or a `ticket park`, gives up the slot: the merge aborts and it leaves the queue. */
  async function abortParkedMerge(job: Readonly<Job>): Promise<boolean> {
    await freeSlot(job, { outcome: 'stopped', cause: MERGE_ABORTED_CAUSE }, (hold) => {
      job.ticketIds.forEach((ticketId) => hold.board.setTicketMergeQueued(ticketId, false, hold.at));
    });
    return true;
  }

  async function advanceTheSlot(target: string): Promise<boolean> {
    const holding = await context.hold((hold) => {
      const job = hold.board.mergeSlotHolderOf(target);
      if (job === undefined) return null;
      const parked = job.ticketIds.some((ticketId) => hold.board.ticketByReference(ticketId)?.frontmatter.hold?.startsWith(PARKED_HOLD_PREFIX) === true);
      return { job, parked, hasOpenIncident: hold.board.incidents().some((incident) => incident.jobId === job.id) };
    });
    if (holding === null || holding.job.slot === undefined) return false;
    if (holding.parked && !holding.hasOpenIncident) return abortParkedMerge(holding.job);
    return advance(holding.job, holding.hasOpenIncident);
  }

  function predictionOf(target: string, candidate: MergeCandidate): { candidate: MergeCandidate; branchTip: string | null; conflictedFiles: string[] | null } {
    const branch    = `ticket-${candidate.ticketId}`;
    const branchTip = GitProcess.resolvedCommitOf(context.repositoryRoot, `refs/heads/${branch}`);
    const predicted = predictMerge(context.repositoryRoot, { target, branch });
    return { candidate, branchTip, conflictedFiles: predicted.verdict === 'clean' ? [] : predicted.verdict === 'conflicting' ? predicted.conflictedFiles : null };
  }

  /** Design section 6.2's order: priority, clean first, fewest conflicts caused among the clean, readiness, ticket id. */
  function orderedPredictions(target: string, candidates: readonly MergeCandidate[]): ReturnType<typeof predictionOf>[] {
    const predictions = candidates.map((candidate) => predictionOf(target, candidate)).filter((prediction) => prediction.branchTip !== null);
    const clean       = predictions.filter((prediction) => prediction.conflictedFiles?.length === 0);
    const conflictsCaused = new Map(predictions.map((prediction) => {
      const others = clean.filter((other) => other.candidate.ticketId !== prediction.candidate.ticketId);
      const pairs  = others.map((other) => ({ target: `ticket-${other.candidate.ticketId}`, branch: `ticket-${prediction.candidate.ticketId}` }));
      return [prediction.candidate.ticketId, predictMerges(context.repositoryRoot, pairs).filter((pair) => pair.verdict !== 'clean').length];
    }));
    const isClean = (prediction: ReturnType<typeof predictionOf>): number => (prediction.conflictedFiles?.length === 0 ? 0 : 1);
    return predictions.sort((a, b) => (
      MERGE_PRIORITY_RANK[a.candidate.priority] - MERGE_PRIORITY_RANK[b.candidate.priority]
      || isClean(a) - isClean(b)
      || (conflictsCaused.get(a.candidate.ticketId) ?? 0) - (conflictsCaused.get(b.candidate.ticketId) ?? 0)
      || a.candidate.readiness - b.candidate.readiness
      || Number(a.candidate.ticketId) - Number(b.candidate.ticketId)
    ));
  }

  /** A refused claim (a higher priority queued meanwhile, the slot taken, a release queued) is derived again in the next round. */
  function claimed(claim: () => void): boolean {
    try {
      claim();
      return true;
    } catch (refusal) {
      if (refusal instanceof BoardRefusal) return true;
      throw refusal;
    }
  }

  /** Due as MergeQueueUtil says, never while a refused refresh of the group waits for User or main holds nothing the group lacks. */
  function refreshIsDue(target: string, releaseIsQueuedOrSlotted: boolean, refreshWasRefused: boolean): boolean {
    if (refreshWasRefused) return false;
    const count = GitProcess.run(context.repositoryRoot, ['rev-list', '--count', `${target}..${mainLine}`]);
    const mainCommitsAheadOfGroup = GitProcess.succeeded(count) ? Number(count.standardOutput.trim()) : null;
    if (mainCommitsAheadOfGroup === 0) return false;
    return MergeQueueUtil.groupRefreshIsDue({
      mainCommitsAheadOfGroup,
      groupTipAgainstMain:            forecastOf(predictMerge(context.repositoryRoot, { target, branch: mainLine })),
      releaseTicketIsQueuedOrSlotted: releaseIsQueuedOrSlotted,
    }, context.limits);
  }

  async function allocateRefresh(target: string, releaseIsQueuedOrSlotted: boolean, refreshWasRefused: boolean): Promise<boolean> {
    const targetTip = GitProcess.resolvedCommitOf(context.repositoryRoot, `refs/heads/${target}`);
    const mainTip   = GitProcess.resolvedCommitOf(context.repositoryRoot, `refs/heads/${mainLine}`);
    if (targetTip === null || mainTip === null || !refreshIsDue(target, releaseIsQueuedOrSlotted, refreshWasRefused)) return false;
    return context.hold((hold) => {
      const tipsMoved = GitProcess.resolvedCommitOf(context.repositoryRoot, `refs/heads/${target}`) !== targetTip
        || GitProcess.resolvedCommitOf(context.repositoryRoot, `refs/heads/${mainLine}`) !== mainTip;
      return tipsMoved || claimed(() => hold.board.claimRefreshSlot({
        group: groupOf(target), target, targetTip, mainTip
      }, hold.at));
    });
  }

  async function allocate(target: string): Promise<boolean> {
    if (heldTargets.has(target) || context.dispatchIsStopped()) return false;
    const queue = await context.hold((hold) => {
      if (hold.board.mergeSlotHolderOf(target) !== undefined) return null;
      const isGroup = target !== mainLine;
      return {
        candidates:               hold.board.mergeCandidatesOf(target, targetOf),
        releaseIsQueuedOrSlotted: isGroup && hold.board.groupReleaseQueuedOrSlotted(groupOf(target)) !== null,
        refreshWasRefused:        isGroup && hold.board.decisions().some((decision) => (
          decision.kind === 'merge-refused' && decision.ticketIds.length === 0 && decision.context.startsWith(`${target}${REFRESH_REFUSAL_SEPARATOR}`)
        )),
      };
    });
    if (queue === null) return false;
    if (target !== mainLine && await allocateRefresh(target, queue.releaseIsQueuedOrSlotted, queue.refreshWasRefused)) return true;
    const [first] = orderedPredictions(target, queue.candidates);
    if (first?.branchTip === undefined || first.branchTip === null) return false;
    const targetTip = GitProcess.resolvedCommitOf(context.repositoryRoot, `refs/heads/${target}`);
    if (targetTip === null) return false;
    const { branchTip } = first;
    return context.hold((hold) => {
      const tipsMoved = GitProcess.resolvedCommitOf(context.repositoryRoot, `refs/heads/${target}`) !== targetTip
        || GitProcess.resolvedCommitOf(context.repositoryRoot, `refs/heads/ticket-${first.candidate.ticketId}`) !== branchTip;
      return tipsMoved || claimed(() => hold.board.claimMergeSlot({
        ticketId: first.candidate.ticketId, target, targetTip, branchTip, predictedConflictFiles: first.conflictedFiles ?? [],
      }, targetOf, hold.at));
    });
  }

  /** The main line, every group with an open ticket, and every target a slot still holds. */
  async function liveTargets(): Promise<string[]> {
    return context.hold((hold) => {
      const targets = new Set([mainLine]);
      for (const { frontmatter } of hold.board.tickets()) {
        if (frontmatter.group !== undefined && frontmatter.status !== 'delivered' && frontmatter.status !== 'abandoned') targets.add(`${groupTargetPrefix}${frontmatter.group}`);
      }
      for (const job of hold.board.jobs()) if ((job.kind === 'merge' || isRefresh(job)) && job.target !== null) targets.add(job.target);
      return [...targets];
    });
  }

  async function sweep(): Promise<readonly HeldTarget[]> {
    recheckHeldTargets();
    for (let round = 0; round < ROUNDS_PER_SWEEP; round += 1) {
      let moved = false;
      for (const target of await liveTargets()) {
        const advanced  = await advanceTheSlot(target);
        const allocated = await allocate(target);
        moved = moved || advanced || allocated;
      }
      if (!moved) break;
    }
    return [...heldTargets.values()];
  }

  return { sweep };
}
