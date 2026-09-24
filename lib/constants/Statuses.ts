/** The vocabularies as runtime tuples, since nothing can enumerate a type; `lib/constants/Statuses.spec.ts` pins them to `lib/constants/Types.ts`. */
import type {
  DispatcherState,
  TaskStatus,
  TicketPriority,
  TicketStatus,
  TicketType
} from './Types.ts';

export const TASK_STATUSES = ['pending', 'running', 'paused', 'finished', 're-review', 'reviewed', 'delivered', 'abandoned'] as const;

export const TICKET_STATUSES = ['open', 'in-progress', 'in-review', 'done', 'delivered', 'abandoned'] as const;

export const TICKET_TYPES = ['bug', 'change', 'feature'] as const;

export const TICKET_PRIORITIES = ['low', 'normal', 'high'] as const;

export const DISPATCHER_STATES = ['running', 'finished', 'stopped'] as const satisfies readonly DispatcherState[];

export const DEFAULT_TICKET_PRIORITY: TicketPriority = 'normal';

/** A membership test, not a record lookup: `constructor` is a truthy, callable property of every object and argv can spell it. */
export function taskStatusIsKnown(text: string): text is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(text);
}

export function ticketStatusIsKnown(text: string): text is TicketStatus {
  return (TICKET_STATUSES as readonly string[]).includes(text);
}

export function ticketTypeIsKnown(text: string): text is TicketType {
  return (TICKET_TYPES as readonly string[]).includes(text);
}

export function ticketPriorityIsKnown(text: string): text is TicketPriority {
  return (TICKET_PRIORITIES as readonly string[]).includes(text);
}

export function ticketPriorityOf(ticket: { priority?: TicketPriority }): TicketPriority {
  return ticket.priority ?? DEFAULT_TICKET_PRIORITY;
}

/** `in-review` → `finished` and `done` → `reviewed` read backwards until you notice the two ladders are named from opposite ends. */
export const TASK_STATUS_FOR_TICKET_STATUS: Record<TicketStatus, TaskStatus> = {
  'open':        'pending',
  'in-progress': 'running',
  'in-review':   'finished',
  'done':        'reviewed',
  'delivered':   'delivered',
  'abandoned':   'abandoned',
};

/** Nothing more will happen to a row or ticket in one of these: the page counts them as work completed, and `status` hides them. */
export const SETTLED_TASK_STATUSES: readonly TaskStatus[] = ['delivered', 'abandoned'];

export const SETTLED_TICKET_STATUSES: readonly TicketStatus[] = ['delivered', 'abandoned'];

/** Abandoned is left out on purpose: the work a dependent ticket waited for never happened. */
export const TICKET_STATUSES_THAT_SETTLE_A_DEPENDENCY: readonly TicketStatus[] = ['done', 'delivered'];

export const PROGRESS_FILE_NAME = 'progress.json';

export const HTML_FILE_NAME = 'progress.html';

export const TRACKER_DIRECTORY_NAME = '.agent-progress';

export const TICKETS_DIRECTORY_NAME = 'tickets';

/** Beside the tickets rather than in the repository's own tree: it is guidance for agents, not source, and the tracker is git-ignored. */
export const AGENT_BRIEF_FILE_NAME = 'agent-brief.md';

export const LOCK_DIRECTORY_NAME = '.lock';

export const CLAUDE_MANAGED_START = '<!-- agent-progress:managed:start -->';

/** Neither marker may contain the other: `lib/platform/ClaudeInstructions.ts` finds the end by searching forward from the start. */
export const CLAUDE_MANAGED_END = '<!-- agent-progress:managed:end -->';
