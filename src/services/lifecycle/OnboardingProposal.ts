/**
 * What an onboarder's ended pass leaves for User: its verified proposal with the twice-run record and the caching suggestions, kept in the
 * job's folder, and its acceptance, which writes the prepare steps and gates through the `gate` verbs' Board moves in the answering hold.
 */
import { readFileSync } from 'node:fs';
import { join }         from 'node:path';

import { writeFileAtomically }                               from '../../lib/atomic-file/AtomicFile.ts';
import type { LogRecord }                                    from '../../lib/tracker-model/@types/LogRecord.ts';
import type { PipelineGate, PipelineStep }                   from '../../lib/tracker-model/@types/Pipeline.ts';
import type { PipelineProposalFacts }                        from '../../lib/tracker-model/@types/PlaybookStep.ts';
import type { Board }                                        from '../../lib/tracker-model/Board.ts';
import type { CachingSuggestion }                            from './CachingChecks.ts';
import type { VerificationCheck, VerificationRefusalReason } from './Customs.ts';
import type { ProposalRunRecord }                            from './ProposalTwiceRun.ts';

export type OnboarderMode = 'setup' | 'advise';

/** The report's proposal, as its schema holds it. */
export interface PipelineProposal {
  mode:         OnboarderMode;
  prepare:      PipelineStep[];
  gates:        { name: string; run: string; definedBy: string[]; network: string[]; writes: string[] }[];
  review:       { name: string; model: string | null; effort: string | null } | null;
  constitution: string[];
  agents:       Readonly<Record<string, string[]>>;
  notes:        string;
}

/** A setup proposal is never shown without its twice-run record: the type has no proposal without one. */
export type OnboardingOutcome =
  | { verdict: 'refused'; check: VerificationCheck; reason: VerificationRefusalReason; facts: readonly string[] }
  | { verdict: 'advised' }
  | { verdict: 'proposed'; proposal: PipelineProposal; runRecord: ProposalRunRecord; cachingSuggestions: CachingSuggestion[] };

const OUTCOME_FILE = 'onboarding-outcome.json';

/** The job folder the Overseer keeps per job, `<data>/jobs/<J>`, which only the Overseer writes. */
function outcomePathOf(trackerDirectory: string, jobId: string): string {
  return join(trackerDirectory, 'jobs', jobId, OUTCOME_FILE);
}

function storeOutcome(trackerDirectory: string, jobId: string, outcome: OnboardingOutcome): void {
  writeFileAtomically(outcomePathOf(trackerDirectory, jobId), `${JSON.stringify(outcome, null, 2)}\n`);
}

/** `null` before the Overseer settled the pass, or when the file is unreadable, which accepts nothing. */
function storedOutcomeOf(trackerDirectory: string, jobId: string): OnboardingOutcome | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(outcomePathOf(trackerDirectory, jobId), 'utf8'));
    return typeof parsed === 'object' && parsed !== null && 'verdict' in parsed ? parsed as OnboardingOutcome : null;
  } catch {
    return null;
  }
}

/** The report's fields, read once it passed V1, so every one is present and of its schema's shape. */
function proposalOf(report: unknown): PipelineProposal {
  return report as PipelineProposal;
}

function pipelineGateOf(gate: PipelineProposal['gates'][number]): PipelineGate {
  return {
    name: gate.name,
    run:  gate.run,
    ...gate.definedBy.length === 0 ? {} : { definedBy: [...gate.definedBy] },
    ...gate.network.length === 0 ? {} : { network: [...gate.network] },
    ...gate.writes.length === 0 ? {} : { writes: [...gate.writes] },
  };
}

/**
 * Every prepare step and gate through the Board moves `gate prepare`, `gate add` and `gate none` make, in the caller's one hold; an empty
 * gate list is no gates on purpose. The review, constitution and agent arrays have no verb yet, so they stay shown, never written.
 */
function acceptProposal(board: Board, proposal: PipelineProposal, at: string): LogRecord[] {
  const logged: LogRecord[] = [];
  for (const step of proposal.prepare) logged.push(...board.setPrepareStep({ name: step.name, run: step.run }, at).logged);
  for (const gate of proposal.gates) logged.push(...board.addGate(pipelineGateOf(gate), at).logged);
  if (proposal.gates.length === 0) logged.push(...board.setNoGates(at).logged);
  return logged;
}

function suggestionValuesOf(suggestion: CachingSuggestion): string[] {
  switch (suggestion.kind) {
    case 'no-caching-tool':
      return suggestion.slowGates.map((gate) => `${gate.name}=${gate.milliseconds}ms`);
    case 'per-worktree-cache':
      return [suggestion.cacheFolder];
    case 'task-inputs-unseen':
      return [suggestion.task, ...suggestion.folders];
    case 'gate-not-through-turbo':
      return [suggestion.gate];
  }
}

/** The decision's facts, built only from a `proposed` outcome, which always carries its twice-run record. */
function proposalFactsOf(outcome: Extract<OnboardingOutcome, { verdict: 'proposed' }>): PipelineProposalFacts {
  const { proposal, runRecord } = outcome;
  return {
    snapshotCommit:     runRecord.snapshotCommit,
    prepare:            proposal.prepare,
    failedPrepareSteps: runRecord.prepare.failedSteps,
    gates:              proposal.gates.map((gate) => {
      const record = runRecord.gates.find((ran) => ran.name === gate.name);
      return {
        name: gate.name, run: gate.run, verdict: record?.verdict ?? 'cannot-run', outcomes: record?.outcomes ?? [], durationsMilliseconds: record?.durationsMilliseconds ?? []
      };
    }),
    review:       proposal.review?.name ?? null,
    constitution: proposal.constitution,
    agents:       proposal.agents,
    suggestions:  outcome.cachingSuggestions.map((suggestion) => ({ kind: suggestion.kind, values: suggestionValuesOf(suggestion) })),
  };
}

export const OnboardingProposal = Object.freeze({
  storeOutcome, storedOutcomeOf, proposalOf, acceptProposal, proposalFactsOf
});
