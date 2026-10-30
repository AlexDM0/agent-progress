import type { ProcessIdentity } from '../process-identity/ProcessIdentity.ts';

export type WatcherState = 'claimed' | 'running' | 'ended';

/** `exited` and `signalled` are the child's own end; the other three mean no child ever ran. */
export type WatcherEndReason = 'exited' | 'signalled' | 'launch-unreadable' | 'socket-unbindable' | 'spawn-failed';

export interface WatcherEnd {
  readonly reason:   WatcherEndReason;
  readonly exitCode: number | null;
  readonly signal:   string | null;
  /** Why no child ran; absent when one did. */
  readonly detail?:  string;
}

/**
 * `watcher-<instance>.json`: created exclusively as the claim, then replaced atomically as the child starts and ends. An identity is `null`
 * when it could not be read, such as a child gone before it was looked at.
 */
export interface WatcherRecord {
  readonly protocolVersion:       number;
  readonly eventLogFormatVersion: number;
  readonly watcherInstance:       number;
  readonly state:                 WatcherState;
  readonly watcher:               ProcessIdentity | null;
  /** Both known once the launch file is read. */
  readonly watcherCodeVersion?:   string;
  readonly socketPath?:           string;
  readonly childProcess?:         ProcessIdentity | null;
  readonly childProcessGroupId?:  number;
  readonly end?:                  WatcherEnd;
}

export function watcherRecordTextOf(record: WatcherRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}
