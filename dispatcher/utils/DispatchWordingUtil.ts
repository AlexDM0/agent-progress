/** The dispatcher's output edge: every sentence it logs, labels an agent with, parks a ticket for or returns, worded from reason codes. */
import { DISPATCH_PROTOCOL }     from '../../src/shared/constants/DispatchProtocol.ts';
import type { DispatchLogEntry } from '../@types/DispatchLogger.ts';
import type {
  DispatchOutcome,
  DispatchSummary,
  ParkReason,
  PassFailure,
  RoundRefusal
} from '../@types/DispatchOutcome.ts';
import type { DispatchSettingsRefusal }  from '../@types/DispatchSettings.ts';
import type { AgentSubject, RowRelease } from '../@types/DispatchWork.ts';
import { DISPATCH_ARGUMENTS }            from '../constants/DispatchArguments.ts';

function settingsRefusalText(refusal: DispatchSettingsRefusal): string {
  if (refusal.reason === 'missing-argument') return `The dispatcher needs args.${refusal.argumentName}: args are ${DISPATCH_ARGUMENTS.SUMMARY_TEXT}.`;
  return `The dispatcher's args.ticketIds is a non-empty list of ticket ids when given: args are ${DISPATCH_ARGUMENTS.SUMMARY_TEXT}.`;
}

function agentLabelOf(subject: AgentSubject): string {
  switch (subject.kind) {
    case 'survey':
      return 'survey';
    case 'ticket-settings':
      return 'ticket settings';
    case 'build':
      return `build #${subject.ticketId}`;
    case 'review':
      return `review ${subject.round} #${subject.ticketId}`;
    case 'park':
      return `park #${subject.ticketId}`;
  }
}

function ticketListText(ticketIds: readonly string[]): string {
  return ticketIds.map((ticketId) => `#${ticketId}`).join(', ');
}

function parentheticalOf(detail: string): string {
  return detail.trim() !== '' ? ` (${detail.trim()})` : '';
}

function passFailureText(failure: PassFailure): string {
  switch (failure.cause) {
    case 'builder-returned-nothing':
      return 'the builder returned no result';
    case 'own-claim-refused':
      return `the claim was refused while this run's own claim holds the ticket${parentheticalOf(failure.detail)}`;
    case 'builder-stopped-short':
      return `the builder did not reach review${parentheticalOf(failure.detail)}`;
    case 'reviewer-returned-nothing':
      return 'the reviewer returned no result';
    case 'review-does-not-hold':
      return 'the review found it does not hold';
  }
}

function roundBefore(round: number): number {
  return round - 1;
}

function roundRefusalText(refusal: RoundRefusal): string {
  const refused = `round ${refusal.requestedRound} refused`;
  switch (refusal.reason) {
    case 'rework-not-over-threshold':
      return `${refused}: ${refusal.reworkedLines} reworked lines, not over ${DISPATCH_PROTOCOL.REWORK_ROUND_THRESHOLD_LINES}`;
    case 'previous-round-not-reviewed-in-this-run':
      return `${refused}: round ${roundBefore(roundBefore(refusal.requestedRound))} was not reviewed in this run, so convergence cannot be judged`;
    case 'findings-not-halved':
      return `${refused}: ${refusal.findingCount} findings against ${refusal.previousFindingCount} the round before, more than half`;
    case 'finding-class-returned':
      return `${refused}: the class "${refusal.findingClass}" came back`;
    case 'new-file-named':
      return `${refused}: ${refusal.file} was named by no earlier round`;
  }
}

function parkReasonText(reason: ParkReason): string {
  switch (reason.cause) {
    case 'second-failed-pass':
      return `${passFailureText(reason.failure)}, the second failed pass`;
    case 'release-refused':
      return `the release was refused: ${reason.statedReason}`;
    case 'main-line-moved':
      return `the main line moved under ${reason.releases} releases`;
    case 'round-refused':
      return roundRefusalText(reason.refusal);
  }
}

function boardLogLineOf(ticketId: string, release: RowRelease): string {
  switch (release.cause) {
    case 'parked':
      return `Parked #${ticketId}: ${parkReasonText(release.parkReason)}`;
    case 'held':
      return `Paused the rows of #${ticketId}: held`;
    case 'left-for-the-go':
      return `Paused the row of #${ticketId}: left for the user's go`;
  }
}

