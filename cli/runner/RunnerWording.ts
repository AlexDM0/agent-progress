/**
 * The words the runner's DrivePass needs and services may not hold: a code-opened decision's question, and what a launched session is told.
 * The role prompts that replace the launch text come with the prompt templates later in the chain.
 */
import { readFileSync }  from 'node:fs';
import type { Incident } from '../../src/lib/tracker-model/@types/Incident.ts';
import type { Job }      from '../../src/lib/tracker-model/@types/Job.ts';
import type {
  DecisionDraft,
  DecisionWording,
  ReadyDraftFact,
  ReadyDraftsFacts
} from '../../src/lib/tracker-model/@types/LifecycleStep.ts';
import type { PipelineGate }              from '../../src/lib/tracker-model/@types/Pipeline.ts';
import { ALLOWED_MOVES_BY_INCIDENT_KIND } from '../../src/services/control/constants/AllowedMovesByIncidentKind.ts';
import type { AssistantFacts }            from '../../src/services/runner/AssistantBoot.ts';
import type { AssistantChatFacts }        from '../../src/services/runner/AssistantSession.ts';
import type {
  AirlockFacts,
  JobLaunchFacts,
  JobLaunchText,
  ReviewFindingsFacts,
  RunnerNotice
} from '../../src/services/runner/DrivePass.ts';
import type { RedHandoffFacts }       from '../../src/services/runner/RedHandoff.ts';
import type { HandoverFailure }       from '../../src/services/runner/RunnerHandover.ts';
import { filledTemplateOf }           from '../../src/shared/FilledTemplate.ts';
import { resourceFilePathOf }         from '../../src/shared/ResourceFilePath.ts';
import { DISPATCH_PROTOCOL }          from '../../src/shared/constants/DispatchProtocol.ts';
import { PRODUCT_NAMES }              from '../../src/shared/constants/ProductNames.ts';
import { ASSISTANT_TURN_CALL_BUDGET } from '../../src/shared/constants/RunnerLimits.ts';

function ticketsPhraseOf(ticketIds: readonly string[]): string {
  return ticketIds.length === 0 ? 'the board' : ticketIds.map((ticketId) => `#${ticketId}`).join(', ');
}

function draftLineOf(draft: ReadyDraftFact): string {
  const network = draft.network.length === 0 ? 'no network' : `network ${draft.network.join(', ')}`;
  return `#${draft.id} ${draft.title} (${draft.priority}, ${network})`;
}

/** Each option names its tickets as `#<id>`, which the answer readies; "None" names none and leaves them in the Drafts lane. */
function readyDraftsWordingOf(facts: ReadyDraftsFacts): DecisionWording {
  const draftById = new Map(facts.drafts.map((draft) => [draft.id, draft]));
  const options = facts.proposedSets.map((draftSet) => ({
    label:       `Ready ${draftSet.map((draftId) => `#${draftId}`).join(', ')}`,
    description: draftSet.flatMap((draftId) => { const draft = draftById.get(draftId); return draft === undefined ? [] : [draftLineOf(draft)]; }).join('; '),
  }));
  const unreadiable = facts.drafts.filter((draft) => !draft.readiable);
  return {
    questions: [{
      question:    'The product owner filed these drafts. Ready which to build?',
      header:      'ready-drafts',
      multiSelect: false,
      options:     [...options, { label: 'None', description: 'They stay drafts in the Drafts lane.' }],
    }],
    context: [
      ...facts.drafts.map(draftLineOf),
      ...unreadiable.map((draft) => `#${draft.id} is not readiable: it needs a numbered Acceptance and a Brief.`),
    ].join('\n'),
  };
}

