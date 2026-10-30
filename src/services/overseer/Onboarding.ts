/**
 * The Overseer's side of an onboarder job: a detached snapshot of the main line it reads, a profile writing only its Hatch with no network,
 * and the end of its pass. Once its Watcher is gone the pass is verified, a setup proposal's gates run twice on the snapshot and its caching is
 * checked, all outside the hold; the next hold opens `pipeline-proposal` with that record, or ends the job, and the snapshot is removed.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';

import type { AgentAdapter }                                              from '../../lib/agent-launch/AgentAdapter.ts';
import type { WorkerProfile }                                             from '../../lib/agent-launch/WorkerProfile.ts';
import { GitProcess }                                                     from '../../lib/git/GitProcess.ts';
import type { Job }                                                       from '../../lib/tracker-model/@types/Job.ts';
import type { DecisionDraft, DecisionWording }                            from '../../lib/tracker-model/@types/PlaybookStep.ts';
import type { Board }                                                     from '../../lib/tracker-model/Board.ts';
import { CachingChecks }                                                  from '../lifecycle/CachingChecks.ts';
import { launchSnapshotOf, clearCustoms, type LaunchSnapshot }            from '../lifecycle/Customs.ts';
import { OnboardingProposal, type OnboarderMode, type OnboardingOutcome } from '../lifecycle/OnboardingProposal.ts';
import { ProposalTwiceRun }                                               from '../lifecycle/ProposalTwiceRun.ts';
import type { TrackerChange }                                             from '../tracker/TrackerPipeline.ts';
import type { Workspace }                                                 from '../tracker/Workspace.ts';
import { WatcherFleet }                                                   from './WatcherFleet.ts';

const ONBOARDER_KIND = 'onboarder';

/** Under the worktrees root, one detached snapshot per onboarder job; the Overseer owns it, so it is never a leftover worktree. */
export const ONBOARDER_SNAPSHOT_FOLDER = 'onboard';

const SNAPSHOT_START_FILE = 'onboarder-start.json';

interface SnapshotStart {
  startCommit:    string;
  launchSnapshot: LaunchSnapshot;
}

export interface OnboardingContext {
  workspace:             Workspace;
  worktreesRoot:         string;
  mainLine:              string;
  agentAdapter:          AgentAdapter;
  /** A clock exception: the twice-run only records each gate's duration. */
  millisecondsNow:       () => number;
  stopGraceMilliseconds: number;
}

function isOnboarderJob(job: Readonly<Job>): boolean {
  return job.kind === ONBOARDER_KIND;
}

function snapshotDirectoryOf(worktreesRoot: string, jobId: string): string {
  return join(worktreesRoot, ONBOARDER_SNAPSHOT_FOLDER, jobId);
}

/** Taken once, at the main line's tip: every ref and HEAD then, which Customs holds the pass to. */
function prepareSnapshot(context: Pick<OnboardingContext, 'workspace' | 'worktreesRoot' | 'mainLine'>, job: Readonly<Job>): string {
  const snapshot = snapshotDirectoryOf(context.worktreesRoot, job.id);
  if (existsSync(snapshot)) return snapshot;
  mkdirSync(join(context.worktreesRoot, ONBOARDER_SNAPSHOT_FOLDER), { recursive: true });
  GitProcess.run(context.workspace.rootDirectory, ['worktree', 'add', '--detach', snapshot, context.mainLine]);
  const startCommit = GitProcess.resolvedCommitOf(snapshot, 'HEAD');
  const launchSnapshot = launchSnapshotOf(snapshot);
  const jobFolder = WatcherFleet.jobFolderOf(context.workspace.trackerDirectory, job.id);
  mkdirSync(jobFolder, { recursive: true });
  if (startCommit !== null && launchSnapshot !== null) writeFileSync(join(jobFolder, SNAPSHOT_START_FILE), `${JSON.stringify({ startCommit, launchSnapshot })}\n`);
  return snapshot;
}

function snapshotStartOf(trackerDirectory: string, jobId: string): SnapshotStart | null {
  try {
    return JSON.parse(readFileSync(join(WatcherFleet.jobFolderOf(trackerDirectory, jobId), SNAPSHOT_START_FILE), 'utf8')) as SnapshotStart;
  } catch {
    return null;
  }
}

/** What an onboarder's first message is filled from: `setup` with no pipeline, `advise` with one, and the gate runs logged so far. */
export interface OnboardingFacts {
  mode:        OnboarderMode;
  gateHistory: string[];
}

/** The newest gate runs `advise` reads its optimisations from. */
const GATE_HISTORY_RECORDS = 200;

function onboardingFactsOf(board: Board, job: Readonly<Job>): OnboardingFacts | null {
  if (!isOnboarderJob(job)) return null;
  const gateHistory = board.logRecordsSoFar()
    .flatMap((record) => (record.kind === 'gate-ran' ? [`${record.at} ${record.fields.outcome}${record.fields.cached ? ' (cached)' : ''} tree ${record.fields.tree}`] : []))
    .slice(-GATE_HISTORY_RECORDS);
  return { mode: board.pipeline() === null ? 'setup' : 'advise', gateHistory };
}

