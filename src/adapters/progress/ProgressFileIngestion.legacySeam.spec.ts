/**
 * The ingestion's seam to the older progress.json shapes, seen from the current side: a document in the current format, whatever current
 * status, linked bar, look-alike name or unknown key it holds, reads to exactly what the mapper makes of it, carries no log over and keeps
 * its bytes; a malformed current document is refused with the current validator's reason. It imports nothing from `src/adapters/legacy/`,
 * so it still holds once that folder and its seam line are dropped.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join }                        from 'node:path';
import { afterAll, expect, test }      from 'bun:test';

import { TASK_STATUSES }                                  from '../../lib/tracker-model/constants/Statuses.ts';
import { createScratchDirectory, removeScratchDirectory } from '../../testing/ScratchWorkspace.ts';
import type { StoredProgressFile }                        from './@types/StoredProgressFile.ts';
import { ProgressFileIngestion }                          from './ProgressFileIngestion.ts';
import { ProgressFileMappingUtil }                        from './utils/ProgressFileMappingUtil.ts';
import { ProgressFileValidationUtil }                     from './utils/ProgressFileValidationUtil.ts';

const FILED_AT = '2026-09-18T20:11:03+02:00';

const scratchDirectories: string[] = [];

afterAll(() => {
  for (const directory of scratchDirectories) removeScratchDirectory(directory);
});

function storedRow(id: number, fields: Record<string, unknown>): Record<string, unknown> {
  return {
    id,
    name:   `Example row ${id}`,
    status: 'pending',
    start:  null,
    end:    null,
    owner:  '',
    note:   '',
    ticket: null,
    tokens: null,
    ...fields,
  };
}

/** Every current status in a row and in a history, bars already linked and padded, a ticket row named like a bar, and unknown keys. */
function currentDocumentText(): string {
  const statusRows = TASK_STATUSES.map((status, index) => storedRow(index + 1, {
    status,
    history: TASK_STATUSES.map((phaseStatus) => ({ status: phaseStatus, unknownPhaseKey: 'kept', at: FILED_AT })),
  }));
  const nextId = statusRows.length + 1;
  return JSON.stringify({
    version:       2,
    trackerId:     'example-tracker-id',
    unknownTopKey: 'kept',
    project:       'Example Agency',
    startedAt:     FILED_AT,
    view:          { kind: 'auto' },
    nextTaskId:    nextId + 4,
    tasks:         [
      ...statusRows,
      storedRow(nextId, { name: 'Review 1 #003 — Example', reviewOf: '003', reviewBarRound: 1 }),
      storedRow(nextId + 1, {
        name: 'Example bar', reviewOf: '003', reviewBarRound: 2, unknownRowKey: 'kept' 
      }),
      storedRow(nextId + 2, { name: 'Review 1 #3 — misnamed own row', ticket: '009' }),
      storedRow(nextId + 3, { name: 'Example follow-up', ticket: '003', reviewOf: '3' }),
    ],
    concurrencyLimit: 3,
    trailingKey:      { nested: true },
  }, null, 2);
}

function scratchProgressFilePath(prefix: string): string {
  const directory = createScratchDirectory(prefix);
  scratchDirectories.push(directory);
  return join(directory, 'progress.json');
}

test('a current document reads to exactly what the mapper makes of it, carries no log over, and keeps its bytes', () => {
  const progressFilePath = scratchProgressFilePath('legacy-seam-current');
  const storedText       = currentDocumentText();
  writeFileSync(progressFilePath, storedText);

  const reading = new ProgressFileIngestion(progressFilePath).read();
  expect(reading).toEqual({
    verdict:        'readable',
    progress:       ProgressFileMappingUtil.progressOf(JSON.parse(storedText) as StoredProgressFile),
    carriedOverLog: null,
  });
  if (reading.verdict !== 'readable') throw new Error(`expected a readable file, got ${JSON.stringify(reading)}`);
  expect(Object.keys(reading.progress.tasks.at(-2) ?? {}), 'no key added to a ticket row named like a bar').not.toContain('reviewBarRound');
  expect(reading.progress.tasks.at(-1)?.reviewOf, 'a ticket row keeps its reviewOf as written').toBe('3');
  expect(readFileSync(progressFilePath, 'utf8')).toBe(storedText);
});

test('a malformed current document is refused with the current validator\'s reason', () => {
  const malformedDocuments: unknown[] = [
    { ...(JSON.parse(currentDocumentText()) as Record<string, unknown>), nextTaskId: 0 },
    { ...(JSON.parse(currentDocumentText()) as Record<string, unknown>), log: [] },
    { ...(JSON.parse(currentDocumentText()) as Record<string, unknown>), tasks: [storedRow(1, { status: 'blocked' })] },
    { ...(JSON.parse(currentDocumentText()) as Record<string, unknown>), tasks: [storedRow(1, { reviewOf: 3 })] },
    [1, 2, 3],
  ];
  for (const document of malformedDocuments) {
    const progressFilePath = scratchProgressFilePath('legacy-seam-malformed');
    writeFileSync(progressFilePath, JSON.stringify(document));
    const expectedReason = ProgressFileValidationUtil.documentProblemOf(document);
    expect(expectedReason, JSON.stringify(document)).not.toBeNull();
    expect(new ProgressFileIngestion(progressFilePath).read()).toEqual({ verdict: 'unreadable', reason: expectedReason ?? '' });
  }
});
