/**
 * An Overseer update must never strand a running agent, so every event-log format and watcher-record version a Watcher still running may have
 * written is read by the current code: one fixture per supported version under `testing/fixtures/`, each read back whole, and a format
 * with no reader is reported rather than misread. What matters about a legacy Watcher: only a protocol below the supported window makes it
 * one, and its stop is a signal to its recorded group, never to a process that merely reuses the pid.
 */
import { readFileSync } from 'node:fs';
import { join }         from 'node:path';

import { describe, expect, test } from 'bun:test';

import { identityOf }                                                  from '../../lib/process-identity/ProcessIdentity.ts';
import type { WatcherRecord }                                          from '../../lib/watcher/WatcherRecord.ts';
import { WATCHER_PROTOCOL_OLDEST_SUPPORTED, WATCHER_PROTOCOL_VERSION } from '../../lib/watcher/constants/WatcherProtocol.ts';
import { LegacyWatcherReader }                                         from './LegacyWatcherReader.ts';

const FIXTURES_FOLDER = join(import.meta.dir, 'testing', 'fixtures');

function fixtureText(fileName: string): string {
  return readFileSync(join(FIXTURES_FOLDER, fileName), 'utf8');
}

function watcherRecordFixture(formatVersion: number): WatcherRecord {
  return JSON.parse(fixtureText(`watcher-record-format-${formatVersion}.json`)) as WatcherRecord;
}

describe('every supported event-log format', () => {
  test('there is at least one, and each has a fixture its reader reads whole, ignoring a last line cut short', () => {
    const formats = LegacyWatcherReader.readableEventLogFormats();
    expect(formats.length).toBeGreaterThan(0);
    for (const formatVersion of formats) {
      const reading = LegacyWatcherReader.eventLogReadingOf(`${fixtureText(`event-log-format-${formatVersion}.jsonl`)}{"sequence":4,"orig`, formatVersion);
      if (reading.verdict !== 'read') throw new Error(`format ${formatVersion} read ${reading.verdict}`);
      expect(reading.entries.map((entry) => [entry.sequence, entry.origin])).toEqual([[1, 'agent'], [2, 'client'], [3, 'watcher']]);
      expect(reading.entries[1]?.line).toContain('Example line from Alex Example');
    }
  });

  test('a format no reader knows is reported unsupported, never read as the current one', () => {
    const unknownFormat = Math.max(...LegacyWatcherReader.readableEventLogFormats()) + 1;
    expect(LegacyWatcherReader.eventLogReadingOf(fixtureText('event-log-format-1.jsonl'), unknownFormat)).toEqual({ verdict: 'unsupported-format', formatVersion: unknownFormat });
  });

  test('each format\'s watcher-record fixture names its own format and a protocol the Overseer still reads', () => {
    for (const formatVersion of LegacyWatcherReader.readableEventLogFormats()) {
      const record = watcherRecordFixture(formatVersion);
      expect(record.eventLogFormatVersion).toBe(formatVersion);
      expect(record.protocolVersion).toBeLessThanOrEqual(WATCHER_PROTOCOL_VERSION);
      expect(record.childProcess?.processId).toBe(record.childProcessGroupId);
    }
  });
});

describe('which Watchers are legacy', () => {
  test('a Watcher within the supported window is attached; one below it is a legacy Watcher; an unreadable record is attached as before', () => {
    const record = watcherRecordFixture(1);
    expect(WATCHER_PROTOCOL_OLDEST_SUPPORTED).toBeLessThanOrEqual(WATCHER_PROTOCOL_VERSION);
    expect(LegacyWatcherReader.attachmentOf({ ...record, protocolVersion: WATCHER_PROTOCOL_VERSION })).toBe('attached');
    expect(LegacyWatcherReader.attachmentOf({ ...record, protocolVersion: WATCHER_PROTOCOL_OLDEST_SUPPORTED })).toBe('attached');
    expect(LegacyWatcherReader.attachmentOf({ ...record, protocolVersion: WATCHER_PROTOCOL_OLDEST_SUPPORTED - 1 })).toBe('legacy-watcher');
    expect(LegacyWatcherReader.attachmentOf(null)).toBe('attached');
  });

  test('a legacy Watcher whose recorded child is now another process is never signalled', () => {
    const ownIdentity = identityOf(process.pid);
    if (ownIdentity === null) throw new Error('the spec process has no readable identity');
    const reusedPid = { ...ownIdentity, startEpochSeconds: ownIdentity.startEpochSeconds - 1 };
    expect(LegacyWatcherReader.stopLegacyWatcher({ ...watcherRecordFixture(1), childProcess: reusedPid })).toBe(false);
    expect(LegacyWatcherReader.stopLegacyWatcher({ ...watcherRecordFixture(1), childProcess: null })).toBe(false);
  });
});
