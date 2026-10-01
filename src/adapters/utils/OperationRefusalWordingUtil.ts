/**
 * Words an `OperationRefusal` wherever the command line prints one: its own message, or its detail. A Board refusal carries only its reason
 * code and facts, and the install-version mismatch is worded as one paragraph, so the SubagentStop hook's one-report rule holds.
 */
import type { TicketStatus }                       from '../../lib/tracker-model/@types/Ticket.ts';
import type { BoardRefusalDetail }                 from '../../lib/tracker-model/BoardRefusal.ts';
import { LEGAL_SOURCE_STATUSES_FOR_TICKET_STATUS } from '../../lib/tracker-model/constants/TicketMoveLegality.ts';
import { TicketMoveUtil }                          from '../../lib/tracker-model/utils/TicketMoveUtil.ts';
import type { OperationRefusal }                   from '../../shared/OperationRefusal.ts';
import type { OperationRefusalDetail }             from '../../shared/OperationRefusal.ts';
import { StatusWordingUtil }                       from './StatusWordingUtil.ts';
import { TicketPhraseUtil }                        from './TicketPhraseUtil.ts';
import { TrackerReadingWordingUtil }               from './TrackerReadingWordingUtil.ts';

type InstallVersionMismatchDetail = Extract<OperationRefusalDetail, { kind: 'install-version-mismatch' }>;

const NOTHING_WAS_WRITTEN = 'Nothing was written.';

/** `1 agent is`, `2 agents are`: the count, its noun and the verb agreeing with it. */
function countedText(count: number, singularNoun: string): string {
  return count === 1 ? `1 ${singularNoun} is` : `${count} ${singularNoun}s are`;
}

function legalSourcesText(targetStatus: TicketStatus): string {
  return LEGAL_SOURCE_STATUSES_FOR_TICKET_STATUS[targetStatus].join(' or ');
}

