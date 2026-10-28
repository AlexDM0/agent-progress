/**
 * A runner update must never strand a running agent, so every event-log format and host-record version a host still running may have
 * written is read by the current code: one fixture per supported version under `testing/fixtures/`, each read back whole, and a format
 * with no reader is reported rather than misread. What matters about a legacy host: only a protocol below the supported window makes it
 * one, and its stop is a signal to its recorded group, never to a process that merely reuses the pid.
 */
import { readFileSync } from 'node:fs';
import { join }         from 'node:path';

import { describe, expect, test } from 'bun:test';

import type { HostRecord }                                       from '../../lib/agent-host/HostRecord.ts';
import { HOST_PROTOCOL_OLDEST_SUPPORTED, HOST_PROTOCOL_VERSION } from '../../lib/agent-host/constants/HostProtocol.ts';
import { identityOf }                                            from '../../lib/process-identity/ProcessIdentity.ts';
import { LegacyHostReader }                                      from './LegacyHostReader.ts';

const FIXTURES_FOLDER = join(import.meta.dir, 'testing', 'fixtures');

function fixtureText(fileName: string): string {
  return readFileSync(join(FIXTURES_FOLDER, fileName), 'utf8');
}

function hostRecordFixture(formatVersion: number): HostRecord {
  return JSON.parse(fixtureText(`host-record-format-${formatVersion}.json`)) as HostRecord;
}

describe('every supported event-log format', () => {
  test('there is at least one, and each has a fixture its reader reads whole, ignoring a last line cut short', () => {
    const formats = LegacyHostReader.readableEventLogFormats();
    expect(formats.length).toBeGreaterThan(0);
    for (const formatVersion of formats) {
      const reading = LegacyHostReader.eventLogReadingOf(`${fixtureText(`event-log-format-${formatVersion}.jsonl`)}{"sequence":4,"orig`, formatVersion);
      if (reading.verdict !== 'read') throw new Error(`format ${formatVersion} read ${reading.verdict}`);
      expect(reading.entries.map((entry) => [entry.sequence, entry.origin])).toEqual([[1, 'agent'], [2, 'client'], [3, 'host']]);
      expect(reading.entries[1]?.line).toContain('Example line from Alex Example');
    }
  });

  test('a format no reader knows is reported unsupported, never read as the current one', () => {
    const unknownFormat = Math.max(...LegacyHostReader.readableEventLogFormats()) + 1;
    expect(LegacyHostReader.eventLogReadingOf(fixtureText('event-log-format-1.jsonl'), unknownFormat)).toEqual({ verdict: 'unsupported-format', formatVersion: unknownFormat });
  });

  test('each format\'s host-record fixture names its own format and a protocol the runner still reads', () => {
    for (const formatVersion of LegacyHostReader.readableEventLogFormats()) {
      const record = hostRecordFixture(formatVersion);
      expect(record.eventLogFormatVersion).toBe(formatVersion);
      expect(record.protocolVersion).toBeLessThanOrEqual(HOST_PROTOCOL_VERSION);
      expect(record.childProcess?.processId).toBe(record.childProcessGroupId);
    }
  });
});

describe('which hosts are legacy', () => {
  test('a host within the supported window is attached; one below it is a legacy host; an unreadable record is attached as before', () => {
    const record = hostRecordFixture(1);
    expect(HOST_PROTOCOL_OLDEST_SUPPORTED).toBeLessThanOrEqual(HOST_PROTOCOL_VERSION);
    expect(LegacyHostReader.attachmentOf({ ...record, protocolVersion: HOST_PROTOCOL_VERSION })).toBe('attached');
    expect(LegacyHostReader.attachmentOf({ ...record, protocolVersion: HOST_PROTOCOL_OLDEST_SUPPORTED })).toBe('attached');
    expect(LegacyHostReader.attachmentOf({ ...record, protocolVersion: HOST_PROTOCOL_OLDEST_SUPPORTED - 1 })).toBe('legacy-host');
    expect(LegacyHostReader.attachmentOf(null)).toBe('attached');
  });

  test('a legacy host whose recorded child is now another process is never signalled', () => {
    const ownIdentity = identityOf(process.pid);
    if (ownIdentity === null) throw new Error('the spec process has no readable identity');
    const reusedPid = { ...ownIdentity, startEpochSeconds: ownIdentity.startEpochSeconds - 1 };
    expect(LegacyHostReader.stopLegacyHost({ ...hostRecordFixture(1), childProcess: reusedPid })).toBe(false);
    expect(LegacyHostReader.stopLegacyHost({ ...hostRecordFixture(1), childProcess: null })).toBe(false);
  });
});
