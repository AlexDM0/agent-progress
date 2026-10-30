/**
 * The Questions view as data: the open decisions, `agent-question` first, with the ones an Assistant escalated marked; the answered ones
 * from the log; the notices; and the Low-priority triage list, which is neither a decision nor a notice and adds nothing to the count.
 */
import type {
  ConversationBoardDocument,
  DecisionDocument,
  HistoryRecordDocument,
  NoticeDocument
} from '../../@types/ConversationDocuments.ts';

export interface OpenDecision {
  readonly decision:  DecisionDocument;
  /** True when an Assistant put an agent's report to User unchanged with `incident escalate`. */
  readonly escalated: boolean;
}

export interface AnsweredDecision {
  readonly decisionId: string;
  readonly answeredAt: string;
  /** The question's text to its answer, as the Overseer stored it. */
  readonly answer:     readonly (readonly [question: string, answer: string])[];
}

export interface TriageEntry {
  readonly ticketId:         string;
  readonly title:            string;
  /** A v16 leftover held `first-run review`, which no job filed. */
  readonly isLeftover:       boolean;
  readonly filedByJob:       string | null;
  /** The tickets the filing job worked on; empty for a leftover, or when the log no longer names the job. */
  readonly foundOnTicketIds: readonly string[];
  /** The agent filed it with `--needs-user`: no Assistant or User moved it to the list by hand. */
  readonly askedForUser:     boolean;
}

export interface QuestionsModel {
  readonly openDecisions:     readonly OpenDecision[];
  readonly answeredDecisions: readonly AnsweredDecision[];
  readonly notices:           readonly NoticeDocument[];
  readonly triageEntries:     readonly TriageEntry[];
  readonly openQuestionCount: number;
}

export type QuestionSelections = readonly (readonly number[])[];

/** What `decide` takes: one choice of option letters per question, or one free text for a decision of one question. */
export type DecisionAnswerDocument =
  | { readonly form: 'letters'; readonly choices: readonly string[] }
  | { readonly form: 'text'; readonly text: string };

const AGENT_QUESTION_KIND = 'agent-question';
const FIRST_RUN_REVIEW_HOLD = 'first-run review';
const USER_FINDING_ROUTE = 'user';
const FIRST_OPTION_LETTER_CODE = 'a'.codePointAt(0) ?? 0;

function historyOf(board: ConversationBoardDocument): readonly HistoryRecordDocument[] {
  return board.questionHistory ?? [];
}

function escalatedDecisionIdsOf(board: ConversationBoardDocument): ReadonlySet<string> {
  return new Set(historyOf(board).flatMap((record) => {
    const { decisionId } = record.fields;
    return record.kind === 'incident-escalated' && typeof decisionId === 'string' ? [decisionId] : [];
  }));
}

function openDecisionsOf(board: ConversationBoardDocument): OpenDecision[] {
  const escalatedIds = escalatedDecisionIdsOf(board);
  const agentQuestions = board.decisions.filter((decision) => decision.kind === AGENT_QUESTION_KIND);
  const codeOpened = board.decisions.filter((decision) => decision.kind !== AGENT_QUESTION_KIND);
  return [...agentQuestions, ...codeOpened].map((decision) => ({ decision, escalated: escalatedIds.has(decision.id) }));
}

function answeredDecisionsOf(board: ConversationBoardDocument): AnsweredDecision[] {
  return historyOf(board)
    .filter((record) => record.kind === 'decision-answered' && typeof record.decisionId === 'string')
    .map((record) => {
      const { answer } = record.fields;
      const pairs = typeof answer === 'object' && answer !== null ? Object.entries(answer).map(([question, text]) => [question, String(text)] as const) : [];
      return { decisionId: record.decisionId ?? '', answeredAt: record.at, answer: pairs };
    })
    .reverse();
}

function ticketIdsOfJob(board: ConversationBoardDocument, jobId: string): readonly string[] {
  const liveJob = board.jobs.find((job) => job.id === jobId);
  if (liveJob !== undefined) return liveJob.ticketIds;
  const launched = historyOf(board).find((record) => record.kind === 'job-launched' && record.jobId === jobId);
  const ticketIds = launched?.fields['ticketIds'];
  return Array.isArray(ticketIds) ? ticketIds.map(String) : [];
}

function triageEntriesOf(board: ConversationBoardDocument): TriageEntry[] {
  const triagedByHand = new Set(historyOf(board).flatMap((record) => (record.kind === 'ticket-triaged' && record.ticketId !== undefined ? [record.ticketId] : [])));
  return (board.page?.tickets ?? [])
    .filter((ticket) => ticket.findingRoute === USER_FINDING_ROUTE && (ticket.status === 'draft' || ticket.hold === FIRST_RUN_REVIEW_HOLD))
    .map((ticket) => {
      const isLeftover = ticket.status !== 'draft';
      const filedByJob = isLeftover ? null : ticket.filedByJob ?? null;
      return {
        ticketId:         ticket.id,
        title:            ticket.title,
        isLeftover,
        filedByJob,
        foundOnTicketIds: filedByJob === null ? [] : ticketIdsOfJob(board, filedByJob),
        askedForUser:     filedByJob !== null && !triagedByHand.has(ticket.id),
      };
    });
}

function questionsModelOf(board: ConversationBoardDocument): QuestionsModel {
  return {
    openDecisions:     openDecisionsOf(board),
    answeredDecisions: answeredDecisionsOf(board),
    notices:           board.notices ?? [],
    triageEntries:     triageEntriesOf(board),
    openQuestionCount: board.decisions.length,
  };
}

/** The tab title with the open-question count leading it, `(3) agent-progress`; the title alone with none open. */
function tabTitleOf(baseTitle: string, openQuestionCount: number): string {
  return openQuestionCount === 0 ? baseTitle : `(${openQuestionCount}) ${baseTitle}`;
}

/** The decisions opened since the ids seen before, in board order: each raises one browser notification. */
function newDecisionsOf(seenDecisionIds: ReadonlySet<string>, decisions: readonly DecisionDocument[]): DecisionDocument[] {
  return decisions.filter((decision) => !seenDecisionIds.has(decision.id));
}

function optionLetterOf(optionIndex: number): string {
  return String.fromCodePoint(FIRST_OPTION_LETTER_CODE + optionIndex);
}

/**
 * The answer a form holds, or `null` while it cannot be sent: free text answers a decision of one question; otherwise every question needs
 * a choice, a single-select question exactly one.
 */
function answerOf(decision: DecisionDocument, selections: QuestionSelections, freeText: string): DecisionAnswerDocument | null {
  if (freeText.trim() !== '') return decision.questions.length === 1 ? { form: 'text', text: freeText.trim() } : null;
  if (decision.questions.length === 0) return null;
  const choices = decision.questions.map((question, questionIndex) => {
    const chosen = [...(selections[questionIndex] ?? [])].sort((a, b) => a - b);
    const fitting = question.multiSelect ? chosen.length > 0 : chosen.length === 1;
    return fitting ? chosen.map(optionLetterOf).join('') : null;
  });
  return choices.every((choice) => choice !== null) ? { form: 'letters', choices: choices as string[] } : null;
}

export const QuestionsModelUtil = Object.freeze({
  questionsModelOf, tabTitleOf, newDecisionsOf, optionLetterOf, answerOf
});
