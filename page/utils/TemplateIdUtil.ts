/** The element ids the page gives each task row and ticket card, which its links and the Kanban's waiting-on links point at. */

function taskRowElementIdOf(taskId: number): string {
  return `ap-task-${taskId}`;
}

function ticketCardElementIdOf(ticketId: string): string {
  return `ap-ticket-${ticketId}`;
}

function kanbanCardElementIdOf(ticketId: string): string {
  return `ap-kanban-${ticketId}`;
}

export const TemplateIdUtil = { taskRowElementIdOf, ticketCardElementIdOf, kanbanCardElementIdOf } as const;
