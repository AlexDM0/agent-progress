/**
 * The words the runner's DrivePass needs and services may not hold: a code-opened decision's question, and what a launched session is told.
 * The role prompts that replace the launch text come with the prompt templates later in the chain.
 */
import type { Job }                            from '../../src/lib/tracker-model/@types/Job.ts';
import type { DecisionDraft, DecisionWording } from '../../src/lib/tracker-model/@types/LifecycleStep.ts';
import type { JobLaunchText }                  from '../../src/services/runner/DrivePass.ts';

function ticketsPhraseOf(ticketIds: readonly string[]): string {
  return ticketIds.length === 0 ? 'the board' : ticketIds.map((ticketId) => `#${ticketId}`).join(', ');
}

function decisionWordingOf(draft: DecisionDraft): DecisionWording {
  return {
    questions: [{
      question:    `The runner needs a decision (${draft.kind}) about ${ticketsPhraseOf(draft.ticketIds)}.`,
      header:      draft.kind,
      multiSelect: false,
      options:     [],
    }],
    context: '',
  };
}

function launchTextOf(job: Readonly<Job>): JobLaunchText {
  const subject = ticketsPhraseOf(job.ticketIds);
  return {
    firstMessage: `Job ${job.id}: work as the ${job.role ?? job.kind} on ${subject}, attempt ${job.attempt}.`,
    roleBrief:    `You are the ${job.role ?? job.kind} of job ${job.id}.`,
  };
}

export const RunnerWording = Object.freeze({ decisionWordingOf, launchTextOf });
