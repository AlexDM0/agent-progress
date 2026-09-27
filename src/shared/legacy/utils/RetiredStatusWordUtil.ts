/**
 * The status words the rename retired, with their replacements, as older stored files and command lines hold them. It can go once
 * `agent-progress update` has run in every tracker and agents no longer type the retired words.
 */
import type { TaskStatus }   from '../../../lib/tracker-model/@types/Task.ts';
import type { TicketStatus } from '../../../lib/tracker-model/@types/Ticket.ts';

export type RetiredTaskStatusWord = 'running' | 'finished';

const CURRENT_TICKET_STATUS_FOR_RETIRED_WORD: Record<string, TicketStatus> = {
  open: 'pending',
  done: 'reviewed',
};

const CURRENT_TASK_STATUS_FOR_RETIRED_WORD: Readonly<Record<RetiredTaskStatusWord, TaskStatus>> = {
  running:  'in-progress',
  finished: 'in-review',
};

/** `null` for anything that is not a retired ticket word, current words included, so the caller keeps the text it read. */
function currentTicketStatusFor(statusWord: string): TicketStatus | null {
  // A stored file or an argument can spell `constructor`, which a bare lookup would find on the prototype.
  return Object.hasOwn(CURRENT_TICKET_STATUS_FOR_RETIRED_WORD, statusWord) ? CURRENT_TICKET_STATUS_FOR_RETIRED_WORD[statusWord] ?? null : null;
}

function taskStatusWordIsRetired(statusWord: string): statusWord is RetiredTaskStatusWord {
  return Object.hasOwn(CURRENT_TASK_STATUS_FOR_RETIRED_WORD, statusWord);
}

/** `null` for anything that is not a retired task word, current words included, so the caller keeps the text it read. */
function currentTaskStatusFor(statusWord: string): TaskStatus | null {
  return taskStatusWordIsRetired(statusWord) ? CURRENT_TASK_STATUS_FOR_RETIRED_WORD[statusWord] : null;
}

export const RetiredStatusWordUtil = { currentTicketStatusFor, currentTaskStatusFor } as const;