/** It reads the snapshot and writes only its Hatch, the Hatch folder; no network, no question, no skill. */
function onboarderProfileOf(sessionProfile: WorkerProfile, hatchDirectory: string): WorkerProfile {
  return {
    ...sessionProfile, writableRoots: [hatchDirectory], bashNetworkDomains: [], webNetworkDomains: 'none', askUser: false, skills: false, networkDomainGuard: null
  };
}

function reportOf(context: OnboardingContext, job: Readonly<Job>): unknown {
  const jobFolder = WatcherFleet.jobFolderOf(context.workspace.trackerDirectory, job.id);
  let report: unknown = undefined;
  for (let instance = 1; instance <= job.watcherInstance; instance += 1) {
    const entries = WatcherFleet.eventsAfter(jobFolder, instance, 0);
    if (entries === 'malformed') continue;
    for (const entry of entries.filter((logged) => logged.origin === 'agent')) {
      for (const event of context.agentAdapter.eventsOf(entry.line)) if (event.kind === 'result') report = event.structuredReport;
    }
  }
  return report;
}

async function settledOutcomeOf(context: OnboardingContext, board: Board, job: Readonly<Job>): Promise<OnboardingOutcome> {
  const snapshot = snapshotDirectoryOf(context.worktreesRoot, job.id);
  const start = snapshotStartOf(context.workspace.trackerDirectory, job.id);
  if (start === null) return {
    verdict: 'refused', check: 'V16', reason: 'git-failed', facts: ['no snapshot start']
  };
  const report = reportOf(context, job);
  const verdict = clearCustoms({
    role:             'onboarder',
    worktreePath:     snapshot,
    startCommit:      start.startCommit,
    report,
    ticketBody:       '',
    bodyHashAtLaunch: '',
    jobId:            job.id,
    logRecords:       board.logRecordsSoFar(),
    launchSnapshot:   start.launchSnapshot,
    refMovesAllowed:  {
      ownBranch: '', otherJobBranches: [], loggedJobBranches: [], recordedLandings: [], removedAfterLandings: [], refreshWorktreeHeads: []
    },
  });
  if (verdict.verdict === 'refused') return verdict;
  const proposal = OnboardingProposal.proposalOf(report);
  if (proposal.mode === 'advise') return { verdict: 'advised' };
  const runRecord = await ProposalTwiceRun.runProposalTwice({
    prepare: proposal.prepare, gates: proposal.gates, directory: snapshot, snapshotCommit: start.startCommit, millisecondsNow: context.millisecondsNow
  });
  return {
    verdict: 'proposed', proposal, runRecord, cachingSuggestions: CachingChecks.cachingSuggestionsOf(snapshot, proposal.gates, runRecord)
  };
}

/** Outside the hold, since gates take minutes: each onboarder that reported (`in-customs`) and is not settled yet; its session is stopped first. */
async function settleEndedOnboarders(context: OnboardingContext, board: Board): Promise<number> {
  let settled = 0;
  for (const job of board.jobs().filter(isOnboarderJob)) {
    if (job.state !== 'in-customs') continue;
    if (OnboardingProposal.storedOutcomeOf(context.workspace.trackerDirectory, job.id) !== null) continue;
    await WatcherFleet.sendFrames(WatcherFleet.jobFolderOf(context.workspace.trackerDirectory, job.id), job.watcherInstance, [
      { kind: 'stop', graceMilliseconds: context.stopGraceMilliseconds },
    ]);
    OnboardingProposal.storeOutcome(context.workspace.trackerDirectory, job.id, await settledOutcomeOf(context, board, job));
    settled += 1;
  }
  return settled;
}

/** In the hold: a proposal opens `pipeline-proposal` naming the job, whose answer reads it; every settled pass ends its job. */
function applySettledOnboarders(change: TrackerChange, worktreesRoot: string, decisionWordingOf: (draft: DecisionDraft) => DecisionWording): void {
  for (const job of change.board.jobs().filter(isOnboarderJob)) {
    const outcome = OnboardingProposal.storedOutcomeOf(change.workspace.trackerDirectory, job.id);
    if (outcome === null) continue;
    if (outcome.verdict === 'proposed') {
      const draft: DecisionDraft = {
        kind: 'pipeline-proposal', ticketIds: [], jobId: job.id, pipelineProposal: OnboardingProposal.proposalFactsOf(outcome)
      };
      change.board.openDecision({
        ...draft, askedBy: 'overseer', requestId: null, ...decisionWordingOf(draft)
      }, change.at);
    }
    change.board.endJob(job.id, outcome.verdict === 'refused' ? { outcome: 'failed', cause: outcome.reason } : { outcome: 'closed' }, change.at);
    GitProcess.run(change.workspace.rootDirectory, ['worktree', 'remove', '--force', snapshotDirectoryOf(worktreesRoot, job.id)]);
  }
}

export const Onboarding = Object.freeze({
  isOnboarderJob, prepareSnapshot, onboarderProfileOf, onboardingFactsOf, settleEndedOnboarders, applySettledOnboarders
});
