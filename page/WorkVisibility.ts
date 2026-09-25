/** The note that says how much work the recent-work filter hides. */

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