function boardRefusalMessageOf(detail: BoardRefusalDetail): string {
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
      return `Ticket #${detail.ticketId} is ${detail.status}, `
        + `and \`agent-progress ticket ${StatusWordingUtil.verbFor(detail.targetStatus)}\` moves a ticket that is ${legalSourcesText(detail.targetStatus)}. `
        + `Run \`agent-progress ticket status ${detail.ticketId} ${detail.targetStatus}\` if you mean to set it directly.`;
    case 'abandon-without-reason':
      return `Ticket #${detail.ticketId} was not moved: abandon needs --reason. `
        + 'Say why the work was dropped, for example `agent-progress ticket abandon 3 --reason "superseded by #7"`.';
    case 'tokens-without-a-row':
      return `Ticket #${detail.ticketId} has no row, so --tokens has nowhere to be recorded: `
        + 'a low-priority ticket gets its row when it is started. Drop --tokens.';
    case 'rereview-outside-review': {
      const firstReviewAdvice = TicketMoveUtil.ticketMoveIsLegal(detail.status, 'in-review')
        ? ` Run \`agent-progress ticket finish ${detail.ticketId}\` to send it to its first reviewer.`
        : '';
      return `Ticket #${detail.ticketId} is ${detail.status}, `
        + `and another review pass needs a ticket that is in-review.${firstReviewAdvice}`;
    }
    case 'unclaimable-status':
      return `Ticket #${detail.ticketId} is ${detail.status}, `
        + `and \`agent-progress ticket claim\` takes a ticket that is ${legalSourcesText('in-progress')}. `
        + NOTHING_WAS_WRITTEN;
    case 'claim-waits-on-dependencies':
      return `Ticket #${detail.ticketId} is ${TicketPhraseUtil.waitingOnText(detail.unsettledTicketIds)}, `
        + `which must be reviewed or delivered before it is claimed. ${NOTHING_WAS_WRITTEN}`;
    case 'claim-of-a-held-ticket':
      return `Ticket #${detail.ticketId} is held, so it is not claimed. Nothing was written; \`agent-progress ticket unhold ${detail.ticketId}\` lets it be claimed.`;
    case 'claim-of-held-back-low-ticket':
      return `${TicketPhraseUtil.lowPriorityHeldBackText(detail.ticketId, detail.holdingBackTicketIds)}, so it is not claimed. `
        + `Nothing was written; \`agent-progress ticket start ${detail.ticketId}\` starts it regardless.`;
    case 'claim-under-review':
      return `Ticket #${detail.ticketId} is under review: its review row #${detail.reviewBarTaskId} is in progress. ${NOTHING_WAS_WRITTEN}`;
    case 'claim-after-a-ticket-not-in-review':
      return `Ticket #${detail.ticketId} was not claimed after #${detail.afterTicketId}: #${detail.afterTicketId} is ${detail.status}, `
        + `and --after names a predecessor that is in-review. ${NOTHING_WAS_WRITTEN}`;
    case 'claim-after-a-ticket-outside-the-bundle':
      return `Ticket #${detail.ticketId} was not claimed after #${detail.afterTicketId}: `
        + `the two are not in one release bundle of the same group. ${NOTHING_WAS_WRITTEN}`;
    case 'claim-after-a-ticket-it-does-not-wait-on':
      return `Ticket #${detail.ticketId} was not claimed after #${detail.afterTicketId}: `
        + `it does not wait on #${detail.afterTicketId}. ${NOTHING_WAS_WRITTEN}`;
    case 'concurrency-limit-reached':
      return `${TicketPhraseUtil.namedTicketsText(detail.ticketIds)} ${detail.ticketIds.length === 1 ? 'was' : 'were'} not claimed: `
        + `${countedText(detail.agentsInFlight, 'agent')} in flight (${countedText(detail.inProgressRowCount, 'row')} in progress) `
        + `and the concurrency limit is ${detail.limit} ${detail.limit === 1 ? 'agent' : 'agents'}. Nothing was written; claim once an agent has finished.`;
    case 'unknown-dependency':
      return `There is no ticket ${TicketPhraseUtil.ticketReferencesText(detail.missingTicketIds)}. Run \`agent-progress ticket list\` to see what this tracker holds.`;
    case 'malformed-epic-key':
      return `"${detail.epicKey}" is not a usable epic key: a key is lower-case letters and digits, in words joined by single hyphens, `
        + `such as \`checkout-redesign\`. ${NOTHING_WAS_WRITTEN}`;
    case 'epic-already-exists':
      return `There is already an epic ${detail.epicKey}. Nothing was written; \`agent-progress epic edit ${detail.epicKey}\` changes it.`;
    case 'unknown-epic':
      return `There is no epic ${detail.missingEpicKeys.join(', ')}. Nothing was written; run \`agent-progress epic list\` to see what this tracker holds.`;
    case 'epic-still-named':
      return `Epic ${detail.epicKey} was not removed: ${TicketPhraseUtil.ticketReferencesText(detail.ticketIds)} still `
        + `${detail.ticketIds.length === 1 ? 'names' : 'name'} it. Nothing was written; `
        + `\`agent-progress ticket epic <id> --remove ${detail.epicKey}\` takes it off a ticket.`;
    case 'dependency-loop':
      return `That would make tickets wait on each other in a circle: ${detail.loopTicketIds.map((ticketId) => `#${ticketId}`).join(' → ')}.`;
    case 'priority-unchanged':
      return `Ticket #${detail.ticketId} is ${detail.status}, and its priority was not changed: `
        + `it is already ${detail.priority} priority. ${NOTHING_WAS_WRITTEN}`;
    case 'lowering-a-ticket-that-is-not-pending':
      return `Ticket #${detail.ticketId} is ${detail.status}, and its priority was not changed: `
        + 'only a pending ticket can be lowered to low, '
        + `since a low ticket has no row until it is started. ${NOTHING_WAS_WRITTEN}`;
    case 'agents-of-a-settled-ticket':
      return `Ticket #${detail.ticketId} is ${detail.status}, `
        + `and its agents were not changed: no agent will work it again. ${NOTHING_WAS_WRITTEN}`;
    case 'agents-unchanged':
      return `Ticket #${detail.ticketId} is ${detail.status}, and its agents were not changed: `
        + `they already run on ${TicketPhraseUtil.agentPairText(detail.agents)}. ${NOTHING_WAS_WRITTEN}`;
    case 'hold-of-a-settled-ticket':
      return `Ticket #${detail.ticketId} is ${detail.status}, `
        + `and no agent will work it again, so there is nothing to ${detail.action}. ${NOTHING_WAS_WRITTEN}`;
    case 'ticket-already-held':
      return `Ticket #${detail.ticketId} is already held. ${NOTHING_WAS_WRITTEN}`;
    case 'ticket-not-held':
      return `Ticket #${detail.ticketId} is not held. ${NOTHING_WAS_WRITTEN}`;
    case 'release-mark-of-a-settled-ticket':
      return `Ticket #${detail.ticketId} is ${detail.status}, and its release mark was not ${detail.action === 'mark' ? 'set' : 'cleared'}: `
        + `no agent will work it again. ${NOTHING_WAS_WRITTEN}`;
    case 'release-mark-of-an-ungrouped-ticket':
      return `Ticket #${detail.ticketId} belongs to no group, so it cannot be a group's release ticket. ${NOTHING_WAS_WRITTEN}`;
    case 'group-already-has-a-release-ticket':
      return detail.releaseTicketId === detail.ticketId
        ? `Ticket #${detail.ticketId} is already the release ticket of group ${detail.group}. ${NOTHING_WAS_WRITTEN}`
        : `Group ${detail.group} already has its release ticket, #${detail.releaseTicketId}: `
          + `clear it with \`agent-progress ticket release-of ${detail.releaseTicketId} --clear\` first. ${NOTHING_WAS_WRITTEN}`;
    case 'ticket-is-not-a-release-ticket':
      return `Ticket #${detail.ticketId} is not its group's release ticket. ${NOTHING_WAS_WRITTEN}`;
    case 'reopen-beside-an-open-release-ticket':
      return `Ticket #${detail.ticketId} is ${detail.status} and carries the release mark of group ${detail.group}, so it was not moved to ${detail.targetStatus}: `
        + `the group already has its open release ticket, #${detail.releaseTicketId}, and a group has one. `
        + `Clear that mark with \`agent-progress ticket release-of ${detail.releaseTicketId} --clear\` first. ${NOTHING_WAS_WRITTEN}`;
  }
}

