/**
 * A document in the current format, whatever current status, linked bar, look-alike name or unknown key it holds, reads to exactly what the
 * mapper makes of it and keeps its bytes, a row is never linked by its name, and a malformed document is refused with the validator's
 * reason; a version or a status word an earlier release wrote is refused with the advice to run that release's `update`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join }                        from 'node:path';
import { afterAll, expect, test }      from 'bun:test';

import { JsonRecordUtil }                                 from '../../lib/json-record/JsonRecordUtil.ts';
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
    nextTaskId:    nextId + 5,
    tasks:         [
      ...statusRows,
      storedRow(nextId, { name: 'Review 1 #003 — Example', reviewOf: '003', reviewBarRound: 1 }),
      storedRow(nextId + 1, {
        name:           'Example bar',
        reviewOf:       '003',
        reviewBarRound: 2,
        unknownRowKey:  'kept',
      }),
      storedRow(nextId + 2, { name: 'Review 1 #3 — misnamed own row', ticket: '009' }),
      storedRow(nextId + 3, { name: 'Example follow-up', ticket: '003', reviewOf: '3' }),
      storedRow(nextId + 4, { name: 'Review 2 #003 — Example known only by its name' }),
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

function validatedDocumentOf(storedText: string): StoredProgressFile {
  const reading = ProgressFileValidationUtil.readingOf(JSON.parse(storedText));
  if (reading.verdict === 'unreadable') throw new Error(reading.reason);
  return reading.document;
}

test('a current document reads to exactly what the mapper makes of it and keeps its bytes', () => {
  const progressFilePath = scratchProgressFilePath('current-document');
  const storedText       = currentDocumentText();
  writeFileSync(progressFilePath, storedText);

  const reading = new ProgressFileIngestion(progressFilePath).read();
  expect(reading).toEqual({
    verdict:  'readable',
    progress: ProgressFileMappingUtil.progressOf(validatedDocumentOf(storedText)),
  });
  if (reading.verdict !== 'readable') throw new Error(`expected a readable file, got ${JSON.stringify(reading)}`);
  expect(Object.keys(reading.progress.tasks.at(-3) ?? {}), 'no key added to a ticket row named like a bar').not.toContain('reviewBarRound');
  expect(reading.progress.tasks.at(-2)?.reviewOf, 'a ticket row keeps its reviewOf as written').toBe('3');
  expect(Object.keys(reading.progress.tasks.at(-1) ?? {}), 'a free-standing row is never linked by its name').not.toContain('reviewOf');
  expect(readFileSync(progressFilePath, 'utf8')).toBe(storedText);
});

test('a malformed current document is refused with the current validator\'s reason', () => {
  const malformedDocuments: unknown[] = [
    { ...JsonRecordUtil.recordOf(JSON.parse(currentDocumentText())), nextTaskId: 0 },
    { ...JsonRecordUtil.recordOf(JSON.parse(currentDocumentText())), log: [] },
    { ...JsonRecordUtil.recordOf(JSON.parse(currentDocumentText())), tasks: [storedRow(1, { status: 'blocked' })] },
    { ...JsonRecordUtil.recordOf(JSON.parse(currentDocumentText())), tasks: [storedRow(1, { reviewOf: 3 })] },
    [1, 2, 3],
  ];
  for (const document of malformedDocuments) {
    const progressFilePath = scratchProgressFilePath('current-document-malformed');
    writeFileSync(progressFilePath, JSON.stringify(document));
    const expectedReason = ProgressFileValidationUtil.documentProblemOf(document);
    expect(expectedReason, JSON.stringify(document)).not.toBeNull();
    expect(new ProgressFileIngestion(progressFilePath).read()).toEqual({ verdict: 'unreadable', reason: expectedReason ?? '' });
  }
});

test('a version 1 document, and a row in a retired status word, are refused saying to run update with a release that still reads them', () => {
  const currentDocument = JsonRecordUtil.recordOf(JSON.parse(currentDocumentText()));
  const olderDocuments: Array<[document: unknown, reasonStart: string]> = [
    [{ ...currentDocument, version: 1, log: [{ at: FILED_AT, text: 'Example note' }] }, 'version is 1, and this build of agent-progress reads version 2; '],
    [{ ...currentDocument, tasks: [storedRow(1, { status: 'running' })] }, 'tasks[0].status is "running", which is not one of '],
  ];
  for (const [document, reasonStart] of olderDocuments) {
    const progressFilePath = scratchProgressFilePath('older-document');
    writeFileSync(progressFilePath, JSON.stringify(document));
    const reading = new ProgressFileIngestion(progressFilePath).read();

    expect(reading.verdict === 'unreadable' ? reading.reason : '').toStartWith(reasonStart);
    expect(reading.verdict === 'unreadable' ? reading.reason : '').toEndWith('run `agent-progress update` with a release that still reads it, then use this one');
  }
});