function decisionWordingOf(draft: DecisionDraft): DecisionWording {
  if (draft.readyDrafts !== undefined) return readyDraftsWordingOf(draft.readyDrafts);
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

function gateEntryOf(gate: Readonly<PipelineGate>, position: number): string {
  const folder = gate.in === undefined ? '' : ` (in \`${gate.in}\`)`;
  const entry  = `${position}. \`${gate.name}\`: \`${gate.run}\`${folder}`;
  return gate.fix === undefined ? entry : `${entry}\n   Fix: \`${gate.fix}\`. Run it before you fix anything by hand.`;
}

/** The builder's gates in run order with each fix; an `overseerOnly` gate is named as the Overseer's, never as one to run or claim. */
function gateListOf(gates: readonly Readonly<PipelineGate>[] | null): string {
  const agentGates    = (gates ?? []).filter((gate) => gate.overseerOnly !== true);
  const overseerGates = (gates ?? []).filter((gate) => gate.overseerOnly === true);
  const overseerLine  = overseerGates.length === 0
    ? []
    : ['', `The Overseer alone runs ${overseerGates.map((gate) => `\`${gate.name}\``).join(', ')}: never run or claim it.`];
  if (agentGates.length === 0) {
    const none = overseerGates.length === 0 ? 'This repository has no gates' : 'No gate is yours to run';
    return [`${none}: nothing to pass before you report, and your report's \`gates\` is empty.`, ...overseerLine].join('\n');
  }
  return [
    'Pass every gate on your final commit before you report, in this order, and claim each in your report\'s `gates` with',
    'the commit it passed on:',
    '',
    ...agentGates.map((gate, index) => gateEntryOf(gate, index + 1)),
    ...overseerLine,
  ].join('\n');
}

/**
 * The first line runs the product-owner skill on User's request; a fresh session taking over a replaced one also reads the drafts filed so
 * far and the answers its predecessor's questions got, in the same message.
 */
function productOwnerTextOf(job: Readonly<Job>, intake: NonNullable<JobLaunchFacts['intake']>, instructions: string): JobLaunchText {
  const firstLine = `/${PRODUCT_NAMES.PRODUCT_OWNER_SKILL} ${intake.text}`.trim();
  const draftLines = intake.drafts.map((draft) => `- #${draft.id} ${draft.title}`);
  const answerLines = intake.carriedAnswers.flatMap((answer) => Object.entries(answer).map(([question, answerText]) => `- ${question}\n  Answer: ${answerText}`));
  const takeover = draftLines.length === 0 && answerLines.length === 0 ? [] : [
    'An earlier product-owner session on this request was replaced; carry its intake on.',
    ...(draftLines.length === 0 ? [] : ['Drafts it filed:', ...draftLines]),
    ...(answerLines.length === 0 ? [] : ['Answers User gave its questions:', ...answerLines]),
  ];
  const fills = { jobId: job.id, program: PRODUCT_NAMES.PROGRAM, skill: PRODUCT_NAMES.PRODUCT_OWNER_SKILL };
  const roleBrief = filledTemplateOf(instructions, fills);
  return { firstMessage: [firstLine, ...(takeover.length === 0 ? [] : ['', ...takeover])].join('\n'), roleBrief };
}

const AIRLOCK_PROMPT_OF_ROLE = { 'merge-fix': 'MergeFixPrompt.md', 'resolution-review': 'ResolutionReviewPrompt.md' } as const;

const AIRLOCK_CALL_BUDGET_OF_ROLE = {
  'merge-fix':         DISPATCH_PROTOCOL.MERGE_FIXER_API_CALL_BUDGET,
  'resolution-review': DISPATCH_PROTOCOL.RESOLUTION_REVIEWER_API_CALL_BUDGET,
} as const;

/** A merge-gate fixer or a resolution reviewer is told its Airlock: the worktree, the recorded tips, and the failed gate or the merge. */
function airlockAgentMessageOf(
  role: keyof typeof AIRLOCK_PROMPT_OF_ROLE,
  job: Readonly<Job>,
  ticket: JobLaunchFacts['tickets'][number],
  facts: JobLaunchFacts,
  airlock: AirlockFacts,
): string {
  return filledTemplateOf(readFileSync(resourceFilePathOf('prompts', AIRLOCK_PROMPT_OF_ROLE[role]), 'utf8'), {
    ticketId:        ticket.id,
    ticketTitle:     ticket.title,
    ticketBody:      ticket.body.trim(),
    jobId:           job.id,
    checksLine:      facts.checksLine ?? NO_CHECKS_LINE,
    callBudget:      String(AIRLOCK_CALL_BUDGET_OF_ROLE[role]),
    program:         PRODUCT_NAMES.PROGRAM,
    airlockWorktree: airlock.worktree,
    branchTip:       airlock.branchTip,
    targetTip:       airlock.targetTip,
    mergeCommit:     airlock.mergeCommit,
    gateTail:        airlock.gateTail,
  });
}

function incidentTextOf(incident: Readonly<Incident>): string {
  const tickets = incident.ticketIds.length === 0 ? '' : ` on #${incident.ticketIds.join(', #')}`;
  const job     = incident.jobId === null ? '' : `, job ${incident.jobId}`;
  return [
    `${incident.id} ${incident.kind}${tickets}${job}`,
    ...Object.entries(incident.facts).map(([fact, value]) => `  ${fact}: ${value}`),
    `  moves: ${ALLOWED_MOVES_BY_INCIDENT_KIND[incident.kind].join(', ')}; default ${incident.defaultMove}`,
  ].join('\n');
}

