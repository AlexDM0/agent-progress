/**
 * The Overseer's live events for `GET /api/events`: each id is `<generation>-<n>`, kept in a bounded replay buffer, so a reconnect whose
 * `Last-Event-ID` is of this generation and still buffered gets the events after it, and any other gets a fresh `board` first. A state
 * published after a pass is diffed against the last one: `board` when anything changed, and one event per changed job, decision or
 * incident, and for the Overseer and usage.
 */
import type { BoardState } from './BoardState.ts';

export type OverseerEventKind = 'board' | 'job' | 'decision' | 'incident' | 'overseer' | 'usage';

export interface OverseerEvent {
  id:   string;
  kind: OverseerEventKind;
  data: unknown;
}

export type EventReplay = { verdict: 'replayed'; events: OverseerEvent[] } | { verdict: 'fresh' };

export interface EventBroker {
  /** Diffs the state against the last one published and sends what changed; the first state sends only `board`. */
  publishState: (state: BoardState) => void;
  /** The events a reconnect missed, or `fresh` when it must start from a whole `board`. */
  replayAfter:  (lastEventId: string | null) => EventReplay;
  /** The newest state as a `board` event carrying the newest id, for a connect that starts fresh; `null` before the first state. */
  snapshot:     () => OverseerEvent | null;
  subscribe:    (listener: (event: OverseerEvent) => void) => () => void;
}

const REPLAY_BUFFER_EVENTS = 256;

interface Identified { id: string }

function changedItemsOf(previous: readonly unknown[], next: readonly unknown[]): unknown[] {
  const previousById = new Map(previous.map((item) => [(item as Identified).id, JSON.stringify(item)]));
  return next.filter((item) => previousById.get((item as Identified).id) !== JSON.stringify(item));
}

export function createEventBroker(generation: number): EventBroker {
  const replayBuffer: OverseerEvent[] = [];
  const listeners = new Set<(event: OverseerEvent) => void>();
  let sequence = 0;
  let lastState: BoardState | null = null;
  let lastStateText: string | null = null;

  function send(kind: OverseerEventKind, data: unknown): void {
    sequence += 1;
    const event = { id: `${generation}-${sequence}`, kind, data };
    replayBuffer.push(event);
    if (replayBuffer.length > REPLAY_BUFFER_EVENTS) replayBuffer.shift();
    for (const listener of listeners) listener(event);
  }

  function publishState(state: BoardState): void {
    // The page's generation stamp moves with every reading, so it is no change of the board.
    const stateText = JSON.stringify({ ...state, page: { ...state.page, payload: { ...state.page.payload, generatedAtEpochMilliseconds: 0 } } });
    if (stateText === lastStateText) return;
    const previous = lastState;
    lastState = state;
    lastStateText = stateText;
    if (previous !== null) {
      for (const job of changedItemsOf(previous.jobs, state.jobs)) send('job', job);
      for (const decision of changedItemsOf(previous.decisions, state.decisions)) send('decision', decision);
      for (const incident of changedItemsOf(previous.incidents, state.incidents)) send('incident', incident);
      if (JSON.stringify(previous.overseer) !== JSON.stringify(state.overseer)) send('overseer', state.overseer);
      if (JSON.stringify(previous.usage) !== JSON.stringify(state.usage)) send('usage', state.usage);
    }
    send('board', state);
  }

  function replayAfter(lastEventId: string | null): EventReplay {
    if (lastEventId === null || !lastEventId.startsWith(`${generation}-`)) return { verdict: 'fresh' };
    const position = replayBuffer.findIndex((event) => event.id === lastEventId);
    if (position === -1) return { verdict: 'fresh' };
    return { verdict: 'replayed', events: replayBuffer.slice(position + 1) };
  }

  return {
    publishState,
    replayAfter,
    snapshot:  () => (lastState === null ? null : { id: `${generation}-${sequence}`, kind: 'board', data: lastState }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
