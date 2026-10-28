/**
 * Words an `OperationRefusal` wherever the command line prints one: its own message, or its detail. A Board refusal carries only its reason
 * code and facts, and the install-version mismatch is worded as one paragraph, so the SubagentStop hook's one-report rule holds.
 */
import type { IncompleteTicket, ReadinessGap, TicketStatus } from '../../lib/tracker-model/@types/Ticket.ts';
import type { BoardRefusalDetail }                           from '../../lib/tracker-model/BoardRefusal.ts';
import { LEGAL_SOURCE_STATUSES_FOR_TICKET_STATUS }           from '../../lib/tracker-model/constants/TicketMoveLegality.ts';
import { TicketMoveUtil }                                    from '../../lib/tracker-model/utils/TicketMoveUtil.ts';
import { ROOT_OVERRIDE_VARIABLE }                            from '../../shared/Environment.ts';
import type { OperationRefusal }                             from '../../shared/OperationRefusal.ts';
import type { OperationRefusalDetail }                       from '../../shared/OperationRefusal.ts';
import { PRODUCT_NAMES }                                     from '../../shared/constants/ProductNames.ts';
import { StatusWordingUtil }                                 from './StatusWordingUtil.ts';
import { TicketPhraseUtil }                                  from './TicketPhraseUtil.ts';
import { TrackerReadingWordingUtil }                         from './TrackerReadingWordingUtil.ts';

type InstallVersionMismatchDetail = Extract<OperationRefusalDetail, { kind: 'install-version-mismatch' }>;

type OlderProgramPresentDetail = Extract<OperationRefusalDetail, { kind: 'older-program-present' }>;

const NOTHING_WAS_WRITTEN = 'Nothing was written.';

/** `1 agent is`, `2 agents are`: the count, its noun and the verb agreeing with it. */
function countedText(count: number, singularNoun: string): string {
  return count === 1 ? `1 ${singularNoun} is` : `${count} ${singularNoun}s are`;
}

function legalSourcesText(targetStatus: TicketStatus): string {
  return LEGAL_SOURCE_STATUSES_FOR_TICKET_STATUS[targetStatus].join(' or ');
}

const READINESS_GAP_TEXT: Readonly<Record<ReadinessGap, string>> = {
  'acceptance-unnumbered': 'its `## Acceptance` holds no numbered item (acceptance-unnumbered)',
  'brief-missing':         'it has no `## Brief` with a non-blank line (brief-missing)',
};

function incompleteTicketText(incompleteTicket: IncompleteTicket): string {
  return `ticket #${incompleteTicket.ticketId} is incomplete: ${incompleteTicket.gaps.map((gap) => READINESS_GAP_TEXT[gap]).join(', and ')}`;
}

