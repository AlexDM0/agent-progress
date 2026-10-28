import type { ProcessIdentity } from '../process-identity/ProcessIdentity.ts';

export type HostState = 'claimed' | 'running' | 'ended';

/** `exited` and `signalled` are the child's own end; the other two mean no child ever ran. */
export type HostEndReason = 'exited' | 'signalled' | 'launch-unreadable' | 'socket-unbindable' | 'spawn-failed';

export interface HostEnd {
  readonly reason:   HostEndReason;
  readonly exitCode: number | null;
  readonly signal:   string | null;
  /** Why no child ran; absent when one did. */
  readonly detail?:  string;
}

/**
 * `host-<instance>.json`: created exclusively as the claim, then replaced atomically as the child starts and ends. An identity is `null`
 * when it could not be read, such as a child gone before it was looked at.
 */
export interface HostRecord {
  readonly protocolVersion:       number;
  readonly eventLogFormatVersion: number;
  readonly hostInstance:          number;
  readonly state:                 HostState;
  readonly host:                  ProcessIdentity | null;
  /** Both known once the launch file is read. */
  readonly hostCodeVersion?:      string;
  readonly socketPath?:           string;
  readonly childProcess?:         ProcessIdentity | null;
  readonly childProcessGroupId?:  number;
  readonly end?:                  HostEnd;
}

export function hostRecordTextOf(record: HostRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}
