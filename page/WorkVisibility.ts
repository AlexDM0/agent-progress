/** The viewer's choice between recent and all work, and the note that says how much of it is hidden. */

export type WorkVisibility = 'recent' | 'all';

export const DEFAULT_WORK_VISIBILITY: WorkVisibility = 'recent';

export function workVisibilityFrom(value: unknown): WorkVisibility {
  return value === 'all' ? 'all' : DEFAULT_WORK_VISIBILITY;
}

export function workVisibilityStorageKeyFor(trackerId: string): string {
  return `agent-progress:${trackerId}:visibility`;
}

export function hiddenWorkNoteText(hiddenTaskCount: number, hiddenTicketCount: number): string {
  const parts: string[] = [];
  if (hiddenTaskCount > 0) {
    parts.push(`${hiddenTaskCount} task${hiddenTaskCount === 1 ? '' : 's'}`);
  }
  if (hiddenTicketCount > 0) {
    parts.push(`${hiddenTicketCount} ticket${hiddenTicketCount === 1 ? '' : 's'}`);
  }
  return parts.length === 0 ? '' : `${parts.join(' · ')} hidden`;
}