function boardRefusalMessageOf(detail: BoardRefusalDetail): string {
  switch (detail.reason) {
    case 'unknown-task':
      return `There is no task #${detail.taskId}. Run \`${PRODUCT_NAMES.PROGRAM} status\` to see the rows this tracker holds.`;
    case 'ticket-owned-row':
      return `Task #${detail.taskId} belongs to ticket #${detail.ticketId}, so moving it here would leave the row and the ticket disagreeing. `
        + `Run \`${PRODUCT_NAMES.PROGRAM} ticket ${StatusWordingUtil.verbFor(detail.targetStatus)} ${detail.ticketId}\` instead, which moves both, `
        + 'or pass --force to move only the row.';
    case 'ticket-already-has-row':
      return `Ticket #${detail.ticketId} already has task #${detail.taskId} ("${detail.taskName}"). `
        + 'Pass --force to move the ticket on to the new row, or leave --ticket off.';
    case 'task-belongs-to-another-ticket':
      return `Task #${detail.taskId} already belongs to ticket #${detail.owningTicketId}. Pass --force to move it to ticket #${detail.ticketId}.`;
    case 'ticket-already-in-status':
      return `Ticket #${detail.ticketId} is already ${detail.status}, so nothing was changed and nothing was logged.`;
    case 'illegal-ticket-move':
      return `Ticket #${detail.ticketId} is ${StatusWordingUtil.statusTextFor(detail.status)}, `
        + `and \`${PRODUCT_NAMES.PROGRAM} ticket ${StatusWordingUtil.verbFor(detail.targetStatus)}\` moves a ticket that is ${legalSourcesText(detail.targetStatus)}. `
        + `Run \`${PRODUCT_NAMES.PROGRAM} ticket status ${detail.ticketId} ${detail.targetStatus}\` if you mean to set it directly.`;
    case 'move-to-draft':
      return `Ticket #${detail.ticketId} is ${StatusWordingUtil.statusTextFor(detail.status)}, and no move returns a ticket to draft: `
        + `filing is the only way in. Run \`${PRODUCT_NAMES.PROGRAM} ticket hold ${detail.ticketId}\` to keep it from being built for now.`;
    case 'move-of-a-draft':
      return `Ticket #${detail.ticketId} is a draft ticket, so it was not moved: `
        + `run \`${PRODUCT_NAMES.PROGRAM} ticket ready ${detail.ticketId}\` to ready it to build, which checks its Acceptance and Brief.`;
    case 'ready-of-a-ticket-not-in-draft':
      return `Ticket #${detail.ticketId} is ${StatusWordingUtil.statusTextFor(detail.status)}, not a draft ticket, `
        + `so nothing was readied: only a draft ticket is readied. ${NOTHING_WAS_WRITTEN}`;
    case 'incomplete-tickets':
      return `Nothing was readied: ${detail.incompleteTickets.map(incompleteTicketText).join('; ')}. `
        + `Number every Acceptance item as \`A1.\` at the start of a line and write a \`## Brief\`, then ready ${detail.incompleteTickets.length === 1 ? 'it' : 'them'} again.`;
    case 'abandon-without-reason':
      return `Ticket #${detail.ticketId} was not moved: abandon needs --reason. `
        + `Say why the work was dropped, for example \`${PRODUCT_NAMES.PROGRAM} ticket abandon 3 --reason "superseded by #7"\`.`;
    case 'tokens-without-a-row':
      return `Ticket #${detail.ticketId} has no row, so --tokens has nowhere to be recorded: `
        + 'a low-priority ticket gets its row when it is started. Drop --tokens.';
    case 'rereview-outside-review': {
      const firstReviewAdvice = TicketMoveUtil.ticketMoveIsLegal(detail.status, 'in-review')
        ? ` Run \`${PRODUCT_NAMES.PROGRAM} ticket finish ${detail.ticketId}\` to send it to its first reviewer.`
        : '';
      return `Ticket #${detail.ticketId} is ${StatusWordingUtil.statusTextFor(detail.status)}, `
        + `and another review pass needs a ticket that is in-review.${firstReviewAdvice}`;
    }
    case 'review-record-without-a-review-bar':
      return `Ticket #${detail.ticketId} has no in-progress review bar, so there is no review pass to record and nothing was logged. `
        + `A review is recorded on its own bar: \`${PRODUCT_NAMES.PROGRAM} task add "<name>" --review-of ${detail.ticketId} --start\` starts one.`;
    case 'review-bar-without-a-round':
      return `Review bar #${detail.taskId} of ticket #${detail.ticketId} stores no round, so the pass cannot be recorded and nothing was logged. `
        + `Start the pass on a bar of its own with \`${PRODUCT_NAMES.PROGRAM} task add "<name>" --review-of ${detail.ticketId} --start\`.`;
    case 'review-record-on-a-row-that-is-not-a-review-bar':
      return `Row #${detail.taskId} is not an in-progress review bar, so the review of ticket #${detail.ticketId} cannot be recorded on it and nothing was logged. `
        + 'Pass --bar the row your review runs on, the `agent-progress row:` line of your prompt.';
    case 'review-record-on-a-bar-outside-the-bundle':
      return `Review bar #${detail.taskId} reviews ticket #${detail.reviewOf}, which was not claimed with ticket #${detail.ticketId}, `
        + 'so the review cannot be recorded on it and nothing was logged. Pass --bar the review bar of the bundle holding the ticket.';
    case 'unclaimable-status':
      return `Ticket #${detail.ticketId} is ${StatusWordingUtil.statusTextFor(detail.status)}, `
        + `and \`${PRODUCT_NAMES.PROGRAM} ticket claim\` takes a ticket that is ${legalSourcesText('in-progress')}. `
        + NOTHING_WAS_WRITTEN;
    case 'claim-waits-on-dependencies':
      return `Ticket #${detail.ticketId} is ${TicketPhraseUtil.waitingOnText(detail.unsettledTicketIds)}, `
        + `which must be reviewed or delivered before it is claimed. ${NOTHING_WAS_WRITTEN}`;
    case 'claim-of-a-held-ticket':
      return `Ticket #${detail.ticketId} is held, so it is not claimed. Nothing was written; \`${PRODUCT_NAMES.PROGRAM} ticket unhold ${detail.ticketId}\` lets it be claimed.`;
    case 'claim-of-held-back-low-ticket':
      return `${TicketPhraseUtil.lowPriorityHeldBackText(detail.ticketId, detail.holdingBackTicketIds)}, so it is not claimed. `
        + `Nothing was written; \`${PRODUCT_NAMES.PROGRAM} ticket start ${detail.ticketId}\` starts it regardless.`;
    case 'claim-under-review':
      return `Ticket #${detail.ticketId} is under review: its review row #${detail.reviewBarTaskId} is in progress. ${NOTHING_WAS_WRITTEN}`;
    case 'claim-after-a-ticket-not-in-review':
      return `Ticket #${detail.ticketId} was not claimed after #${detail.afterTicketId}: #${detail.afterTicketId} is ${StatusWordingUtil.statusTextFor(detail.status)}, `
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
      return `There is no ticket ${TicketPhraseUtil.ticketReferencesText(detail.missingTicketIds)}. Run \`${PRODUCT_NAMES.PROGRAM} ticket list\` to see what this tracker holds.`;
    case 'unknown-linked-ticket':
      return `There is no ticket #${detail.missingTicketId}. ${NOTHING_WAS_WRITTEN} Run \`${PRODUCT_NAMES.PROGRAM} ticket list\` to see what this tracker holds.`;
    case 'introduced-by-on-a-non-bug':
      return `Ticket #${detail.ticketId} is a ${detail.type}, and only a bug names the ticket that introduced it. ${NOTHING_WAS_WRITTEN}`;
    case 'introduced-by-itself':
      return `Ticket #${detail.ticketId} cannot be introduced by itself. ${NOTHING_WAS_WRITTEN}`;
    case 'introduced-by-an-undelivered-ticket':
      return `Ticket #${detail.ticketId} cannot be introduced by #${detail.causeTicketId}: it is ${StatusWordingUtil.statusTextFor(detail.status)}, `
        + `and only a delivered ticket's change lets a bug escape. ${NOTHING_WAS_WRITTEN}`;
    case 'malformed-epic-key':
      return `"${detail.epicKey}" is not a usable epic key: a key is lower-case letters and digits, in words joined by single hyphens, `
        + `such as \`checkout-redesign\`. ${NOTHING_WAS_WRITTEN}`;
    case 'epic-already-exists':
      return `There is already an epic ${detail.epicKey}. Nothing was written; \`${PRODUCT_NAMES.PROGRAM} epic edit ${detail.epicKey}\` changes it.`;
    case 'unknown-epic':
      return `There is no epic ${detail.missingEpicKeys.join(', ')}. Nothing was written; run \`${PRODUCT_NAMES.PROGRAM} epic list\` to see what this tracker holds.`;
    case 'epic-still-named':
      return `Epic ${detail.epicKey} was not removed: ${TicketPhraseUtil.ticketReferencesText(detail.ticketIds)} still `
        + `${detail.ticketIds.length === 1 ? 'names' : 'name'} it. Nothing was written; `
        + `\`${PRODUCT_NAMES.PROGRAM} ticket epic <id> --remove ${detail.epicKey}\` takes it off a ticket.`;
    case 'unknown-draft':
      return `There is no open draft ${detail.draftId}. ${NOTHING_WAS_WRITTEN} Run \`${PRODUCT_NAMES.PROGRAM} draft list\` to see what this tracker holds.`;
    case 'draft-claimed-by-another-owner':
      return `Draft ${detail.draftId} was not claimed: ${detail.owner} holds it. ${NOTHING_WAS_WRITTEN} `
        + `Add --force to take it over, or wait for \`${PRODUCT_NAMES.PROGRAM} draft release ${detail.draftId}\`.`;
    case 'draft-closed-into-unknown-tickets':
      return `Draft ${detail.draftId} was not closed: there is no ticket ${detail.missingTicketReferences.join(', ')}. ${NOTHING_WAS_WRITTEN} `
        + 'File the tickets first, then close the draft into their ids.';
    case 'draft-has-open-questions':
      return `Draft ${detail.draftId} was not closed: ${detail.openQuestionIds.join(', ')} ${detail.openQuestionIds.length === 1 ? 'is' : 'are'} `
        + `still open. ${NOTHING_WAS_WRITTEN} Answer them with \`${PRODUCT_NAMES.PROGRAM} draft answer\`, or drop the moot ones with \`${PRODUCT_NAMES.PROGRAM} draft drop\`.`;
    case 'unknown-draft-question':
      return `Draft ${detail.draftId} has no question ${detail.questionId}. ${NOTHING_WAS_WRITTEN} `
        + `Run \`${PRODUCT_NAMES.PROGRAM} draft show ${detail.draftId}\` to see its questions.`;
    case 'unknown-draft-item':
      return `Draft ${detail.draftId} has no note or question ${detail.itemId}. ${NOTHING_WAS_WRITTEN} `
        + `Run \`${PRODUCT_NAMES.PROGRAM} draft show ${detail.draftId}\` to see what it holds.`;
    case 'draft-question-option-count':
      return `A question takes ${detail.minimum} to ${detail.maximum} options, and ${detail.optionCount} ${detail.optionCount === 1 ? 'was' : 'were'} given. `
        + NOTHING_WAS_WRITTEN;
    case 'draft-question-without-recommendation':
      return `A question needs --recommended <letter>, the option Claude recommends. ${NOTHING_WAS_WRITTEN}`;
    case 'unknown-draft-option-letters':
      return `There is no option ${detail.unknownLetters.join(', ')}: the options are ${detail.optionLetters.join(', ')}. ${NOTHING_WAS_WRITTEN}`;
    case 'several-letters-on-single-select-question':
      return `${detail.letters.join(', ')} names several options, and the question takes one: only a question asked with --multiple takes `
        + `several. ${NOTHING_WAS_WRITTEN}`;
    case 'check-command-change-with-tickets-in-flight':
      return `The check command was not changed: ${TicketPhraseUtil.ticketReferencesText(detail.ticketIds)} `
        + `${detail.ticketIds.length === 1 ? 'is' : 'are'} in progress or in review under the one stored, and a release refuses a ticket `
        + 'whose stamp differs from the command it runs. Nothing was written; add --restamp to stamp every ticket in flight with the new command.';
    case 'dependency-loop':
      return `That would make tickets wait on each other in a circle: ${detail.loopTicketIds.map((ticketId) => `#${ticketId}`).join(' → ')}.`;
    case 'priority-unchanged':
      return `Ticket #${detail.ticketId} is ${StatusWordingUtil.statusTextFor(detail.status)}, and its priority was not changed: `
        + `it is already ${detail.priority} priority. ${NOTHING_WAS_WRITTEN}`;
    case 'size-unchanged':
      return `Ticket #${detail.ticketId} is ${StatusWordingUtil.statusTextFor(detail.status)}, and its size was not changed: `
        + `it is already ${detail.size}. ${NOTHING_WAS_WRITTEN}`;
    case 'lowering-a-ticket-that-is-not-pending':
      return `Ticket #${detail.ticketId} is ${StatusWordingUtil.statusTextFor(detail.status)}, and its priority was not changed: `
        + 'only a draft or pending ticket can be lowered to low, '
        + `since a low ticket has no row until it is started. ${NOTHING_WAS_WRITTEN}`;
    case 'edit-of-a-ticket-past-pending':
      return `Ticket #${detail.ticketId} is ${StatusWordingUtil.statusTextFor(detail.status)}, and it was not edited: an agent may already be working from it. `
        + `${NOTHING_WAS_WRITTEN} Pass --force to edit it anyway; the change shows as the body changed since the claim.`;
    case 'agents-of-a-settled-ticket':
      return `Ticket #${detail.ticketId} is ${StatusWordingUtil.statusTextFor(detail.status)}, `
        + `and its agents were not changed: no agent will work it again. ${NOTHING_WAS_WRITTEN}`;
    case 'agents-unchanged':
      return `Ticket #${detail.ticketId} is ${StatusWordingUtil.statusTextFor(detail.status)}, and its agents were not changed: `
        + `they already run on ${TicketPhraseUtil.agentPairText(detail.agents)}. ${NOTHING_WAS_WRITTEN}`;
    case 'hold-of-a-settled-ticket':
      return `Ticket #${detail.ticketId} is ${StatusWordingUtil.statusTextFor(detail.status)}, `
        + `and no agent will work it again, so there is nothing to ${detail.action}. ${NOTHING_WAS_WRITTEN}`;
    case 'ticket-already-held':
      return `Ticket #${detail.ticketId} is already held. ${NOTHING_WAS_WRITTEN}`;
    case 'ticket-not-held':
      return `Ticket #${detail.ticketId} is not held. ${NOTHING_WAS_WRITTEN}`;
    case 'release-mark-of-a-settled-ticket':
      return `Ticket #${detail.ticketId} is ${StatusWordingUtil.statusTextFor(detail.status)}, and its release mark was not ${detail.action === 'mark' ? 'set' : 'cleared'}: `
        + `no agent will work it again. ${NOTHING_WAS_WRITTEN}`;
    case 'release-mark-of-an-ungrouped-ticket':
      return `Ticket #${detail.ticketId} belongs to no group, so it cannot be a group's release ticket. ${NOTHING_WAS_WRITTEN}`;
    case 'group-already-has-a-release-ticket':
      return detail.releaseTicketId === detail.ticketId
        ? `Ticket #${detail.ticketId} is already the release ticket of group ${detail.group}. ${NOTHING_WAS_WRITTEN}`
        : `Group ${detail.group} already has its release ticket, #${detail.releaseTicketId}: `
          + `clear it with \`${PRODUCT_NAMES.PROGRAM} ticket release-of ${detail.releaseTicketId} --clear\` first. ${NOTHING_WAS_WRITTEN}`;
    case 'ticket-is-not-a-release-ticket':
      return `Ticket #${detail.ticketId} is not its group's release ticket. ${NOTHING_WAS_WRITTEN}`;
    case 'reopen-beside-an-open-release-ticket':
      return `Ticket #${detail.ticketId} is ${StatusWordingUtil.statusTextFor(detail.status)} `
        + `and carries the release mark of group ${detail.group}, so it was not moved to ${detail.targetStatus}: `
        + `the group already has its open release ticket, #${detail.releaseTicketId}, and a group has one. `
        + `Clear that mark with \`${PRODUCT_NAMES.PROGRAM} ticket release-of ${detail.releaseTicketId} --clear\` first. ${NOTHING_WAS_WRITTEN}`;
  }
}

