/**
 * Landing a gated commit on its target, inside the caller's `writeTracker` hold: the target's tip is read and compared with the tip the
 * merge was made against before anything moves, then main is fast-forwarded in the main checkout, or a group branch by `merge --ff-only`
 * in its worktree. Every refusal is a wordless verdict naming the outcome the runner acts on, so a refused landing never loops.
 */
import { TicketAcceptanceUtil }             from '../../adapters/tickets/utils/TicketAcceptanceUtil.ts';
import { fastForwardTo, readCurrentBranch } from '../../lib/git/BranchIntegration.ts';
import { GitProcess, type GitHookPolicy }   from '../../lib/git/GitProcess.ts';
import type { Ticket }                      from '../../lib/tracker-model/@types/Ticket.ts';

/** Main is landed in the main checkout; a group branch in the worktree it is checked out in, never by `update-ref`. */
export interface LandingTarget {
  branch:    string;
  directory: string;
}

export interface LandingRequest {
  target:            LandingTarget;
  mergedCommit:      string;
  /** The target's tip the merge was made against: the slot's `targetTip`. */
  expectedTargetTip: string;
  /** Tips an earlier landing recorded, so a target moved by one of them requeues rather than opening `target-moved`. */
  recordedLandings:  readonly string[];
  hookPolicy:        GitHookPolicy;
}

export type LandingRefusalReason =
  | 'target-moved-by-a-recorded-landing'
  | 'target-moved'
  | 'not-on-target-branch'
  | 'dirty-checkout'
  | 'git-failed'
  | 'acceptance-unnumbered'
  | 'acceptance-unaccounted'
  | 'acceptance-waived';

export type LandingOutcome = 'requeue-from-branch-tip' | 'open-target-moved' | 'hold-target' | 'hold-ticket' | 'finish-board-side';

/** Wordless: the caller words a refusal from these; `gitFailure` is git's own text. */
export interface LandingRefusalFacts {
  targetTip?:     string;
  gitFailure?:    string;
  blockingFiles?: readonly string[];
  ticketId?:      string;
}

export type LandingVerdict =
  | { verdict: 'landed'; commit: string; previousTip: string }
  | { verdict: 'already-landed'; commit: string; targetTip: string }
  | { verdict: 'refused'; reason: LandingRefusalReason; facts: LandingRefusalFacts };

/** What the runner does with each refusal: a target-level one stops new slots on the target, a ticket-level one holds the ticket. */
export const LANDING_OUTCOME_OF_REFUSAL: Readonly<Record<LandingRefusalReason, LandingOutcome>> = {
  'target-moved-by-a-recorded-landing': 'requeue-from-branch-tip',
  'target-moved':                       'open-target-moved',
  'not-on-target-branch':               'hold-target',
  'dirty-checkout':                     'hold-target',
  'git-failed':                         'hold-target',
  'acceptance-unnumbered':              'hold-ticket',
  'acceptance-unaccounted':             'hold-ticket',
  'acceptance-waived':                  'hold-ticket',
};

/** A crash between the fast-forward and the board write is finished on the board side; it is never a refusal. */
export const ALREADY_LANDED_OUTCOME: LandingOutcome = 'finish-board-side';

const NOT_AN_ANCESTOR_EXIT_CODE = 1;

function refused(reason: LandingRefusalReason, facts: LandingRefusalFacts = {}): LandingVerdict {
  return { verdict: 'refused', reason, facts };
}

function gitFailed(gitFailure: string): LandingVerdict {
  return refused('git-failed', { gitFailure });
}

function movedTargetVerdictOf(request: LandingRequest, targetTip: string): LandingVerdict {
  const { target, mergedCommit, recordedLandings } = request;
  const ancestryArguments                          = ['merge-base', '--is-ancestor', mergedCommit, targetTip];
  const ancestry                                   = GitProcess.run(target.directory, ancestryArguments);
  // An ancestor, not tip equality: a later landing may already stand on top of this one.
  if (GitProcess.succeeded(ancestry)) return { verdict: 'already-landed', commit: mergedCommit, targetTip };
  if (ancestry === null || ancestry.exitCode !== NOT_AN_ANCESTOR_EXIT_CODE) return gitFailed(GitProcess.failureReasonOf(ancestry, ancestryArguments));
  if (recordedLandings.includes(targetTip)) return refused('target-moved-by-a-recorded-landing', { targetTip });
  return refused('target-moved', { targetTip });
}

function landOnTarget(request: LandingRequest): LandingVerdict {
  const {
    target, mergedCommit, expectedTargetTip, hookPolicy
  } = request;
  const currentBranch                                           = readCurrentBranch(target.directory);
  if (currentBranch.verdict === 'git-failed') return gitFailed(currentBranch.reason);
  if (currentBranch.verdict !== 'on-branch' || currentBranch.branch !== target.branch) return refused('not-on-target-branch');
  const targetTip = GitProcess.resolvedCommitOf(target.directory, `refs/heads/${target.branch}`);
  if (targetTip === null) return refused('git-failed');
  if (targetTip !== expectedTargetTip) return movedTargetVerdictOf(request, targetTip);

  const merge = fastForwardTo(target.directory, mergedCommit, hookPolicy);
  if (merge.verdict === 'fast-forwarded') return { verdict: 'landed', commit: merge.commit, previousTip: targetTip };
  if (merge.blockingFiles.length > 0) return refused('dirty-checkout', { blockingFiles: merge.blockingFiles, gitFailure: merge.reason.trim() });
  return gitFailed(merge.reason.trim());
}

/** The ticket-level check a landing makes before git moves: the Acceptance, each ticket on its own. */
function ticketRefusalOf(tickets: readonly Readonly<Ticket>[]): LandingVerdict | null {
  for (const { frontmatter, body } of tickets) {
    const ticketId = frontmatter.id;
    switch (TicketAcceptanceUtil.acceptanceVerdictOf(body).verdict) {
      case 'accounted-for':
        continue;
      case 'unnumbered':
        return refused('acceptance-unnumbered', { ticketId });
      case 'unaccounted':
        return refused('acceptance-unaccounted', { ticketId });
      case 'waived-in-review-only':
        return refused('acceptance-waived', { ticketId });
    }
  }
  return null;
}

export const Landing = Object.freeze({ landOnTarget, ticketRefusalOf });
