/** The note a dispatcher builder claims a ticket's row under: the dispatcher writes it, its builder prompt quotes it, the CLI recognises it. */
const CLAIM_NOTE_OPENING                = 'Built by the ';
const CLAIM_NOTE_TEXT_BEFORE_TICKET_ID  = ' dispatcher run on ticket-';
const WHOLE_BOARD_RUN_LABEL             = 'whole-board';
const TICKET_RUN_LABEL_PREFIX           = 'ticket-';
const TICKET_RUN_LABEL_TICKET_SEPARATOR = '+';

function runLabelFor(ticketIds: readonly string[] | null): string {
  return ticketIds === null ? WHOLE_BOARD_RUN_LABEL : `${TICKET_RUN_LABEL_PREFIX}${ticketIds.join(TICKET_RUN_LABEL_TICKET_SEPARATOR)}`;
}

function claimNoteBoundsFor(ticketId: string): { opening: string; ending: string } {
  return { opening: CLAIM_NOTE_OPENING, ending: `${CLAIM_NOTE_TEXT_BEFORE_TICKET_ID}${ticketId}` };
}

function claimNoteFor(runLabel: string, ticketId: string): string {
  const { opening, ending } = claimNoteBoundsFor(ticketId);
  return `${opening}${runLabel}${ending}`;
}

/** Any run label's claim counts; a paused row under another note is a person's pause and stays theirs. */
function noteIsADispatcherClaimOn(note: string, ticketId: string): boolean {
  const { opening, ending } = claimNoteBoundsFor(ticketId);
  return note.startsWith(opening) && note.endsWith(ending);
}

export const DispatcherClaimNoteUtil = {
  runLabelFor,
  claimNoteFor,
  claimNoteBoundsFor,
  noteIsADispatcherClaimOn,
} as const;