function installVersionMismatchMessageOf(detail: InstallVersionMismatchDetail): string {
  const {
    rootDirectory,
    manifestFilePath,
    installVersion,
    mismatch,
  } = detail;
  const runUpdateSentence = `Run \`${PRODUCT_NAMES.PROGRAM} update\` in ${rootDirectory}.`;
  switch (mismatch.reason) {
    case 'older':
      return `The files ${PRODUCT_NAMES.PROGRAM} installed in ${rootDirectory} are install version ${mismatch.installedVersion}, from an older ${PRODUCT_NAMES.PROGRAM}, `
        + `and this one needs install version ${installVersion}, so nothing was done. ${runUpdateSentence}`;
    case 'newer':
      return `The files ${PRODUCT_NAMES.PROGRAM} installed in ${rootDirectory} are install version ${mismatch.installedVersion}, from a newer ${PRODUCT_NAMES.PROGRAM} `
        + `than this one (install version ${installVersion}), so nothing was done. Update ${PRODUCT_NAMES.PROGRAM} itself, `
        + `then run \`${PRODUCT_NAMES.PROGRAM} update\` in ${rootDirectory}.`;
    case 'unversioned':
      return `The files ${PRODUCT_NAMES.PROGRAM} installed in ${rootDirectory} carry no install version (${manifestFilePath} is missing), so they are from `
        + `an ${PRODUCT_NAMES.PROGRAM} older than this one, which needs install version ${installVersion}; nothing was done. ${runUpdateSentence}`;
    case 'unreadable':
      return `${manifestFilePath} gives no install version: ${mismatch.manifestProblem}. So the install version of the files ${PRODUCT_NAMES.PROGRAM} installed in `
        + `${rootDirectory} is unknown and nothing was done. ${runUpdateSentence}`;
    case 'manifest-is-a-directory':
      return `${manifestFilePath} is a directory where ${PRODUCT_NAMES.PROGRAM} keeps its install version file, so nothing was done. `
        + `Remove that directory, then run \`${PRODUCT_NAMES.PROGRAM} update\` in ${rootDirectory}.`;
  }
}

