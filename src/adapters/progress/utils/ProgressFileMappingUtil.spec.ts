/**
 * The model does not hold the format's `version`, so the mapping strips it and puts `version` 2 back first on the way out. Keys the tool
 * does not know are the owner's, so they survive both ways, at the top level, on rows and on a row's phases, in the file's order. A property
 * the model carries that is neither mapped nor read from the file is what a model field added without a stored form looks like at runtime,
 * and it never reaches the file.
 */
import { expect, test } from 'bun:test';

import { JSON_INDENT_SPACES }         from '../../../shared/constants/JsonIndent.ts';
import { emptyProgress, fileRow }     from '../../../testing/ProgressFixtures.ts';
import type { StoredProgressFile }    from '../@types/StoredProgressFile.ts';
import { ProgressFileMappingUtil }    from './ProgressFileMappingUtil.ts';
import { ProgressFileValidationUtil } from './ProgressFileValidationUtil.ts';

/** Written as the writer indents it, so a round trip can be compared byte for byte. */
function storedTextWithUnknownKeys(): string {
  const progress = emptyProgress();
  fileRow(progress, { name: 'Example build' });
  const [row] = progress.tasks;
  const document = {
    version:       2,
    trackerId:     progress.trackerId,
    unknownTopKey: 'kept',
    project:       progress.project,
    startedAt:     progress.startedAt,
    view:          progress.view,
    nextTaskId:    progress.nextTaskId,
    tasks:         [{
      unknownLeadingRowKey: 1, ...row, history: [{ status: 'in-progress', unknownPhaseKey: true, at: '2026-09-18T20:05:00+02:00' }], unknownRowKey: 'kept'
    }],
    trailingKey: { nested: true },
  };
  return `${JSON.stringify(document, null, JSON_INDENT_SPACES)}\n`;
}

/** Parsed from text and validated, as the ingestion does, since a typed literal cannot hold a key the type does not know. */
function storedDocumentOf(text: string): StoredProgressFile {
  const reading = ProgressFileValidationUtil.readingOf(JSON.parse(text));
  if (reading.verdict === 'unreadable') throw new Error(reading.reason);
  return reading.document;
}

function writtenTextOf(document: StoredProgressFile): string {
  return `${JSON.stringify(document, null, JSON_INDENT_SPACES)}\n`;
}

test('every top-level key but version, unknown ones included, comes through in the file\'s order', () => {
  const progress = ProgressFileMappingUtil.progressOf(storedDocumentOf(storedTextWithUnknownKeys()));
  expect(Object.keys(progress), 'version 2').toEqual(['trackerId', 'unknownTopKey', 'project', 'startedAt', 'view', 'nextTaskId', 'tasks', 'trailingKey']);
});

test('a row and a phase keep a key the tool does not know, where the file had it', () => {
  const progress = ProgressFileMappingUtil.progressOf(storedDocumentOf(storedTextWithUnknownKeys()));
  const [row]    = progress.tasks;
  expect(Object.keys(row ?? {}).at(0)).toBe('unknownLeadingRowKey');
  expect(Object.keys(row ?? {}).at(-1)).toBe('unknownRowKey');
  expect(Object.keys(row?.history?.[0] ?? {})).toEqual(['status', 'unknownPhaseKey', 'at']);
});

test('the mapped progress is a new object, so the document handed in is not the one a command changes', () => {
  const document = storedDocumentOf(storedTextWithUnknownKeys());
  expect(ProgressFileMappingUtil.progressOf(document)).not.toBe(document);
});

test('a file with unknown keys at the top level, on rows and on phases is written back byte for byte', () => {
  const text   = storedTextWithUnknownKeys();
  const stored = ProgressFileMappingUtil.storedDocumentOf(ProgressFileMappingUtil.progressOf(storedDocumentOf(text)));
  expect(Object.keys(stored)).toEqual(['version', 'trackerId', 'unknownTopKey', 'project', 'startedAt', 'view', 'nextTaskId', 'tasks', 'trailingKey']);
  expect(writtenTextOf(stored)).toBe(text);
});

test('an unknown key survives a change the Board makes to its row in place', () => {
  const progress = ProgressFileMappingUtil.progressOf(storedDocumentOf(storedTextWithUnknownKeys()));
  const [row]    = progress.tasks;
  if (row === undefined) throw new Error('the fixture files one row');
  Object.assign(row, { ...row, status: 'reviewed', reviewed: '2026-09-18T21:00:00+02:00' });
  const storedRow = ProgressFileMappingUtil.storedDocumentOf(progress).tasks[0];
  expect(Object.keys(storedRow ?? {})).toEqual([...Object.keys(row)]);
  expect(storedRow).toMatchObject({ unknownRowKey: 'kept', status: 'reviewed', reviewed: '2026-09-18T21:00:00+02:00' });
});

test('a property the model carries that is neither mapped nor read from the file never reaches the stored document', () => {
  const progress = ProgressFileMappingUtil.progressOf(storedDocumentOf(storedTextWithUnknownKeys()));
  const [row]    = progress.tasks;
  if (row === undefined) throw new Error('the fixture files one row');
  Object.assign(progress, { addedModelField: 'unmapped' });
  Object.assign(row, { addedModelField: 'unmapped' });
  Object.assign(row.history?.[0] ?? {}, { addedModelField: 'unmapped' });
  expect(writtenTextOf(ProgressFileMappingUtil.storedDocumentOf(progress))).toBe(storedTextWithUnknownKeys());
});

test('a progress built in memory, with no file behind it, is written with only the keys the mapper names', () => {
  const progress = emptyProgress();
  fileRow(progress, { name: 'Example build' });
  Object.assign(progress.tasks[0] ?? {}, { addedModelField: 'unmapped' });
  expect(JSON.stringify(ProgressFileMappingUtil.storedDocumentOf(progress))).not.toContain('addedModelField');
});
