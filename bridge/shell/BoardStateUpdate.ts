/**
 * The Bridge's state after one event: a `board` event carries the whole `BoardState` and replaces it; `job`, `decision` and `incident`
 * replace their record by id (or add it), and `overseer` and `usage` replace their slice, between two snapshots. Before the first `board`
 * a slice event has nothing to update.
 */
import type { BoardStateDocument, IdentifiedRecord } from '../@types/BoardStateDocument.ts';
import type { OverseerEventKind }                    from '../api/EventStreamClient.ts';

function isIdentified(data: unknown): data is IdentifiedRecord {
  return typeof data === 'object' && data !== null && typeof (data as { id?: unknown }).id === 'string';
}

function withRecord(records: readonly IdentifiedRecord[], record: IdentifiedRecord): readonly IdentifiedRecord[] {
  const index = records.findIndex((existing) => existing.id === record.id);
  return index === -1 ? [...records, record] : records.map((existing, position) => (position === index ? record : existing));
}

function boardStateAfter(state: BoardStateDocument | null, kind: OverseerEventKind, data: unknown): BoardStateDocument | null {
  if (kind === 'board') return typeof data === 'object' && data !== null ? data as BoardStateDocument : state;
  if (state === null) return null;
  switch (kind) {
    case 'job':
      return isIdentified(data) ? { ...state, jobs: withRecord(state.jobs, data) } : state;
    case 'decision':
      return isIdentified(data) ? { ...state, decisions: withRecord(state.decisions, data) } : state;
    case 'incident':
      return isIdentified(data) ? { ...state, incidents: withRecord(state.incidents, data) } : state;
    case 'overseer':
      return typeof data === 'object' && data !== null ? { ...state, overseer: { ...state.overseer, ...data } } : state;
    case 'usage':
      return { ...state, usage: data };
    default:
      return state;
  }
}

export const BoardStateUpdate = Object.freeze({ boardStateAfter, withRecord });