function noTrackerAtOverrideText(overrideDirectory: string): string {
  return `No ${PRODUCT_NAMES.PROGRAM} tracker was found in ${overrideDirectory}, which ${ROOT_OVERRIDE_VARIABLE} names. `
    + `Run \`${PRODUCT_NAMES.PROGRAM} init\` there, or unset ${ROOT_OVERRIDE_VARIABLE} to search upwards from the current directory instead.`;
}

function olderProgramPresentText({
  rootDirectory, olderDataFolderPath, program, olderProgram
}: OlderProgramPresentDetail): string {
  return `${olderDataFolderPath} holds what ${olderProgram} keeps for ${rootDirectory}, and ${program} is built to run beside it only in a `
    + `repository ${olderProgram} does not track, so nothing was written. Run ${program} in a scratch repository instead.`;
}

function noTrackerFoundText(searchedFrom: string): string {
  return `No ${PRODUCT_NAMES.PROGRAM} tracker was found in ${searchedFrom} or any directory above it. Run \`${PRODUCT_NAMES.PROGRAM} init\` in the repository you want tracked.`;
}

function trackerLockHeldText(lockDirectoryPath: string): string {
  return `Another ${PRODUCT_NAMES.PROGRAM} command is holding ${lockDirectoryPath} and did not release it. If nothing else is running, remove that path and try again.`;
}

function lockTakenOverText(lockDirectoryPath: string): string {
  return `This ${PRODUCT_NAMES.PROGRAM} command held ${lockDirectoryPath} so long that another command took it over, so it stopped writing. `
    + 'The next command finishes whatever this one had committed to write; run this one again to make its change.';
}

function malformedHoldJournalText(journalFilePath: string, reason: string): string {
  return `${journalFilePath} holds an unfinished write that cannot be read (${reason}), so nothing was done. `
    + 'Repair that file, or remove it to leave that write unfinished, and try again.';
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
    case 'lock-taken-over':
      return lockTakenOverText(detail.lockDirectoryPath);
    case 'malformed-hold-journal':
      return malformedHoldJournalText(detail.journalFilePath, detail.reason);
    case 'template-token-not-unique':
      return templateTokenNotUniqueText(detail.templateFilePath, detail.token, detail.occurrenceCount);
    case 'install-version-mismatch':
      return installVersionMismatchMessageOf(detail);
    case 'older-program-present':
      return olderProgramPresentText(detail);
  }
}

export const OperationRefusalWordingUtil = {
  boardRefusalMessageOf,
  installVersionMismatchMessageOf,
  messageOf,
} as const;
