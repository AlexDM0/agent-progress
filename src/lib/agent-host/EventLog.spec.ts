/**
 * The event log's own contract: entries are numbered from 1 in the order appended, the file holds them after `syncAndClose`, and a reader
 * ignores a last line cut short mid-append while naming a malformed terminated line rather than skipping it.
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { join }                         from 'node:path';
import {
  afterEach,
  beforeEach,
  expect,
  test
} from 'bun:test';

import { createScratchDirectory, removeScratchDirectory } from '../../testing/ScratchWorkspace.ts';
import { createEventLogWriter, eventLogEntriesOf }        from './EventLog.ts';

let scratchFolder = '';

beforeEach(() => {
  scratchFolder = createScratchDirectory('event-log');
});

afterEach(() => {
  removeScratchDirectory(scratchFolder);
});

test('numbers entries from 1 in append order, and a reader reads them back', () => {
  const eventLogPath = join(scratchFolder, 'events-1.ndjson');
  const writer = createEventLogWriter(eventLogPath);
  expect(writer.append('agent', '{"type":"system"}')).toEqual({ sequence: 1, origin: 'agent', line: '{"type":"system"}' });
  writer.append('client', 'a chat line');
  writer.append('host', 'a standing reply');
  writer.syncAndClose();
  expect(eventLogEntriesOf(readFileSync(eventLogPath, 'utf8'))).toEqual({
    verdict: 'read',
    entries: [
      { sequence: 1, origin: 'agent', line: '{"type":"system"}' },
      { sequence: 2, origin: 'client', line: 'a chat line' },
      { sequence: 3, origin: 'host', line: 'a standing reply' },
    ],
  });
});

test('a reader ignores an unterminated last line, even one that is not JSON yet', () => {
  const eventLogPath = join(scratchFolder, 'events-1.ndjson');
  const writer = createEventLogWriter(eventLogPath);
  writer.append('agent', 'kept');
  writer.syncAndClose();
  appendFileSync(eventLogPath, '{"sequence":2,"origin":"ag');
  expect(eventLogEntriesOf(readFileSync(eventLogPath, 'utf8'))).toEqual({ verdict: 'read', entries: [{ sequence: 1, origin: 'agent', line: 'kept' }] });
});

test('a terminated line that is not an entry is named, not skipped', () => {
  expect(eventLogEntriesOf('{"sequence":1,"origin":"agent","line":"kept"}\n{"sequence":2,"origin":"elsewhere","line":"x"}\n'))
    .toEqual({ verdict: 'malformed', lineNumber: 2 });
  expect(eventLogEntriesOf('not json\n')).toEqual({ verdict: 'malformed', lineNumber: 1 });
  expect(eventLogEntriesOf('')).toEqual({ verdict: 'read', entries: [] });
});