function installVersionMismatchMessageOf(detail: InstallVersionMismatchDetail): string {
  const {
    rootDirectory,
    manifestFilePath,
    installVersion,
    mismatch,
  } = detail;
  const runUpdateSentence = `Run \`agent-progress update\` in ${rootDirectory}.`;
  switch (mismatch.reason) {
    case 'older':
      return `The files agent-progress installed in ${rootDirectory} are install version ${mismatch.installedVersion}, from an older agent-progress, `
        + `and this one needs install version ${installVersion}, so nothing was done. ${runUpdateSentence}`;
    case 'newer':
      return `The files agent-progress installed in ${rootDirectory} are install version ${mismatch.installedVersion}, from a newer agent-progress `
        + `than this one (install version ${installVersion}), so nothing was done. Update agent-progress itself, then run \`agent-progress update\` in ${rootDirectory}.`;
    case 'unversioned':
      return `The files agent-progress installed in ${rootDirectory} carry no install version (${manifestFilePath} is missing), so they are from `
        + `an agent-progress older than this one, which needs install version ${installVersion}; nothing was done. ${runUpdateSentence}`;
    case 'unreadable':
      return `${manifestFilePath} gives no install version: ${mismatch.manifestProblem}. So the install version of the files agent-progress installed in `
        + `${rootDirectory} is unknown and nothing was done. ${runUpdateSentence}`;
    case 'manifest-is-a-directory':
      return `${manifestFilePath} is a directory where agent-progress keeps its install version file, so nothing was done. `
        + `Remove that directory, then run \`agent-progress update\` in ${rootDirectory}.`;
  }
}

function noTrackerAtOverrideText(overrideDirectory: string): string {
  return `No agent-progress tracker was found in ${overrideDirectory}, which AGENT_PROGRESS_ROOT names. `
    + 'Run `agent-progress init` there, or unset AGENT_PROGRESS_ROOT to search upwards from the current directory instead.';
}

function noTrackerFoundText(searchedFrom: string): string {
  return `No agent-progress tracker was found in ${searchedFrom} or any directory above it. Run \`agent-progress init\` in the repository you want tracked.`;
}

function trackerLockHeldText(lockDirectoryPath: string): string {
  return `Another agent-progress command is holding ${lockDirectoryPath} and did not release it. If nothing else is running, remove that path and try again.`;
}

function templateTokenNotUniqueText(templateFilePath: string, token: string, occurrenceCount: number): string {
  return `the page template ${templateFilePath} holds ${occurrenceCount} occurrences of ${token}, not exactly one`;
}

function messageOf(refusal: OperationRefusal): string {
  const { detail } = refusal;
  if (detail === null) return refusal.message;
  switch (detail.kind) {
    case 'board-refusal':
      return boardRefusalMessageOf(detail.boardRefusal);
    case 'unreadable-tracker':
      return TrackerReadingWordingUtil.refusalMessageOf(detail.reading);
    case 'no-tracker-at-override':
      return noTrackerAtOverrideText(detail.overrideDirectory);
    case 'no-tracker-found':
      return noTrackerFoundText(detail.searchedFrom);
    case 'tracker-lock-held':
      return trackerLockHeldText(detail.lockDirectoryPath);
    case 'template-token-not-unique':
      return templateTokenNotUniqueText(detail.templateFilePath, detail.token, detail.occurrenceCount);
    case 'install-version-mismatch':
      return installVersionMismatchMessageOf(detail);
  }
}

export const OperationRefusalWordingUtil = {
  boardRefusalMessageOf,
  installVersionMismatchMessageOf,
  messageOf,
} as const;
