/** What the page showed before an idle reload against what it shows after: the signature of a board, read back from storage, and the difference. */

import type { DisplayState }    from '../../../src/lib/tracker-model/@types/Task.ts';
import type { PageBoard }       from '../../@types/PageBoard.ts';
import type { ScreenSignature } from '../../@types/ViewerChoices.ts';
import { JsonValueUtil }        from '../../utils/JsonValueUtil.ts';

export interface SignatureChanges {
  newIds:       readonly string[];
  changedIds:   readonly string[];
  unchangedIds: readonly string[];
}

export interface ScreenChanges {
  tasks:   SignatureChanges;
  tickets: SignatureChanges;
}

function signatureEntryOf(state: DisplayState, reviewRound: number | undefined): string {
  return reviewRound === undefined ? state : `${state} round ${reviewRound}`;
}

function screenSignatureOf(board: PageBoard): ScreenSignature {
  return {
    tasks:   Object.fromEntries(board.rows.map((row) => [String(row.id), signatureEntryOf(row.displayState, row.reviewRound)])),
    tickets: Object.fromEntries(board.tickets.map((ticket) => [ticket.id, signatureEntryOf(ticket.displayState, ticket.ownRow?.reviewRound)])),
  };
}

function signatureEntriesFrom(value: unknown): Readonly<Record<string, string>> | null {
  if (!JsonValueUtil.valueIsRecord(value)) {
    return null;
  }
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

/** Null unless both halves are records, so a half-read signature never shows every item of the missing half as new. */
function screenSignatureFrom(value: unknown): ScreenSignature | null {
  if (!JsonValueUtil.valueIsRecord(value)) {
    return null;
  }
  const tasks   = signatureEntriesFrom(value['tasks']);
  const tickets = signatureEntriesFrom(value['tickets']);
  return tasks === null || tickets === null ? null : { tasks, tickets };
}

function signatureChangesBetween(previous: Readonly<Record<string, string>>, current: Readonly<Record<string, string>>): SignatureChanges {
  const newIds: string[]       = [];
  const changedIds: string[]   = [];
  const unchangedIds: string[] = [];
  for (const [id, entry] of Object.entries(current)) {
    if (!Object.hasOwn(previous, id)) {
      newIds.push(id);
    } else if (previous[id] === entry) {
      unchangedIds.push(id);
    } else {
      changedIds.push(id);
    }
  }
  return { newIds, changedIds, unchangedIds };
}

/** Only what the current signature holds is answered: an item that disappeared has nothing on screen to show. */
function changesBetween(previous: ScreenSignature, current: ScreenSignature): ScreenChanges {
  return {
    tasks:   signatureChangesBetween(previous.tasks, current.tasks),
    tickets: signatureChangesBetween(previous.tickets, current.tickets),
  };
}

function highlightedIdsOf(changes: SignatureChanges): ReadonlySet<string> {
  return new Set([...changes.newIds, ...changes.changedIds]);
}

export const ScreenSignatureUtil = {
  screenSignatureOf,
  screenSignatureFrom,
  changesBetween,
  highlightedIdsOf,
} as const;
