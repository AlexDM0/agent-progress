/**
 * The user's decisions on the board: opened once per question request, answered once (the first answer wins), or withdrawn. An answered
 * or withdrawn decision leaves the board in that hold and lives on in the log.
 */
import type { DecisionAnswered, DecisionClosed, DecisionOpened } from './@types/BoardChanges.ts';
import type { Decision, DecisionAnswer, DecisionOpening }        from './@types/Decision.ts';
import type { LogRecord }                                        from './@types/LogRecord.ts';
import type { BoardRecords }                                     from './BoardRecords.ts';
import { BoardRefusal }                                          from './BoardRefusal.ts';
import { DECISION_ID_PREFIX, FIRST_DECISION_NUMBER }             from './constants/DecisionAndIncidentVocabulary.ts';
import { NumberedIdUtil }                                        from './utils/NumberedIdUtil.ts';

function copyOf(opening: DecisionOpening, id: string, at: string): Decision {
  return {
    id,
    kind:      opening.kind,
    ticketIds: [...opening.ticketIds],
    jobId:     opening.jobId,
    askedBy:   opening.askedBy,
    requestId: opening.requestId,
    questions: opening.questions.map((question) => ({
      question:    question.question,
      header:      question.header,
      multiSelect: question.multiSelect,
      options:     question.options.map((option) => ({ label: option.label, description: option.description })),
    })),
    context:  opening.context,
    openedAt: at,
  };
}

export class Decisions {
  constructor(private readonly records: BoardRecords) {}

  /** In opening order. */
  decisions(): readonly Readonly<Decision>[] {
    return this.records.progress.decisions ?? [];
  }

  decisionById(decisionId: string): Readonly<Decision> | undefined {
    return this.decisions().find((decision) => decision.id === decisionId);
  }

  /** A request already open as a decision gives that decision back; one answered, or open as an incident, opens nothing. */
  openDecision(opening: DecisionOpening, at: string): DecisionOpened {
    const standing = opening.requestId === null ? null : this.records.questionRequestStanding(opening.jobId, opening.requestId);
    if (standing === null) return this.openUnmatchedDecision(opening, at);
    return { decision: standing.standing === 'open-decision' ? standing.decision : null, logged: [] };
  }

  /** Opens without matching the request: an escalation carries over the request of the incident it closes. */
  openUnmatchedDecision(opening: DecisionOpening, at: string): { decision: Readonly<Decision>; logged: LogRecord[] } {
    const decision = copyOf(opening, this.takeNextDecisionId(), at);
    this.records.progress.decisions ??= [];
    this.records.progress.decisions.push(decision);
    const logged = this.records.logger.log({
      kind:       'decision-opened',
      decisionId: decision.id,
      fields:     { kind: decision.kind, ticketIds: [...decision.ticketIds] },
    }, at);
    return { decision, logged: [logged] };
  }

  /** One answer per question, in the decision's order, stored keyed by each question's text. */
  answerDecision(decisionId: string, answers: readonly string[], at: string): DecisionAnswered {
    const decision = this.requireOpenDecision(decisionId);
    if (answers.length !== decision.questions.length) {
      throw new BoardRefusal({
        reason: 'decision-answer-count', decisionId, answerCount: answers.length, questionCount: decision.questions.length
      });
    }
    const answer: DecisionAnswer = Object.fromEntries(answers.map((text, i) => [decision.questions[i]?.question ?? '', text]));
    this.removeDecision(decision);
    const logged = this.records.logger.log({ kind: 'decision-answered', decisionId, fields: { answer: { ...answer } } }, at);
    return { decision, answer, logged: [logged] };
  }

  withdrawDecision(decisionId: string, reason: string, at: string): DecisionClosed {
    const decision = this.requireOpenDecision(decisionId);
    this.removeDecision(decision);
    return { decision, logged: [this.records.logger.log({ kind: 'decision-withdrawn', decisionId, fields: { reason } }, at)] };
  }

  /** A decision leaves the board only by its answer or its withdrawal, so a well-formed id below the counter was already settled. */
  private requireOpenDecision(decisionId: string): Decision {
    const decision = this.records.progress.decisions?.find((candidate) => candidate.id === decisionId);
    if (decision !== undefined) return decision;
    if (NumberedIdUtil.wasClosed(decisionId, DECISION_ID_PREFIX, this.records.progress.nextDecisionId, FIRST_DECISION_NUMBER)) {
      throw new BoardRefusal({ reason: 'decision-already-answered', decisionId });
    }
    throw new BoardRefusal({ reason: 'unknown-decision', decisionId });
  }

  private removeDecision(decision: Decision): void {
    const openDecisions = this.records.progress.decisions ?? [];
    openDecisions.splice(openDecisions.indexOf(decision), 1);
  }

  private takeNextDecisionId(): string {
    const allocated = NumberedIdUtil.allocatedNumberOf(
      this.records.progress.nextDecisionId,
      FIRST_DECISION_NUMBER,
      this.decisions().map((decision) => decision.id),
      DECISION_ID_PREFIX,
    );
    this.records.progress.nextDecisionId = allocated + 1;
    return `${DECISION_ID_PREFIX}${allocated}`;
  }
}
