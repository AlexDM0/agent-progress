/** Words a Board refusal for the person who ran the command; the Board carries only the reason code and the facts. */
import type { TicketStatus }                                          from '../../lib/tracker-model/@types/Ticket.ts';
import type { BoardRefusalDetail }                                    from '../../lib/tracker-model/BoardRefusal.ts';
import { LEGAL_SOURCE_STATUSES_FOR_TICKET_STATUS, ticketMoveIsLegal } from '../../lib/tracker-model/constants/TicketMoveLegality.ts';
import { StatusWordingUtil }                                          from './StatusWordingUtil.ts';
import { TicketPhraseUtil }                                           from './TicketPhraseUtil.ts';

const NOTHING_WAS_WRITTEN = 'Nothing was written.';

/** `1 agent is`, `2 agents are`: the count, its noun and the verb agreeing with it. */
function countedText(count: number, singularNoun: string): string {
  return count === 1 ? `1 ${singularNoun} is` : `${count} ${singularNoun}s are`;
}

function legalSourcesText(targetStatus: TicketStatus): string {
  return LEGAL_SOURCE_STATUSES_FOR_TICKET_STATUS[targetStatus].join(' or ');
}

function messageOf(detail: BoardRefusalDetail): string {
  const {
    lowPriorityHeldBackText,
    namedTicketsText,
    ticketReferencesText,
    waitingOnText,
  } = TicketPhraseUtil;
  switch (detail.reason) {
    case 'unknown-task':
      return `There is no task #${detail.taskId}. Run \`agent-progress status\` to see the rows this tracker holds.`;
    case 'ticket-owned-row':
      return `Task #${detail.taskId} belongs to ticket #${detail.ticketId}, so moving it here would leave the row and the ticket disagreeing. `
        + `Run \`agent-progress ticket ${StatusWordingUtil.verbFor(detail.targetStatus)} ${detail.ticketId}\` instead, which moves both, `
        + 'or pass --force to move only the row.';
    case 'ticket-already-has-row':
      return `Ticket #${detail.ticketId} already has task #${detail.taskId} ("${detail.taskName}"). `
        + 'Pass --force to move the ticket on to the new row, or leave --ticket off.';
    case 'task-belongs-to-another-ticket':
      return `Task #${detail.taskId} already belongs to ticket #${detail.owningTicketId}. Pass --force to move it to ticket #${detail.ticketId}.`;
    case 'ticket-already-in-status':
      return `Ticket #${detail.ticketId} is already ${detail.status}, so nothing was changed and nothing was logged.`;
    case 'illegal-ticket-move':
      return `Ticket #${detail.ticketId} is ${detail.status}, and \`agent-progress ticket ${StatusWordingUtil.verbFor(detail.targetStatus)}\` moves a ticket that is `
        + `${legalSourcesText(detail.targetStatus)}. Run \`agent-progress ticket status ${detail.ticketId} ${detail.targetStatus}\` if you mean to set it directly.`;
    case 'abandon-without-reason':
      return `Ticket #${detail.ticketId} was not moved: abandon needs --reason. `
        + 'Say why the work was dropped, for example `agent-progress ticket abandon 3 --reason "superseded by #7"`.';
    case 'tokens-without-a-row':
      return `Ticket #${detail.ticketId} has no row, so --tokens has nowhere to be recorded: a low-priority ticket gets its row when it is started. Drop --tokens.`;
    case 'rereview-outside-review': {
      const firstReviewAdvice = ticketMoveIsLegal(detail.status, 'in-review')
        ? ` Run \`agent-progress ticket finish ${detail.ticketId}\` to send it to its first reviewer.`
        : '';
      return `Ticket #${detail.ticketId} is ${detail.status}, and another review pass needs a ticket that is in-review.${firstReviewAdvice}`;
    }
    case 'unclaimable-status':
      return `Ticket #${detail.ticketId} is ${detail.status}, and \`agent-progress ticket claim\` takes a ticket that is ${legalSourcesText('in-progress')}. `
        + NOTHING_WAS_WRITTEN;
    case 'claim-waits-on-dependencies':
      return `Ticket #${detail.ticketId} is ${waitingOnText(detail.unsettledTicketIds)}, which must be reviewed or delivered before it is claimed. `
        + NOTHING_WAS_WRITTEN;
    case 'claim-of-a-held-ticket':
      return `Ticket #${detail.ticketId} is held, so it is not claimed. Nothing was written; \`agent-progress ticket unhold ${detail.ticketId}\` lets it be claimed.`;
    case 'claim-of-held-back-low-ticket':
      return `${lowPriorityHeldBackText(detail.ticketId, detail.holdingBackTicketIds)}, so it is not claimed. `
        + `Nothing was written; \`agent-progress ticket start ${detail.ticketId}\` starts it regardless.`;
    case 'claim-under-review':
      return `Ticket #${detail.ticketId} is under review: its review row #${detail.reviewBarTaskId} is in progress. ${NOTHING_WAS_WRITTEN}`;
    case 'concurrency-limit-reached':
      return `${namedTicketsText(detail.ticketIds)} ${detail.ticketIds.length === 1 ? 'was' : 'were'} not claimed: `
        + `${countedText(detail.agentsInFlight, 'agent')} in flight (${countedText(detail.inProgressRowCount, 'row')} in progress) `
        + `and the concurrency limit is ${detail.limit} ${detail.limit === 1 ? 'agent' : 'agents'}. Nothing was written; claim once an agent has finished.`;
    case 'unknown-dependency':
      return `There is no ticket ${ticketReferencesText(detail.missingTicketIds)}. Run \`agent-progress ticket list\` to see what this tracker holds.`;
    case 'dependency-loop':
      return `That would make tickets wait on each other in a circle: ${detail.loopTicketIds.map((ticketId) => `#${ticketId}`).join(' → ')}.`;
    case 'priority-unchanged':
      return `Ticket #${detail.ticketId} is ${detail.status}, and its priority was not changed: it is already ${detail.priority} priority. ${NOTHING_WAS_WRITTEN}`;
    case 'lowering-a-ticket-that-is-not-pending':
      return `Ticket #${detail.ticketId} is ${detail.status}, and its priority was not changed: `
        + `only a pending ticket can be lowered to low, since a low ticket has no row until it is started. ${NOTHING_WAS_WRITTEN}`;
    case 'agents-of-a-settled-ticket':
      return `Ticket #${detail.ticketId} is ${detail.status}, and its agents were not changed: no agent will work it again. ${NOTHING_WAS_WRITTEN}`;
    case 'agents-unchanged':
      return `Ticket #${detail.ticketId} is ${detail.status}, and its agents were not changed: `
        + `they already run on ${TicketPhraseUtil.agentPairText(detail.agents)}. ${NOTHING_WAS_WRITTEN}`;
    case 'hold-of-a-settled-ticket':
      return `Ticket #${detail.ticketId} is ${detail.status}, and no agent will work it again, so there is nothing to ${detail.action}. ${NOTHING_WAS_WRITTEN}`;
    case 'ticket-already-held':
      return `Ticket #${detail.ticketId} is already held. ${NOTHING_WAS_WRITTEN}`;
    case 'ticket-not-held':
      return `Ticket #${detail.ticketId} is not held. ${NOTHING_WAS_WRITTEN}`;
  }
}

export const BoardRefusalWordingUtil = { messageOf } as const;
