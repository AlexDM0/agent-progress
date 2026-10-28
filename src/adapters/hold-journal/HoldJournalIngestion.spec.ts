/**
 * The journal's stored format both ways. What matters: the writer's file reads back as the same files; paths are stored relative to the
 * data folder and one that would leave it is malformed, since replay writes wherever a path points; and nothing malformed ever throws.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join }                                   from 'node:path';
import {
  afterEach,
  beforeEach,
  expect,
  test,
} from 'bun:test';
import { createScratchDirectory, removeScratchDirectory } from '../../testing/ScratchWorkspace.ts';
import { HoldJournalIngestion, type JournaledFile }       from './HoldJournalIngestion.ts';
import { createHoldJournalWriter }                        from './HoldJournalWriter.ts';

let dataDirectory = '';

const journalFilePath = (): string => join(dataDirectory, 'hold-journal.json');

const reading = (): ReturnType<HoldJournalIngestion['read']> => new HoldJournalIngestion(journalFilePath(), dataDirectory).read();

beforeEach(() => {
  dataDirectory = join(createScratchDirectory('hold-journal-ingestion'), 'data');
  mkdirSync(dataDirectory, { recursive: true });
});

afterEach(() => {
  removeScratchDirectory(join(dataDirectory, '..'));
});

test('no file is absent', () => {
  expect(reading()).toEqual({ verdict: 'absent' });
});

test('what the writer stores reads back as the same files, with paths stored relative to the data folder', () => {
  const files: JournaledFile[] = [
    { kind: 'written', filePath: join(dataDirectory, 'progress.json'), contents: '{}\n' },
    { kind: 'removed', filePath: join(dataDirectory, 'tickets', '002-example.md') },
  ];

  createHoldJournalWriter(journalFilePath(), dataDirectory).write(files);

  expect(reading()).toEqual({ verdict: 'readable', files });
  expect(JSON.parse(readFileSync(journalFilePath(), 'utf8'))).toEqual({
    version: 1,
    files:   [{ path: 'progress.json', contents: '{}\n' }, { path: 'tickets/002-example.md', removed: true }],
  });
});

test.each([
  ['not JSON', '{', 'it is not valid JSON'],
  ['another version', '{"version":2,"files":[]}', 'its version is not 1'],
  ['a path leaving the data folder', '{"version":1,"files":[{"path":"tickets/../../outside.md","contents":""}]}', 'files[0].path is not a path inside the data folder'],
  ['an absolute path', '{"version":1,"files":[{"path":"/etc/example","contents":""}]}', 'files[0].path is not a path inside the data folder'],
  ['both contents and removed', '{"version":1,"files":[{"path":"log.jsonl","contents":"","removed":true}]}', 'files[0] holds neither a string "contents" nor "removed": true'],
  ['an entry that is not an object', '{"version":1,"files":[5]}', 'files[0] is not an object'],
])('%s is malformed, never a throw', (_case, storedText, reason) => {
  writeFileSync(journalFilePath(), storedText);

  const journalReading = reading();

  expect(journalReading.verdict).toBe('malformed');
  expect(journalReading.verdict === 'malformed' ? journalReading.reason : '').toContain(reason);
});
