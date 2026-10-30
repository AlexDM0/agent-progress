/**
 * Which Kanban cards to mark as changed: a diff of two consecutive `BoardState`s, keyed as the Kanban model keys its cards. A card is
 * marked when it is new or its state moved; the first board marks nothing, since there is nothing it changed from.
 */
import type { KanbanBoardState } from '../../@types/KanbanBoardState.ts';

const NOTHING_CHANGED: ReadonlySet<string> = new Set();

/** A ticket's signature is its display state and its status, so a draft readied or a ticket held or released shows as a move too. */
function cardSignaturesOf(state: KanbanBoardState): ReadonlyMap<string, string> {
  const displayStateById = new Map(state.page.payload.boardFacts.tickets.map((facts) => [facts.ticketId, facts.displayState]));
  const ticketSignatures = state.page.tickets.map((ticket): [string, string] => [
    `ticket:${ticket.id}`,
    `${displayStateById.get(ticket.id) ?? ticket.status} ${ticket.status}${ticket.hold === undefined ? '' : ' held'}`,
  ]);
  const draftSignatures = (state.page.payload.boardFacts.drafts ?? []).map((draft): [string, string] => [`draft:${draft.id}`, draft.state]);
  return new Map([...ticketSignatures, ...draftSignatures]);
}

/** Only cards the current board holds are answered: a card that went has nothing on screen to mark. */
function changedCardKeysBetween(previous: KanbanBoardState | null, current: KanbanBoardState): ReadonlySet<string> {
  if (previous === null) return NOTHING_CHANGED;
  const previousSignatures = cardSignaturesOf(previous);
  const changed = new Set<string>();
  for (const [cardKey, signature] of cardSignaturesOf(current)) {
    if (previousSignatures.get(cardKey) !== signature) changed.add(cardKey);
  }
  return changed;
}

export const KanbanChangeHighlightModel = Object.freeze({ changedCardKeysBetween, cardSignaturesOf });
