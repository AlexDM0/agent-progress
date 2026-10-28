/**
 * The decision kinds of the control contract: User's answer to an open decision, the first one winning. It is a `writeTracker` change, so it
 * is taken with the runner down too; the runner delivers it to the session after the hold. A `ready-drafts` answer readies the drafts its
 * chosen option names, in the answering hold.
 */
import { TicketAcceptanceUtil }  from '../../adapters/tickets/utils/TicketAcceptanceUtil.ts';
import type { ControlCommandOf } from '../../shared/@types/ControlCommand.ts';
import type { TrackerChange }    from '../tracker/TrackerPipeline.ts';

/** A `ready-drafts` option names its tickets as `#<id>`; "none" names none. */
const TICKET_MENTION_PATTERN = /#(\d+)/g;

function answerDecision(command: ControlCommandOf<'decision-answer'>, change: TrackerChange) {
  const answered = change.board.answerDecisionInForm(command.decisionId, command.answer, change.at);
  if (answered.decision.kind !== 'ready-drafts') return answered;
  const chosenIds = Object.values(answered.answer).flatMap((label) => [...label.matchAll(TICKET_MENTION_PATTERN)].map((match) => match[1] ?? ''));
  const readiableIds = chosenIds.filter((ticketId) => {
    const ticket = change.board.ticketByReference(ticketId);
    return ticket?.frontmatter.status === 'draft' && TicketAcceptanceUtil.readinessGapsOf(ticket.body).length === 0;
  });
  if (readiableIds.length === 0) return answered;
  const readied = change.board.readyDraftTickets(readiableIds, TicketAcceptanceUtil.readinessGapsOf, change.at);
  return { ...answered, logged: [...answered.logged, ...readied.logged] };
}

export const DECISION_CONTROLS = { 'decision-answer': answerDecision, } as const;
