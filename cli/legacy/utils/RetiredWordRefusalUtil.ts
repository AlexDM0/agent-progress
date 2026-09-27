/**
 * It refuses the verbs and status words the rename retired, naming the word that replaced each, which agents briefed before the rename still type.
 * It can be deleted once agents no longer use the retired words.
 */
import { StatusWordingUtil }     from '../../../src/adapters/utils/StatusWordingUtil';
import type { TaskStatus }       from '../../../src/lib/tracker-model/@types/Task';
import type { TicketStatus }     from '../../../src/lib/tracker-model/@types/Ticket';
import { OperationRefusal }      from '../../../src/shared/OperationRefusal';
import { RetiredStatusWordUtil } from '../../../src/shared/legacy/utils/RetiredStatusWordUtil';
import type { ArgumentParser }   from '../../arguments/ArgumentParser';

const RETIRED_TASK_VERB_TARGETS: Record<string, TaskStatus> = { review: 'reviewed' };

const RETIRED_TICKET_VERB_TARGETS: Record<string, TicketStatus> = {
  review: 'in-review',
  done:   'reviewed',
};

/** Returns for any word that is not a retired task verb; `subcommand` is argv text, so the table is read through `Object.hasOwn`. */
function refuseARetiredTaskVerb(subcommand: string, commandArguments: ArgumentParser): void {
  const targetStatus = Object.hasOwn(RETIRED_TASK_VERB_TARGETS, subcommand) ? RETIRED_TASK_VERB_TARGETS[subcommand] : undefined;
  if (targetStatus === undefined) return;
  const taskId = commandArguments.positionals()[1] ?? '<id>';
  throw new OperationRefusal(
    'refused',
    `\`agent-progress task ${subcommand}\` was renamed: \`agent-progress task ${StatusWordingUtil.verbFor(targetStatus)} ${taskId}\` moves a row to `
    + `${StatusWordingUtil.statusWordFor(targetStatus)}. Nothing was written.`,
  );
}

/** Returns for any word that is not a retired ticket verb; a builder briefed on `review` learns that `--start-review` carries over too. */
function refuseARetiredTicketVerb(subcommand: string, commandArguments: ArgumentParser): void {
  const targetStatus = Object.hasOwn(RETIRED_TICKET_VERB_TARGETS, subcommand) ? RETIRED_TICKET_VERB_TARGETS[subcommand] : undefined;
  if (targetStatus === undefined) return;
  const ticketId                 = commandArguments.positionals()[1] ?? '<id>';
  const startReviewCarryOverText = targetStatus === 'in-review' ? ', and takes --start-review the same way' : '';
  throw new OperationRefusal(
    'refused',
    `\`agent-progress ticket ${subcommand}\` was renamed: \`agent-progress ticket ${StatusWordingUtil.verbFor(targetStatus)} ${ticketId}\` moves a ticket to `
    + `${StatusWordingUtil.statusWordFor(targetStatus)}${startReviewCarryOverText}. Nothing was written.`,
  );
}

/** Returns for any word that is not a retired task status, so the caller goes on to refuse it as unknown. */
function refuseARetiredTaskStatus(writtenStatus: string): void {
  const renamedStatus = RetiredStatusWordUtil.currentTaskStatusFor(writtenStatus);
  if (renamedStatus === null) return;
  const renamedStatusWord = StatusWordingUtil.statusWordFor(renamedStatus);
  throw new OperationRefusal('refused', `"${writtenStatus}" is the old name of the task status ${renamedStatusWord}; pass --status ${renamedStatus}.`);
}

/** Returns for any word that is not a retired ticket status; a reader who typed one meant its replacement, so the advice names that. */
function refuseARetiredTicketStatus(writtenStatus: string, retryAdviceFor: (renamedStatus: TicketStatus) => string): void {
  const renamedStatus = RetiredStatusWordUtil.currentTicketStatusFor(writtenStatus);
  if (renamedStatus === null) return;
  const renamedStatusWord = StatusWordingUtil.statusWordFor(renamedStatus);
  throw new OperationRefusal('refused', `"${writtenStatus}" is the old name of the ticket status ${renamedStatusWord}; ${retryAdviceFor(renamedStatus)}.`);
}

export const RetiredWordRefusalUtil = {
  refuseARetiredTaskVerb,
  refuseARetiredTicketVerb,
  refuseARetiredTaskStatus,
  refuseARetiredTicketStatus,
} as const;
