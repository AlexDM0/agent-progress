/**
 * The narrowest contract an Overseer keeps with a Watcher of any protocol: its `watcher-<instance>.json` and its event log, each read in the Watcher's
 * own `EVENT_LOG_FORMAT_VERSION` until the Watcher ends. A Watcher below `WATCHER_PROTOCOL_OLDEST_SUPPORTED` is a `legacy-watcher`: sent no frame,
 * watched through these files alone, and stopped by signalling its recorded process group, its identity checked first.
 */
import { signalProcessGroup }                                          from '../../lib/process-identity/ProcessIdentity.ts';
import { eventLogEntriesOf, type EventLogReading }                     from '../../lib/watcher/EventLog.ts';
import type { WatcherRecord }                                          from '../../lib/watcher/WatcherRecord.ts';
import { EVENT_LOG_FORMAT_VERSION, WATCHER_PROTOCOL_OLDEST_SUPPORTED } from '../../lib/watcher/constants/WatcherProtocol.ts';

export type WatcherAttachment = 'attached' | 'legacy-watcher';

export type VersionedEventLogReading = EventLogReading | { readonly verdict: 'unsupported-format'; readonly formatVersion: number };

/** One reader per event-log format a Watcher still running may have written; a format leaves this table only once no Watcher of it can run. */
const EVENT_LOG_READERS: ReadonlyMap<number, (eventLogText: string) => EventLogReading> = new Map([
  [EVENT_LOG_FORMAT_VERSION, eventLogEntriesOf],
]);

/** An unreadable record is attached as before: only a protocol the record names below the window makes a Watcher legacy. */
function attachmentOf(record: WatcherRecord | null): WatcherAttachment {
  return record !== null && record.protocolVersion < WATCHER_PROTOCOL_OLDEST_SUPPORTED ? 'legacy-watcher' : 'attached';
}

function eventLogReadingOf(eventLogText: string, formatVersion: number): VersionedEventLogReading {
  const reader = EVENT_LOG_READERS.get(formatVersion);
  return reader === undefined ? { verdict: 'unsupported-format', formatVersion } : reader(eventLogText);
}

function readableEventLogFormats(): number[] {
  return [...EVENT_LOG_READERS.keys()].sort((a, b) => a - b);
}

/** The recorded child's group only, while it is still that process: a reused pid is never signalled. */
function stopLegacyWatcher(record: WatcherRecord): boolean {
  if (record.childProcess === undefined || record.childProcess === null) return false;
  return signalProcessGroup(record.childProcess, 'SIGTERM').verdict === 'signalled';
}

export const LegacyWatcherReader = Object.freeze({
  attachmentOf, eventLogReadingOf, readableEventLogFormats, stopLegacyWatcher
});