function logEntryText(entry: DispatchLogEntry): string {
  switch (entry.kind) {
    case 'agent-failed':
      return `${agentLabelOf(entry.subject)}: the agent failed (${entry.errorMessage}); read as no result.`;
    case 'status-shows-the-run-stopped':
      return `The board is stopped: no new agent starts, and the ${entry.agentsInFlight} in flight finish.`;
    case 'ticket-held':
      return `#${entry.ticketId} is held: its ${entry.waitingFor} waits for \`agent-progress ticket unhold ${entry.ticketId}\`.`;
    case 'ticket-unheld':
      return `#${entry.ticketId} is no longer held: its ${entry.waitingFor} starts.`;
    case 'ticket-parked':
      return `#${entry.ticketId} parked: ${parkReasonText(entry.reason)}.`;
    case 'fresh-agent-takes-over':
      return `#${entry.ticketId}: ${passFailureText(entry.failure)}; a fresh agent takes it.`;
    case 'ticket-skipped':
      return `#${entry.ticketId} skipped for this run: the claim was refused (${entry.claimRefusalDetail}).`;
    case 'parking-agent-returned-nothing':
      return `#${entry.ticketId}: the parking agent returned nothing, so its row may still be running and count against the limit until it is paused by hand.`;
    case 'main-line-moved-under-release':
      return `#${entry.ticketId}: the main line moved and the reviewer did not finish the release; round ${entry.nextRound} takes it.`;
    case 'round-granted':
      return `#${entry.ticketId}: round ${entry.nextRound} granted at ${entry.reworkedLines} reworked lines.`;
    case 'agents-died-in-a-row':
      return `${entry.deadAgents} agents in a row returned nothing, a session limit or a lost connection: no new agent starts, `
        + `and the ${entry.agentsInFlight} in flight finish.`;
    case 'ticket-settings-unread':
      return `The ticket settings came back unread, so ${ticketListText(entry.ticketIds)} run on the default model and effort.`;
    case 'survey-returned-nothing':
      return 'The survey returned no board, so nothing was dispatched.';
    case 'survey-status-unreadable':
      return 'The survey returned no readable concurrency block, so nothing was dispatched.';
    case 'rows-left-running':
      return `No slot free for an agent to pause the row of ${ticketListText(entry.ticketIds)}: pause it with \`agent-progress task pause\`.`;
    case 'tickets-left-waiting':
      if (entry.runIsStopped) return `Left for the user's go: ${ticketListText(entry.ticketIds)}.`;
      return `No slot free for ${ticketListText(entry.ticketIds)}: other agents hold the board's limit.`;
    case 'low-priority-left-for-triage':
      return `Left for the orchestrator's triage, low priority: ${ticketListText(entry.ticketIds)}.`;
    case 'held-at-end':
      return `Held, for the next run once unheld: ${entry.entries.map((heldEntry) => `#${heldEntry.ticketId} (${heldEntry.waitingFor})`).join(', ')}.`;
    case 'run-done': {
      const parkedText = entry.parkedTicketIds.length > 0 ? ` (${ticketListText(entry.parkedTicketIds)})` : '';
      return `Done: ${entry.deliveredCount} delivered, ${entry.parkedTicketIds.length} parked${parkedText}, `
        + `${entry.findingsFiledCount} findings filed, ${entry.agentsRun} agents run.`;
    }
  }
}

// Keys go in the order the Workflow run has always returned them, and a key with nothing to say is left out.
function summaryOf(outcome: DispatchOutcome): DispatchSummary {
  const summary: DispatchSummary = {
    delivered:     outcome.delivered,
    parked:        outcome.parked.map((parkedTicket) => ({ id: parkedTicket.ticketId, reason: parkReasonText(parkedTicket.reason) })),
    findingsFiled: outcome.findingsFiled,
    agentsRun:     outcome.agentsRun,
  };
  if (outcome.runWasStoppedByBoard) summary.stoppedByBoard = true;
  if (outcome.runWasStoppedByFailures) summary.stoppedByFailures = true;
  if (outcome.lowPriorityWaiting.length > 0) summary.lowPriorityWaiting = outcome.lowPriorityWaiting;
  if (outcome.held.length > 0) summary.held = outcome.held.map((heldEntry) => ({ id: heldEntry.ticketId, waitingFor: heldEntry.waitingFor }));
  if (outcome.pausedBuilds.length > 0) summary.pausedBuilds = outcome.pausedBuilds;
  if (outcome.reviewsLeft.length > 0) summary.reviewsLeft = outcome.reviewsLeft;
  return summary;
}

export const DispatchWordingUtil = {
  settingsRefusalText,
  agentLabelOf,
  passFailureText,
  parkReasonText,
  boardLogLineOf,
  logEntryText,
  summaryOf,
} as const;
