/**
 * The element ids the page gives each task row and Kanban card, which its links point at, and a ticket's fragment, which names no element
 * and opens the ticket's detail instead.
 */

const TICKET_FRAGMENT_PREFIX = 'ap-ticket-';

function taskRowElementIdOf(taskId: number): string {
  return `ap-task-${taskId}`;
}

function ticketFragmentIdOf(ticketId: string): string {
  return `${TICKET_FRAGMENT_PREFIX}${ticketId}`;
}

/** The ticket id a fragment names, without its `#`; null for any other fragment. */
function ticketIdOfFragment(fragmentId: string): string | null {
  return fragmentId.startsWith(TICKET_FRAGMENT_PREFIX) && fragmentId.length > TICKET_FRAGMENT_PREFIX.length ? fragmentId.slice(TICKET_FRAGMENT_PREFIX.length) : null;
}

function kanbanCardElementIdOf(ticketId: string): string {
  return `ap-kanban-${ticketId}`;
}

export const TemplateIdUtil = {
  taskRowElementIdOf,
  ticketFragmentIdOf,
  ticketIdOfFragment,
  kanbanCardElementIdOf,
} as const;
