/**
 * The main line's merge slot, run by the runner after each pass (design section 6): allocation, the one merge-in against the recorded tip,
 * a resolver for a conflict git cannot settle, the gate on the merged tree and the compare-and-swap landing. Every phase is written on the
 * merge job's slot in its own hold, and every outcome ends the job or opens what User or the orchestrator answers, so nothing loops.
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
import type { MergeCandidate }                 from '../../lib/tracker-model/MergeSlotClaims.ts';
import { MERGE_PRIORITY_RANK }                 from '../../lib/tracker-model/MergeSlotClaims.ts';
import { PARKED_HOLD_PREFIX }                  from '../../lib/tracker-model/constants/DecisionAndIncidentVocabulary.ts';
import type { MergeSlotLimits }                from '../../shared/constants/MergeSlotLimits.ts';
import { LANDING_OUTCOME_OF_REFUSAL, Landing } from '../lifecycle/Landing.ts';
import { MergeRun }                            from '../lifecycle/MergeRun.ts';

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
  repositoryRoot:      string;
  mainLine:            string;
  groupTargetPrefix:   string;
  worktreeOf:          (ticketId: string) => string;
  limits:              MergeSlotLimits;
  /** T1b-P14's finding: with the per-job ref denies holding, a target moved by someone else requeues silently. */
  refDeniesHold:       boolean;
  hold:                MergeSlotHoldRunner;
  gateMergedTree:      (worktreePath: string, treeId: string) => Promise<GateOutcome>;
  mergeAgentReadingOf: (job: Readonly<Job>) => MergeAgentReading;
  /** The job's own host, an agent's or a process host's, is alive. */
  hostIsLive:          (job: Readonly<Job>) => boolean;
  stopMergeAgent:      (job: Readonly<Job>) => Promise<void>;
  decisionWordingOf:   (draft: DecisionDraft) => DecisionWording;
  /** `run pause` opens no new slot; a slot already open finishes. */
  dispatchIsStopped:   () => boolean;
}

/** The `dirty-main-checkout` notice: the main checkout's branch, or the files blocking the fast-forward. */
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
  outOfCalls:    'out-of-calls',
  cannotResolve: 'cannot-resolve',
  unresolved:    'merge-unresolved',
  noReport:      'no-report',
  gitFailed:     'git-failed',
} as const;

/** The causes a merge job ends with when it frees its slot and its ticket waits in the queue again. */
const REQUEUE_CAUSES = { orphaned: 'orphaned', targetMoved: 'target-moved', targetHeld: 'target-held' } as const;

const LANDING_REFUSED_DECISION: DecisionKind = 'landing-refused';

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

