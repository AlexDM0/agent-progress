/**
 * An agent's question across its job, its decision or incident and its ticket (design section 8.2): an answer written as option letters,
 * the job's way back once answered, a question outliving its job held on its ticket, and an escalation carrying exactly the agent's words.
 */
import type {
  Decision,
  DecisionAnswer,
  DecisionAnswerForm,
  DecisionQuestion
} from './@types/Decision.ts';
import type { Incident }           from './@types/Incident.ts';
import type { Job, JobOutcome }    from './@types/Job.ts';
import type { LogRecord }          from './@types/LogRecord.ts';
import type { BoardRecords }       from './BoardRecords.ts';
import { BoardRefusal }            from './BoardRefusal.ts';
import type { Decisions }          from './Decisions.ts';
import type { IncidentEscalation } from './Incidents.ts';
import type { Jobs }               from './Jobs.ts';
import type { TicketEdits }        from './TicketEdits.ts';
import type { TicketSettings }     from './TicketSettings.ts';
import {
  AWAITING_ANSWER_HOLD_PREFIX,
  FIRST_RUN_REVIEW_HOLD,
  QUESTIONS_FACT,
  QUESTIONS_SECTION_HEADING
} from './constants/DecisionAndIncidentVocabulary.ts';
import { TicketDefaultsUtil } from './utils/TicketDefaultsUtil.ts';

const FIRST_OPTION_LETTER_CODE = 'a'.charCodeAt(0);
const MULTI_SELECT_SEPARATOR   = ', ';

/** The job outcomes that leave a question open on the ticket: the session is gone, and the next agent takes the answer. */
const OUTCOMES_THAT_REBIND_QUESTIONS: readonly JobOutcome[] = ['replaced', 'stopped'];

const TICKET_JOB_KINDS: readonly Job['kind'][] = ['build', 'review'];

function awaitingAnswerHoldOf(decisionId: string): string {
  return `${AWAITING_ANSWER_HOLD_PREFIX} (${decisionId})`;
}

function questionShapeIsWellFormed(value: unknown): value is DecisionQuestion {
  if (typeof value !== 'object' || value === null) return false;
  const question = value as Record<string, unknown>;
  return typeof question['question'] === 'string' && typeof question['header'] === 'string' && typeof question['multiSelect'] === 'boolean'
    && Array.isArray(question['options'])
    && question['options'].every((option: unknown) => typeof option === 'object' && option !== null
      && typeof (option as Record<string, unknown>)['label'] === 'string' && typeof (option as Record<string, unknown>)['description'] === 'string');
}

/** The agent's questions an incident carries, or `null` for one no question opened. */
function questionsOfIncident(incident: Pick<Incident, 'facts'>): DecisionQuestion[] | null {
  if (!Object.hasOwn(incident.facts, QUESTIONS_FACT)) return null;
  try {
    const parsed: unknown = JSON.parse(incident.facts[QUESTIONS_FACT] ?? '');
    return Array.isArray(parsed) && parsed.length > 0 && parsed.every(questionShapeIsWellFormed) ? parsed : null;
  } catch {
    return null;
  }
}

function chosenLabelsOf(decision: Readonly<Decision>, question: Readonly<DecisionQuestion>, questionIndex: number, choice: string): string {
  const letters = [...choice];
  const questionNumber = questionIndex + 1;
  if (letters.length !== 1 && !question.multiSelect) {
    throw new BoardRefusal({
      reason: 'decision-single-choice', decisionId: decision.id, questionNumber, choice
    });
  }
  const labels = letters.map((letter) => question.options[letter.charCodeAt(0) - FIRST_OPTION_LETTER_CODE]?.label);
  if (letters.length === 0 || new Set(letters).size !== letters.length || labels.some((label) => label === undefined)) {
    throw new BoardRefusal({
      reason: 'decision-option-unknown', decisionId: decision.id, questionNumber, choice, optionCount: question.options.length
    });
  }
  return labels.join(MULTI_SELECT_SEPARATOR);
}

function questionsSectionTextOf(body: string, decisionId: string, answer: DecisionAnswer): string {
  const answerLines = Object.entries(answer).map(([question, answerText]) => `- ${question}\n  Answer (${decisionId}): ${answerText}`);
  const heading = body.split(/\r?\n/).includes(QUESTIONS_SECTION_HEADING) ? [] : [QUESTIONS_SECTION_HEADING, ''];
  return `\n${[...heading, ...answerLines].join('\n')}\n`;
}

export class AgentQuestions {
  constructor(
    private readonly records: BoardRecords,
    private readonly jobRules: Jobs,
    private readonly decisionRules: Decisions,
    private readonly ticketSettings: TicketSettings,
    private readonly ticketEdits: TicketEdits,
  ) {}

