/**
 * The narrowest contract a runner keeps with a host of any protocol: its `host-<instance>.json` and its event log, each read in the host's
 * own `EVENT_LOG_FORMAT_VERSION` until the host ends. A host below `HOST_PROTOCOL_OLDEST_SUPPORTED` is a `legacy-host`: sent no frame,
 * watched through these files alone, and stopped by signalling its recorded process group, its identity checked first.
 */
import { eventLogEntriesOf, type EventLogReading }                  from '../../lib/agent-host/EventLog.ts';
import type { HostRecord }                                          from '../../lib/agent-host/HostRecord.ts';
import { EVENT_LOG_FORMAT_VERSION, HOST_PROTOCOL_OLDEST_SUPPORTED } from '../../lib/agent-host/constants/HostProtocol.ts';
import { signalProcessGroup }                                       from '../../lib/process-identity/ProcessIdentity.ts';

export type HostAttachment = 'attached' | 'legacy-host';

export type VersionedEventLogReading = EventLogReading | { readonly verdict: 'unsupported-format'; readonly formatVersion: number };

/** One reader per event-log format a host still running may have written; a format leaves this table only once no host of it can run. */
const EVENT_LOG_READERS: ReadonlyMap<number, (eventLogText: string) => EventLogReading> = new Map([
  [EVENT_LOG_FORMAT_VERSION, eventLogEntriesOf],
]);

/** An unreadable record is attached as before: only a protocol the record names below the window makes a host legacy. */
function attachmentOf(record: HostRecord | null): HostAttachment {
  return record !== null && record.protocolVersion < HOST_PROTOCOL_OLDEST_SUPPORTED ? 'legacy-host' : 'attached';
}

function eventLogReadingOf(eventLogText: string, formatVersion: number): VersionedEventLogReading {
  const reader = EVENT_LOG_READERS.get(formatVersion);
  return reader === undefined ? { verdict: 'unsupported-format', formatVersion } : reader(eventLogText);
}

function readableEventLogFormats(): number[] {
  return [...EVENT_LOG_READERS.keys()].sort((a, b) => a - b);
}

/** The recorded child's group only, while it is still that process: a reused pid is never signalled. */
function stopLegacyHost(record: HostRecord): boolean {
  if (record.childProcess === undefined || record.childProcess === null) return false;
  return signalProcessGroup(record.childProcess, 'SIGTERM').verdict === 'signalled';
}

export const LegacyHostReader = Object.freeze({
  attachmentOf, eventLogReadingOf, readableEventLogFormats, stopLegacyHost
});
