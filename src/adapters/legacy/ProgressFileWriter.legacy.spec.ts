/**
 * The writer after a read of an older progress.json: it stores the reviewOf and round a name-only bar was given, the current status words,
 * and a version 1 file changed only in its version and log.
 * It reads the older input `src/adapters/legacy/` exists for, and is deleted with that folder.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join }                        from 'node:path';
import { afterAll, expect, test }      from 'bun:test';

import type { ProgressFile }                              from '../../lib/tracker-model/@types/ProgressFile.ts';
import { LIMITS }                                         from '../../shared/constants/Limits.ts';
import { emptyProgress, fileRow }                         from '../../testing/ProgressFixtures.ts';
import { createScratchDirectory, removeScratchDirectory } from '../../testing/ScratchWorkspace.ts';
import { ProgressFileIngestion }                          from '../progress/ProgressFileIngestion.ts';
import { createProgressFileWriter }                       from '../progress/ProgressFileWriter.ts';
import { documentInRetiredWords }                         from './testing/LegacyProgressFileFixtures.ts';

const FILED_AT = '2026-09-18T20:11:03+02:00';

const scratchDirectories: string[] = [];

afterAll(() => {
  for (const directory of scratchDirectories) removeScratchDirectory(directory);
});

function scratchProgressFilePath(prefix: string): string {
  const directory = createScratchDirectory(prefix);
  scratchDirectories.push(directory);
  return join(directory, 'progress.json');
}

test('a write after the read stores the reviewOf and round a legacy name gave', () => {
  const progressFilePath = scratchProgressFilePath('store-review-of');
  const progress         = emptyProgress();
  fileRow(progress, { name: 'Review 1 #3 — x' });
  createProgressFileWriter(progressFilePath).write(progress);

  const result = new ProgressFileIngestion(progressFilePath).read();
  if (result.verdict !== 'readable') throw new Error(`expected a readable file, got ${JSON.stringify(result)}`);
  createProgressFileWriter(progressFilePath).write(result.progress);

  const onDisk = JSON.parse(readFileSync(progressFilePath, 'utf8')) as ProgressFile;
  expect(onDisk.tasks[0]).toMatchObject({ reviewOf: '003', reviewBarRound: 1 });
});

test('the next write of a file read in the retired words stores the new ones', () => {
  const progressFilePath = scratchProgressFilePath('store-retired-words');
  writeFileSync(progressFilePath, JSON.stringify(documentInRetiredWords()));
  const result = new ProgressFileIngestion(progressFilePath).read();
  if (result.verdict !== 'readable') throw new Error(`expected a readable file, got ${JSON.stringify(result)}`);
  createProgressFileWriter(progressFilePath).write(result.progress);
  const rewrittenText = readFileSync(progressFilePath, 'utf8');
  expect(rewrittenText).toContain('"in-progress"');
  expect(rewrittenText).toContain('"in-review"');
  expect(rewrittenText).not.toContain('"running"');
  expect(rewrittenText).not.toContain('"finished"');
});

// Keys the tool does not know are the owner's; moving the log to log.jsonl is the one change the rewrite makes.
test('a version 1 file read and written changes only in its version and its log, keeping every other key in order', () => {
  const progressFilePath = scratchProgressFilePath('store-version-one-rewrite');
  const versionOneText   = `{
  "version": 1,
  "trackerId": "example-tracker-id",
  "unknownLeadingKey": "kept",
  "project": "Example Agency",
  "startedAt": "${FILED_AT}",
  "view": { "kind": "auto" },
  "nextTaskId": 2,
  "tasks": [{ "id": 1, "name": "Example build", "unknownRowKey": 3, "status": "pending", "start": null, "end": null, "owner": "", "note": "", "ticket": null, "tokens": null }],
  "log": [{ "at": "${FILED_AT}", "text": "Example note" }],
  "concurrencyLimit": 3,
  "trailingKey": { "nested": true }
}`;
  writeFileSync(progressFilePath, versionOneText);
  const result = new ProgressFileIngestion(progressFilePath).read();
  if (result.verdict !== 'readable') throw new Error(`expected a readable file, got ${JSON.stringify(result)}`);
  createProgressFileWriter(progressFilePath).write(result.progress);

  const expectedEntries = Object.entries(JSON.parse(versionOneText) as Record<string, unknown>)
    .filter(([key]) => key !== 'log')
    .map(([key, value]): [string, unknown] => [key, key === 'version' ? 2 : value]);
  expect(readFileSync(progressFilePath, 'utf8')).toBe(`${JSON.stringify(Object.fromEntries(expectedEntries), null, LIMITS.JSON_INDENT_SPACES)}\n`);
});