  /** One answer per question; free text only for a decision asking one question. */
  answersOf(decisionId: string, form: DecisionAnswerForm): string[] {
    const decision = this.decisionRules.decisionById(decisionId);
    if (decision === undefined) return form.form === 'text' ? [form.text] : [...form.choices];
    if (form.form === 'text') {
      if (decision.questions.length > 1) {
        throw new BoardRefusal({ reason: 'decision-has-several-questions', decisionId, questionCount: decision.questions.length });
      }
      return [form.text];
    }
    if (form.choices.length !== decision.questions.length) {
      throw new BoardRefusal({
        reason: 'decision-answer-count', decisionId, answerCount: form.choices.length, questionCount: decision.questions.length
      });
    }
    return decision.questions.map((question, i) => chosenLabelsOf(decision, question, i, form.choices[i] ?? ''));
  }

  /**
   * A job waiting on this answer alone runs again, its host taking the answer; a question that outlived its job writes the answer under
   * the ticket's `## Questions` for the next agent and lifts the ticket's `awaiting answer` hold.
   */
  afterAnswer(decision: Readonly<Decision>, answer: DecisionAnswer, at: string): LogRecord[] {
    const job = decision.jobId === null ? undefined : this.jobRules.jobById(decision.jobId);
    if (job !== undefined) {
      const stillAsking = this.records.progress.decisions?.some((open) => open.jobId === job.id) === true
        || this.records.progress.incidents?.some((open) => open.jobId === job.id && questionsOfIncident(open) !== null) === true;
      return job.state === 'waiting-for-answer' && !stillAsking ? [...this.jobRules.moveJob(job.id, 'running', at).logged] : [];
    }
    if (decision.jobId !== null || decision.kind !== 'agent-question' || decision.requestId === null) return [];
    return decision.ticketIds.flatMap((ticketId) => {
      const ticket = this.records.ticketRecordById(ticketId);
      if (ticket === undefined) return [];
      const questionsSection = { text: questionsSectionTextOf(ticket.body, decision.id, answer), appends: true };
      const edited = this.ticketEdits.editTicket(ticketId, { body: questionsSection, allowsPastPending: true }, at);
      const unheld = ticket.frontmatter.hold === awaitingAnswerHoldOf(decision.id) ? this.ticketSettings.unholdTicket(ticketId, at).logged : [];
      return [...edited.logged, ...unheld];
    });
  }

  /** A ticket job that ended `replaced` or `stopped` leaves its open questions on its ticket, held `awaiting answer (E<n>)`. */
  rebindQuestionsOfEndedJob(job: Readonly<Job>, at: string): LogRecord[] {
    if (!TICKET_JOB_KINDS.includes(job.kind) || job.outcome === undefined || !OUTCOMES_THAT_REBIND_QUESTIONS.includes(job.outcome)) return [];
    const openQuestions = (this.records.progress.decisions ?? []).filter((decision) => decision.jobId === job.id && decision.kind === 'agent-question');
    return openQuestions.flatMap((decision) => {
      this.decisionRules.rebindToTickets(decision.id);
      return decision.ticketIds.flatMap((ticketId) => {
        const ticket = this.records.ticketRecordById(ticketId);
        if (ticket?.frontmatter.hold !== undefined) return [];
        return [...this.ticketSettings.holdTicket(ticketId, awaitingAnswerHoldOf(decision.id), at).logged];
      });
    });
  }

  /** What an escalation of a question incident puts to User: exactly the agent's questions, or `null` for an incident no question opened. */
  escalationOf(incident: Readonly<Incident>): IncidentEscalation | null {
    const questions = questionsOfIncident(incident);
    if (questions === null) return null;
    const job = incident.jobId === null ? undefined : this.jobRules.jobById(incident.jobId);
    return { askedBy: job?.role ?? 'runner', questions, context: '' };
  }

  /**
   * The runner's first start on a board: every low `pending` ticket v16 left is held `first-run review`, and the ids are handed back for one
   * `findings-delivered` incident; a board whose log holds a `runner-started` record, or no such ticket, holds nothing.
   */
  holdFirstRunLeftovers(at: string): { ticketIds: string[]; logged: LogRecord[] } {
    const runnerStartedBefore = [...this.records.storedLogRecords, ...this.records.loggedRecords].some((record) => record.kind === 'runner-started');
    if (runnerStartedBefore) return { ticketIds: [], logged: [] };
    const leftovers = this.records.ticketRecords.filter(({ frontmatter }) => frontmatter.status === 'pending'
      && TicketDefaultsUtil.ticketPriorityOf(frontmatter) === 'low' && frontmatter.hold === undefined);
    const logged = leftovers.flatMap(({ frontmatter }) => [...this.ticketSettings.holdTicket(frontmatter.id, FIRST_RUN_REVIEW_HOLD, at).logged]);
    return { ticketIds: leftovers.map(({ frontmatter }) => frontmatter.id), logged };
  }
}

export const AgentQuestionFacts = Object.freeze({ questionsOfIncident, awaitingAnswerHoldOf });