function incidentsTextOf(incidents: readonly Readonly<Incident>[]): string {
  return incidents.length === 0 ? 'No incident is open.' : incidents.map(incidentTextOf).join('\n\n');
}

/** One numbered chat delivering incidents; the turn it opens ends with its `result`, and what is still open then takes its default. */
function assistantChatTextOf(facts: AssistantChatFacts): string {
  return `Chat ${facts.sequence}: settle these incidents in this turn, each with one of its moves and \`--incident <I>\`.\n\n${incidentsTextOf(facts.incidents)}`;
}

/** The Assistant's brief and its first message, chat 1: its open incidents, the newest incident records and a board summary. */
function assistantTextOf(job: Readonly<Job>, assistant: AssistantFacts, instructions: string): JobLaunchText {
  const { summary } = assistant;
  const statusCounts = Object.entries(summary.ticketCountByStatus).map(([status, count]) => `${status} ${count}`).join(', ');
  const jobLines = summary.liveJobs.map((live) => `- ${live.id} ${live.kind} ${live.state}${live.ticketIds.length === 0 ? '' : ` #${live.ticketIds.join(', #')}`}`);
  const historyLines = assistant.history.map((record) => `- ${record.at} ${record.kind} ${record.incidentId} ${record.fields}`);
  const firstMessage = [
    `Chat 1: you are job ${job.id}, the Assistant of this board, booted fresh. Settle the open incidents below in this turn.`,
    '',
    '## Open incidents',
    incidentsTextOf(assistant.incidents),
    '',
    '## Newest incident records',
    ...(historyLines.length === 0 ? ['None.'] : historyLines),
    '',
    '## Board',
    `Tickets: ${statusCounts === '' ? 'none' : statusCounts}. Open decisions for User: ${summary.openDecisionCount}.`,
    ...(jobLines.length === 0 ? ['No job is live.'] : ['Live jobs:', ...jobLines]),
  ].join('\n');
  const fills = { jobId: job.id, program: PRODUCT_NAMES.PROGRAM, callBudget: String(ASSISTANT_TURN_CALL_BUDGET) };
  const roleBrief = filledTemplateOf(instructions, fills);
  return { firstMessage, roleBrief };
}

/** The first line of a builder's session resumed because its review found a claim that does not hold. */
function reviewFindingsMessageOf(ticketId: string, facts: Readonly<ReviewFindingsFacts>): string {
  return [
    `The review of #${ticketId} found a claim that does not hold, so your session is resumed with its findings`
    + ` (resume ${facts.resume} of ${facts.resumesAllowed}). Fix what does not hold, commit, and end with your report again.`,
    '',
    facts.reviewSection,
  ].join('\n');
}

/**
 * A builder's and a reviewer's first message is its role's instruction files, the constitution first, filled with its ticket and checks
 * line; a merge-slot role's instruction files are its role brief, beside the first message its merge prompt gives it.
 */
function launchTextOf(job: Readonly<Job>, facts: JobLaunchFacts): JobLaunchText {
  if (facts.intake !== null) return productOwnerTextOf(job, facts.intake, facts.instructions);
  if (facts.assistant !== null) return assistantTextOf(job, facts.assistant, facts.instructions);
  const subject = ticketsPhraseOf(job.ticketIds);
  const mergeSlotRole = job.role === 'resolver' || job.role === 'merge-fix' || job.role === 'resolution-review';
  const roleBrief = mergeSlotRole
    ? filledTemplateOf(facts.instructions, { role: job.role ?? job.kind, jobId: job.id, program: PRODUCT_NAMES.PROGRAM })
    : `You are the ${job.role ?? job.kind} of job ${job.id}.`;
  const [ticket] = facts.tickets;
  if (job.kind === 'review' && ticket !== undefined) {
    return {
      firstMessage: filledTemplateOf(facts.instructions, {
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
  if ((job.role === 'merge-fix' || job.role === 'resolution-review') && ticket !== undefined && facts.airlock !== null) {
    return { firstMessage: airlockAgentMessageOf(job.role, job, ticket, facts, facts.airlock), roleBrief };
  }
  if (job.kind !== 'build' || ticket === undefined) return { firstMessage: `Job ${job.id}: work as the ${job.role ?? job.kind} on ${subject}, attempt ${job.attempt}.`, roleBrief };
  const reviewFindings = facts.reviewFindings ?? null;
  if (reviewFindings !== null) return { firstMessage: reviewFindingsMessageOf(ticket.id, reviewFindings), roleBrief };
  return {
    firstMessage: filledTemplateOf(facts.instructions, {
      ticketId:    ticket.id,
      ticketTitle: ticket.title,
      ticketBody:  ticket.body.trim(),
      jobId:       job.id,
      attempt:     String(job.attempt),
      gateList:    gateListOf(facts.gates),
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

/** The first line of a session resumed after its question was answered: each question with User's answer, in the agent's own words. */
function answerMessageOf(answer: Readonly<Record<string, string>>): string {
  const answerLines = Object.entries(answer).map(([question, answerText]) => `Question: ${question}\nAnswer: ${answerText}`);
  return `You were interrupted while waiting for the answer to your question; carry on with it.\n\n${answerLines.join('\n\n')}`;
}

/** The first line of a session resumed to fix its red gate or Customs check, which points it to the handover. */
function redHandoffMessageOf(facts: Readonly<RedHandoffFacts>): string {
  return filledTemplateOf(readFileSync(resourceFilePathOf('prompts', 'RedHandoffMessage.md'), 'utf8'), {
    what:           facts.kind === 'gate' ? `the \`${facts.name}\` gate` : `Customs check ${facts.name}`,
    commit:         facts.commit,
    exitCode:       facts.exitCode === null ? '' : ` with exit code ${facts.exitCode}`,
    handoverPath:   facts.handoverPath,
    resume:         String(facts.resume),
    resumesAllowed: String(facts.resumesAllowed),
    callBudget:     String(facts.callBudget),
  }).trim().replaceAll('\n', ' ');
}

const EARLIER_SESSION_NOTE = 'An earlier session was interrupted; uncommitted changes are its work.';

/**
 * A fresh job after a `replaced` one inherits its worktree, and is told so before anything else; one taking over a red handoff the
 * replaced session could not be resumed for opens with that handoff's message.
 */
function launchTextWithEarlierSessionNoteOf(job: Readonly<Job>, facts: JobLaunchFacts): JobLaunchText {
  const text = launchTextOf(job, facts);
  if (!facts.earlierSessionReplaced) return text;
  const redHandoff = facts.redHandoff ?? null;
  const opening = redHandoff === null ? EARLIER_SESSION_NOTE : `${EARLIER_SESSION_NOTE} ${redHandoffMessageOf(redHandoff)}`;
  return { ...text, firstMessage: `${opening}\n\n${text.firstMessage}` };
}

/** What `run status` reads of the live runner's state document; anything it does not recognise reads as no document. */
export interface RunnerStateReading {
  runtimeState:    string;
  notices:         RunnerNotice[];
  handoverWarning: HandoverFailure | null;
}

function runnerStateOf(document: unknown): RunnerStateReading | null {
  if (typeof document !== 'object' || document === null) return null;
  const { overseer, notices } = document as { overseer?: unknown; notices?: unknown };
  if (typeof overseer !== 'object' || overseer === null || !Array.isArray(notices)) return null;
  const { state: runtimeState, handoverWarning } = overseer as { state?: unknown; handoverWarning?: unknown };
  if (typeof runtimeState !== 'string') return null;
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
    case 'incident-defaulted':
      return `incident ${notice.incidentId} took its default, ${notice.move}, as no orchestrator handled it (${notice.cause})`;
    case 'cleanup-declined':
      return `git declined the ${notice.cleanup} cleanup of ${notice.groupBranch}, so it is left in place: ${notice.reason}`;
    case 'instructions-missing':
      return `job ${notice.jobId} is not launched: the instruction file ${notice.path} its pipeline names is missing`;
  }
}

function handoverWarningTextOf(failure: HandoverFailure): string {
  return `the handover to code ${failure.successorCodeVersion} failed at ${failure.step}: ${failure.error}; this runner keeps driving`;
}

export const RunnerWording = Object.freeze({
  decisionWordingOf,
  launchTextOf: launchTextWithEarlierSessionNoteOf,
  assistantChatTextOf,
  windDownMessage,
  resumeMessage,
  redHandoffMessageOf,
  answerMessageOf,
  runnerStateOf,
  noticeTextOf,
  handoverWarningTextOf,
});
