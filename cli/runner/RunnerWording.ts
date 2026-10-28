/**
 * The words the runner's DrivePass needs and services may not hold: a code-opened decision's question, and what a launched session is told.
 * The role prompts that replace the launch text come with the prompt templates later in the chain.
 */
import { readFileSync }                                     from 'node:fs';
import type { Job }                                         from '../../src/lib/tracker-model/@types/Job.ts';
import type { DecisionDraft, DecisionWording }              from '../../src/lib/tracker-model/@types/LifecycleStep.ts';
import type { JobLaunchFacts, JobLaunchText, RunnerNotice } from '../../src/services/runner/DrivePass.ts';
import type { HandoverFailure }                             from '../../src/services/runner/RunnerHandover.ts';
import { filledTemplateOf }                                 from '../../src/shared/FilledTemplate.ts';
import { resourceFilePathOf }                               from '../../src/shared/ResourceFilePath.ts';
import { DISPATCH_PROTOCOL }                                from '../../src/shared/constants/DispatchProtocol.ts';
import { PRODUCT_NAMES }                                    from '../../src/shared/constants/ProductNames.ts';

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

const NO_CHECKS_LINE = '(no checks line is stored)';

/** A builder's first message is the whole build prompt, its ticket and checks line filled in; the other roles get theirs later in the chain. */
function launchTextOf(job: Readonly<Job>, facts: JobLaunchFacts): JobLaunchText {
  const subject = ticketsPhraseOf(job.ticketIds);
  const roleBrief = `You are the ${job.role ?? job.kind} of job ${job.id}.`;
  const [ticket] = facts.tickets;
  if (job.kind === 'review' && ticket !== undefined) {
    return {
      firstMessage: filledTemplateOf(readFileSync(resourceFilePathOf('prompts', 'ReviewPrompt.md'), 'utf8'), {
        ticketId:    ticket.id,
        ticketTitle: ticket.title,
        ticketBody:  ticket.body.trim(),
        jobId:       job.id,
        round:       String(job.attempt),
        checksLine:  facts.checksLine ?? NO_CHECKS_LINE,
        callBudget:  String(DISPATCH_PROTOCOL.REVIEWER_API_CALL_BUDGET),
        program:     PRODUCT_NAMES.PROGRAM,
      }),
      roleBrief,
    };
  }
  if (job.role === 'resolver' && ticket !== undefined) {
    return {
      firstMessage: filledTemplateOf(readFileSync(resourceFilePathOf('prompts', 'ResolvePrompt.md'), 'utf8'), {
        ticketId:    ticket.id,
        ticketTitle: ticket.title,
        ticketBody:  ticket.body.trim(),
        jobId:       job.id,
        checksLine:  facts.checksLine ?? NO_CHECKS_LINE,
        callBudget:  String(DISPATCH_PROTOCOL.RESOLVER_API_CALL_BUDGET),
      }),
      roleBrief,
    };
  }
  if (job.kind !== 'build' || ticket === undefined) return { firstMessage: `Job ${job.id}: work as the ${job.role ?? job.kind} on ${subject}, attempt ${job.attempt}.`, roleBrief };
  return {
    firstMessage: filledTemplateOf(readFileSync(resourceFilePathOf('prompts', 'BuildPrompt.md'), 'utf8'), {
      ticketId:    ticket.id,
      ticketTitle: ticket.title,
      ticketBody:  ticket.body.trim(),
      jobId:       job.id,
      attempt:     String(job.attempt),
      checksLine:  facts.checksLine ?? NO_CHECKS_LINE,
      callBudget:  String(DISPATCH_PROTOCOL.BUILDER_API_CALL_BUDGET),
      program:     PRODUCT_NAMES.PROGRAM,
    }),
    roleBrief,
  };
}

function windDownMessage(): string {
  return readFileSync(resourceFilePathOf('prompts', 'WindDownMessage.md'), 'utf8').trim().replaceAll('\n', ' ');
}

function resumeMessage(): string {
  return readFileSync(resourceFilePathOf('prompts', 'ResumeMessage.md'), 'utf8').trim().replaceAll('\n', ' ');
}

const EARLIER_SESSION_NOTE = 'An earlier session was interrupted; uncommitted changes are its work.';

/** A fresh job after a `replaced` one inherits its worktree, and is told so before anything else. */
function launchTextWithEarlierSessionNoteOf(job: Readonly<Job>, facts: JobLaunchFacts): JobLaunchText {
  const text = launchTextOf(job, facts);
  return facts.earlierSessionReplaced ? { ...text, firstMessage: `${EARLIER_SESSION_NOTE}\n\n${text.firstMessage}` } : text;
}

/** What `run status` reads of the live runner's state document; anything it does not recognise reads as no document. */
export interface RunnerStateReading {
  runtimeState:    string;
  notices:         RunnerNotice[];
  handoverWarning: HandoverFailure | null;
}

function runnerStateOf(document: unknown): RunnerStateReading | null {
  if (typeof document !== 'object' || document === null) return null;
  const { runtimeState, notices, handoverWarning } = document as Partial<Record<keyof RunnerStateReading, unknown>>;
  if (typeof runtimeState !== 'string' || !Array.isArray(notices)) return null;
  return { runtimeState, notices: notices as RunnerNotice[], handoverWarning: (handoverWarning ?? null) as HandoverFailure | null };
}

function noticeTextOf(notice: RunnerNotice): string {
  switch (notice.kind) {
    case 'install-version-changed':
      return `the install version changed, so launches are held: run \`${PRODUCT_NAMES.PROGRAM} update\``;
    case 'new-code':
      return `new code: run \`${PRODUCT_NAMES.PROGRAM} update\``;
    case 'claude-md-block-committed':
      return `launches onto ${notice.target} wait: commit the CLAUDE.md change \`update\` made`;
    case 'attribution-found':
      return `ticket #${notice.ticketId} carries an AI attribution`;
    case 'rounds-not-converging':
      return `ticket #${notice.ticketId}'s review rounds are not converging`;
    case 'dirty-main-checkout':
      return notice.blockingFiles.length === 0
        ? `landings on ${notice.target} wait: the main checkout is on ${notice.branch ?? 'no branch'}, not ${notice.target}`
        : `landings on ${notice.target} wait: the main checkout's changes to ${notice.blockingFiles.join(', ')} block the fast-forward`;
  }
}

function handoverWarningTextOf(failure: HandoverFailure): string {
  return `the handover to code ${failure.successorCodeVersion} failed at ${failure.step}: ${failure.error}; this runner keeps driving`;
}

export const RunnerWording = Object.freeze({
  decisionWordingOf,
  launchTextOf: launchTextWithEarlierSessionNoteOf,
  windDownMessage,
  resumeMessage,
  runnerStateOf,
  noticeTextOf,
  handoverWarningTextOf,
});
