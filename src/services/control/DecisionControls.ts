/**
 * The decision kinds of the control contract: User's answer to an open decision, the first one winning. It is a `writeTracker` change, so it
 * is taken with the runner down too; the runner delivers it to the session after the hold.
 */
import type { ControlCommandOf } from '../../shared/@types/ControlCommand.ts';
import type { TrackerChange }    from '../tracker/TrackerPipeline.ts';

function answerDecision(command: ControlCommandOf<'decision-answer'>, change: TrackerChange) {
  return change.board.answerDecisionInForm(command.decisionId, command.answer, change.at);
}

export const DECISION_CONTROLS = { 'decision-answer': answerDecision, } as const;