export function createMergeSlots(context: MergeSlotsContext): MergeSlots {
  const { mainLine } = context;
  const targetOf     = (group: string | undefined): string => (group === undefined ? mainLine : `${context.groupTargetPrefix}${group}`);
  let heldTarget: HeldTarget | null = null;

  function openDecision(hold: MergeSlotHold, kind: DecisionKind, ticketIds: readonly string[], decisionContext: string): void {
    const draft: DecisionDraft = { kind, ticketIds, jobId: null };
    hold.board.openDecision({
      ...draft, askedBy: 'runner', requestId: null, questions: context.decisionWordingOf(draft).questions, context: decisionContext
    }, hold.at);
  }

  function setPhase(hold: MergeSlotHold, job: Readonly<Job>, phase: SlotPhase): void {
    hold.board.setJobSlot(job.id, { ...slotOf(job), phase });
  }

  /** Frees the slot with the worktree back at the recorded branch tip; the ticket stays queued unless the caller took it out. */
  async function freeSlot(job: Readonly<Job>, ending: JobEnding, inHold: (hold: MergeSlotHold) => void = () => undefined): Promise<void> {
    MergeRun.restoreBranchTip(context.worktreeOf(ticketIdOf(job)), slotOf(job).branchTip);
    await context.hold((hold) => {
      const agent = mergeAgentOf(hold.board, job);
      if (agent !== undefined) hold.board.endJob(agent.id, { outcome: 'stopped', cause: ending.cause ?? 'merge-ended' }, hold.at);
      hold.board.endJob(job.id, ending, hold.at);
      inHold(hold);
    });
  }

  /** The merge aborts, the slot frees and User is asked; a `reportKind` also opens the orchestrator's incident, with no job waiting. */
  async function refuseMerge(job: Readonly<Job>, cause: string, notes: string, reportKind: unknown = null): Promise<void> {
    const ticketId = ticketIdOf(job);
    await freeSlot(job, { outcome: 'failed', cause }, (hold) => {
      hold.board.setTicketMergeQueued(ticketId, false, hold.at);
      openDecision(hold, 'merge-refused', [ticketId], notes);
      if (reportKind !== 'malformed-ticket' && reportKind !== 'system-blocker') return;
      hold.board.openIncident({
        kind:        reportKind === 'malformed-ticket' ? 'malformed-ticket' : 'system-question',
        ticketIds:   [ticketId],
        jobId:       null,
        facts:       { notes, mergeJobId: job.id },
        defaultMove: 'incident-escalate',
      }, hold.at);
    });
  }

  async function runMergeIn(job: Readonly<Job>): Promise<boolean> {
    const worktree = context.worktreeOf(ticketIdOf(job));
    const slot     = slotOf(job);
    if (MergeRun.mergeIsInProgress(worktree)) {
      // A live holder keeps its slot; only a merge-in left behind by nobody is aborted and requeued.
      if (context.hostIsLive(job)) return false;
      await freeSlot(job, { outcome: 'stopped', cause: REQUEUE_CAUSES.orphaned });
      return true;
    }
    const merge = MergeRun.mergeInOnce(worktree, slot);
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
    const notes      = String(reportFieldOf(reading.report, 'notes') ?? '');
    const outcome    = reportFieldOf(reading.report, 'outcome');
    const worktree   = context.worktreeOf(ticketIdOf(job));
    if (outcome === 'cannot-resolve') {
      await refuseMerge(job, MERGE_REFUSED_CAUSES.cannotResolve, notes, reportFieldOf(reading.report, 'reportKind') ?? null);
      return true;
    }
    if (outcome !== 'resolved') {
      await refuseMerge(job, MERGE_REFUSED_CAUSES.noReport, notes);
      return true;
    }
    const resolvedFiles = reportFieldOf(reading.report, 'resolvedFiles');
    if (!MergeRun.resolutionIsSound(worktree, slotOf(job), Array.isArray(resolvedFiles) ? resolvedFiles.map(String) : [])) {
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
      hold.board.openIncident({
        kind:        'resolution-over-threshold',
        ticketIds:   job.ticketIds,
        jobId:       job.id,
        facts:       { lines: String(resolutionLines), files: Array.isArray(resolvedFiles) ? resolvedFiles.map(String).join(', ') : '' },
        defaultMove: 'merge-review',
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
    const worktree = context.worktreeOf(ticketIdOf(job));
    const treeId   = MergeRun.treeOf(worktree);
    if (treeId === null) {
      await refuseMerge(job, MERGE_REFUSED_CAUSES.gitFailed, 'The merged tree cannot be read.');
      return true;
    }
    const outcome = await context.gateMergedTree(worktree, treeId);
    await context.hold((hold) => {
      hold.board.recordGateRan({ tree: treeId, outcome, cached: false }, hold.at);
      if (outcome === 'passed') {
        setPhase(hold, job, 'landing');
        return;
      }
      hold.board.openIncident({
        kind:        outcome === 'failed' ? 'merge-gate-failed' : 'gate-cannot-run',
        ticketIds:   job.ticketIds,
        jobId:       job.id,
        facts:       { tree: treeId },
        defaultMove: outcome === 'failed' ? 'merge-abort' : 'gate-retry',
      }, hold.at);
    });
    return true;
  }

  function targetHeldBy(branch: string | null, blockingFiles: readonly string[]): HeldTarget {
    return { target: mainLine, branch, blockingFiles };
  }

  /** Rechecked every sweep: the checkout back on the main line with nothing uncommitted clears the notice. */
  function recheckHeldTarget(): void {
    if (heldTarget === null) return;
    const branch = readCurrentBranch(context.repositoryRoot);
    const onMainLine = branch.verdict === 'on-branch' && branch.branch === mainLine;
    if (onMainLine && (uncommittedPathsOf(context.repositoryRoot) ?? ['?']).length === 0) heldTarget = null;
  }

  async function runLanding(job: Readonly<Job>): Promise<boolean> {
    const ticketId     = ticketIdOf(job);
    const slot         = slotOf(job);
    const mergedCommit = MergeRun.headOf(context.worktreeOf(ticketId));
    if (mergedCommit === null) {
      await refuseMerge(job, MERGE_REFUSED_CAUSES.gitFailed, 'The merged commit cannot be read.');
      return true;
    }
    const landed = await context.hold((hold) => {
      const ticket = hold.board.tickets().find((candidate) => candidate.frontmatter.id === ticketId);
      const ticketRefusal = ticket === undefined ? null : Landing.ticketRefusalOf(hold.board, [ticket]);
      if (ticketRefusal !== null) return ticketRefusal;
      const verdict = Landing.landOnTarget({
        target:            { branch: mainLine, directory: context.repositoryRoot },
        mergedCommit,
        expectedTargetTip: slot.targetTip,
        recordedLandings:  hold.board.recordedLandingsOn(mainLine),
        hookPolicy:        'hooks-off',
      });
      if (verdict.verdict === 'refused') return verdict;
      hold.board.releaseTickets([ticketId], { branch: `ticket-${ticketId}`, commit: verdict.commit }, hold.at);
      hold.board.recordMergeLanded(job.id, { target: mainLine, commit: verdict.commit, kind: 'landed' }, hold.at);
      hold.board.endJob(job.id, { outcome: 'landed', commit: verdict.commit }, hold.at);
      return verdict;
    });
    if (landed.verdict !== 'refused') return true;
    switch (LANDING_OUTCOME_OF_REFUSAL[landed.reason]) {
      case 'requeue-from-branch-tip':
        await freeSlot(job, { outcome: 'stopped', cause: 'target-moved-by-a-recorded-landing' });
        return true;
      case 'open-target-moved':
        return settleMovedTarget(job, landed.facts.targetTip ?? '');
      case 'hold-target':
        heldTarget = targetHeldBy(currentBranchOf(), landed.facts.blockingFiles ?? []);
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

  function currentBranchOf(): string | null {
    const branch = readCurrentBranch(context.repositoryRoot);
    return branch.verdict === 'on-branch' ? branch.branch : null;
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
      if (targetMovesInARowOf(hold.board, ticketId) < context.limits.TARGET_MOVED_MERGES_BEFORE_PARKING) return;
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
      case 'fixing':
        return false;
    }
  }

  async function advanceTheSlot(): Promise<boolean> {
    const holding = await context.hold((hold) => {
      const job = hold.board.mergeSlotHolderOf(mainLine);
      return job === undefined ? null : { job, hasOpenIncident: hold.board.incidents().some((incident) => incident.jobId === job.id) };
    });
    if (holding === null || holding.job.slot === undefined) return false;
    return advance(holding.job, holding.hasOpenIncident);
  }

  function predictionOf(candidate: MergeCandidate): { candidate: MergeCandidate; branchTip: string | null; conflictedFiles: string[] | null } {
    const branch    = `ticket-${candidate.ticketId}`;
    const branchTip = GitProcess.resolvedCommitOf(context.repositoryRoot, `refs/heads/${branch}`);
    const predicted = predictMerge(context.repositoryRoot, { target: mainLine, branch });
    return { candidate, branchTip, conflictedFiles: predicted.verdict === 'clean' ? [] : predicted.verdict === 'conflicting' ? predicted.conflictedFiles : null };
  }

  /** Design section 6.2's order: priority, clean first, fewest conflicts caused among the clean, readiness, ticket id. */
  function orderedPredictions(candidates: readonly MergeCandidate[]): ReturnType<typeof predictionOf>[] {
    const predictions = candidates.map(predictionOf).filter((prediction) => prediction.branchTip !== null);
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

  async function allocate(): Promise<boolean> {
    if (heldTarget !== null || context.dispatchIsStopped()) return false;
    const candidates = await context.hold((hold) => (hold.board.mergeSlotHolderOf(mainLine) === undefined ? hold.board.mergeCandidatesOf(mainLine, targetOf) : []));
    const [first] = orderedPredictions(candidates);
    if (first?.branchTip === undefined || first.branchTip === null) return false;
    const targetTip = GitProcess.resolvedCommitOf(context.repositoryRoot, `refs/heads/${mainLine}`);
    if (targetTip === null) return false;
    const { branchTip } = first;
    return context.hold((hold) => {
      const tipsMoved = GitProcess.resolvedCommitOf(context.repositoryRoot, `refs/heads/${mainLine}`) !== targetTip
        || GitProcess.resolvedCommitOf(context.repositoryRoot, `refs/heads/ticket-${first.candidate.ticketId}`) !== branchTip;
      if (tipsMoved) return true;
      try {
        hold.board.claimMergeSlot({
          ticketId: first.candidate.ticketId, target: mainLine, targetTip, branchTip, predictedConflictFiles: first.conflictedFiles ?? [],
        }, targetOf, hold.at);
        return true;
      } catch (refusal) {
        // A refused claim (a higher priority queued meanwhile, the slot taken) is derived again in the next round.
        if (refusal instanceof BoardRefusal) return true;
        throw refusal;
      }
    });
  }

  async function sweep(): Promise<readonly HeldTarget[]> {
    recheckHeldTarget();
    for (let round = 0; round < ROUNDS_PER_SWEEP; round += 1) {
      const advanced  = await advanceTheSlot();
      const allocated = await allocate();
      if (!advanced && !allocated) break;
    }
    return heldTarget === null ? [] : [heldTarget];
  }

  return { sweep };
}
