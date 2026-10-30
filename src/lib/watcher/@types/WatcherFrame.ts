import type { EventLogEntry } from '../EventLog.ts';
import type { WatcherEnd }    from '../WatcherRecord.ts';

/** Watcher-level only: busy is a line arrived since the last `close-input`, ended is the child exited; the Overseer derives the job state. */
export type WatcherActivity = 'busy' | 'idle' | 'stopping' | 'ended';

export type WatcherRefusalReason = 'protocol' | 'secret';

export interface HelloFrame {
  readonly kind:            'hello';
  readonly protocolVersion: number;
  /** History starts after this sequence; 0 asks for the whole log. */
  readonly sinceSequence:   number;
  readonly watcherSecret:   string;
}

export interface WriteFrame {
  readonly kind: 'write';
  readonly line: string;
}

export interface CloseInputFrame {
  readonly kind: 'close-input';
}

export interface StopFrame {
  readonly kind:              'stop';
  readonly graceMilliseconds: number;
}

/** What a client may send, one JSON object per line. */
export type ClientFrame = HelloFrame | WriteFrame | CloseInputFrame | StopFrame;

/** Every client frame but `hello`: the ones that act on the child. */
export type ActingFrame = Exclude<ClientFrame, HelloFrame>;

export interface WelcomeFrame {
  readonly kind:               'welcome';
  readonly protocolVersion:    number;
  readonly watcherCodeVersion: string;
  readonly jobId:              string;
  readonly lastSequence:       number;
  readonly state:              WatcherActivity;
}

export interface HistoryFrame {
  readonly kind:    'history';
  readonly entries: readonly EventLogEntry[];
}

export interface MessageFrame {
  readonly kind:  'message';
  readonly entry: EventLogEntry;
}

export interface StateFrame {
  readonly kind:  'state';
  readonly state: WatcherActivity;
  readonly end?:  WatcherEnd;
}

export interface RefusedFrame {
  readonly kind:   'refused';
  readonly reason: WatcherRefusalReason;
}

/** What the Watcher sends, one JSON object per line. */
export type WatcherFrame = WelcomeFrame | HistoryFrame | MessageFrame | StateFrame | RefusedFrame;
