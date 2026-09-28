import type { DispatchLogEntry, DispatchLogger } from '../@types/DispatchLogger.ts';
import { DispatchWordingUtil }                   from '../utils/DispatchWordingUtil.ts';

/** Each entry is worded and written the moment the run names it, so the Workflow log interleaves with the agent calls as the run made them. */
export function createWorkflowDispatchLogger(log: (message: string) => void): DispatchLogger {
  const write = (entry: DispatchLogEntry): void => { log(DispatchWordingUtil.logEntryText(entry)); };
  return {
    agentFailed:                     (subject, errorMessage) => { write({ kind: 'agent-failed', subject, errorMessage }); },
    statusShowsTheRunStopped:        (agentsInFlight) => { write({ kind: 'status-shows-the-run-stopped', agentsInFlight }); },
    ticketHeld:                      (ticketId, waitingFor) => { write({ kind: 'ticket-held', ticketId, waitingFor }); },
    ticketUnheld:                    (ticketId, waitingFor) => { write({ kind: 'ticket-unheld', ticketId, waitingFor }); },
    ticketParked:                    (ticketId, reason) => { write({ kind: 'ticket-parked', ticketId, reason }); },
    freshAgentTakesOver:             (ticketId, failure) => { write({ kind: 'fresh-agent-takes-over', ticketId, failure }); },
    ticketSkipped:                   (ticketId, claimRefusalDetail) => { write({ kind: 'ticket-skipped', ticketId, claimRefusalDetail }); },
    parkingAgentReturnedNothing:     (ticketId) => { write({ kind: 'parking-agent-returned-nothing', ticketId }); },
    mainLineMovedUnderRelease:       (ticketId, nextRound) => { write({ kind: 'main-line-moved-under-release', ticketId, nextRound }); },
    agentsDiedInARow:                (deadAgents, agentsInFlight) => { write({ kind: 'agents-died-in-a-row', deadAgents, agentsInFlight }); },
    ticketSettingsUnread:            (ticketIds) => { write({ kind: 'ticket-settings-unread', ticketIds }); },
    surveyReturnedNothing:           () => { write({ kind: 'survey-returned-nothing' }); },
    surveyStatusUnreadable:          () => { write({ kind: 'survey-status-unreadable' }); },
    surveyLeftTheMainCheckoutUnread: () => { write({ kind: 'survey-left-the-main-checkout-unread' }); },
    mainCheckoutIsDirty:             (dirtyFiles) => { write({ kind: 'main-checkout-is-dirty', dirtyFiles }); },
    rowsLeftRunning:                 (ticketIds) => { write({ kind: 'rows-left-running', ticketIds }); },
    ticketsLeftWaiting:              (ticketIds, runIsStopped) => { write({ kind: 'tickets-left-waiting', ticketIds, runIsStopped }); },
    lowPriorityLeftForTriage:        (ticketIds) => { write({ kind: 'low-priority-left-for-triage', ticketIds }); },
    heldAtEnd:                       (entries) => { write({ kind: 'held-at-end', entries }); },
    groupTicketRefused:              (ticketId, groupName) => { write({ kind: 'group-ticket-refused', ticketId, groupName }); },
    groupBundleUnread:               (groupName) => { write({ kind: 'group-bundle-unread', groupName }); },
    ticketIntegrated:                (ticketId, groupName) => { write({ kind: 'ticket-integrated', ticketId, groupName }); },
    releaseReviewLeft:               (ticketId) => { write({ kind: 'release-review-left', ticketId }); },
    roundGranted:                    (ticketId, nextRound, reworkedLines) => {
      write({
        kind: 'round-granted',
        ticketId,
        nextRound,
        reworkedLines,
      });
    },
    runDone: (deliveredCount, parkedTicketIds, findingsFiledCount, agentsRun) => {
      write({
        kind: 'run-done',
        deliveredCount,
        parkedTicketIds,
        findingsFiledCount,
        agentsRun,
      });
    },
  };
}
