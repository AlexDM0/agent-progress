/** The status words retired by the rename, each mapped to its replacement: a stored file may still hold one, and a command line may still pass one. */
import type { TaskStatus }   from '../../lib/tracker-model/@types/Task.ts';
import type { TicketStatus } from '../../lib/tracker-model/@types/Ticket.ts';

const CURRENT_TICKET_STATUS_FOR_RETIRED_WORD: Record<string, TicketStatus> = {
  open: 'pending',
  done: 'reviewed',
};

const CURRENT_TASK_STATUS_FOR_RETIRED_WORD: Record<string, TaskStatus> = {
  running:  'in-progress',
  finished: 'in-review',
};

/** `null` for anything that is not a retired ticket word, current words included, so the caller keeps the text it read. */
function currentTicketStatusFor(statusWord: string): TicketStatus | null {
  // A stored file or an argument can spell `constructor`, which a bare lookup would find on the prototype.
  return Object.hasOwn(CURRENT_TICKET_STATUS_FOR_RETIRED_WORD, statusWord) ? CURRENT_TICKET_STATUS_FOR_RETIRED_WORD[statusWord] ?? null : null;
}

/** `null` for anything that is not a retired task word, current words included, so the caller keeps the text it read. */
function currentTaskStatusFor(statusWord: string): TaskStatus | null {
  return Object.hasOwn(CURRENT_TASK_STATUS_FOR_RETIRED_WORD, statusWord) ? CURRENT_TASK_STATUS_FOR_RETIRED_WORD[statusWord] ?? null : null;
}

export const LegacyStatusUtil = { currentTicketStatusFor, currentTaskStatusFor } as const;
