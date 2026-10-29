/**
 * The one `EventSource` on `/api/events`. The browser reconnects by itself and sends the last event's id as `Last-Event-ID`, which the
 * Overseer answers with what was missed, or with a fresh `board` for an id of another Baton generation. A stream the browser gave up on
 * (closed rather than reconnecting) is opened again here, and starts from a fresh `board`.
 */
export const OVERSEER_EVENT_KINDS = ['board', 'job', 'decision', 'incident', 'overseer', 'usage'] as const;

export type OverseerEventKind = typeof OVERSEER_EVENT_KINDS[number];

export type ConnectionState = 'connecting' | 'live' | 'down';

export interface EventStreamHandlers {
  readonly onEvent:      (kind: OverseerEventKind, data: unknown) => void;
  readonly onConnection: (state: ConnectionState) => void;
}

/** The part of `EventSource` the client uses, so a spec can drive it. */
export type EventStreamSource = Pick<EventSource, 'addEventListener' | 'close' | 'readyState'>;

export interface EventStreamClientOptions {
  readonly url?:                     string;
  readonly eventSourceOf?:           (url: string) => EventStreamSource;
  readonly reopenDelayMilliseconds?: number;
}

export interface EventStreamClient {
  readonly close:       () => void;
  /** The id of the last event received, which the browser sends back as `Last-Event-ID` on its own reconnect. */
  readonly lastEventId: () => string | null;
}

const EVENTS_PATH = '/api/events';
const REOPEN_DELAY_MILLISECONDS = 2_000;
const CLOSED_READY_STATE = 2;

function open(handlers: EventStreamHandlers, options: EventStreamClientOptions = {}): EventStreamClient {
  const url = options.url ?? EVENTS_PATH;
  const eventSourceOf = options.eventSourceOf ?? ((sourceUrl: string): EventStreamSource => new EventSource(sourceUrl));
  const reopenDelay = options.reopenDelayMilliseconds ?? REOPEN_DELAY_MILLISECONDS;
  let source: EventStreamSource | null = null;
  let reopenTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  let lastEventId: string | null = null;

  const connect = (): void => {
    handlers.onConnection('connecting');
    const opened = eventSourceOf(url);
    source = opened;
    opened.addEventListener('open', () => handlers.onConnection('live'));
    opened.addEventListener('error', () => {
      handlers.onConnection('down');
      if (opened.readyState !== CLOSED_READY_STATE || closed) return;
      reopenTimer = setTimeout(connect, reopenDelay);
    });
    for (const kind of OVERSEER_EVENT_KINDS) {
      opened.addEventListener(kind, (event) => {
        const message = event as MessageEvent<string>;
        lastEventId = message.lastEventId === '' ? lastEventId : message.lastEventId;
        try {
          handlers.onEvent(kind, JSON.parse(message.data) as unknown);
        } catch {
          // A malformed event is dropped; the next `board` carries the whole state again.
        }
      });
    }
  };

  connect();
  return {
    close: () => {
      closed = true;
      if (reopenTimer !== null) clearTimeout(reopenTimer);
      source?.close();
    },
    lastEventId: () => lastEventId,
  };
}

export const EventStreamClient = Object.freeze({ open });
