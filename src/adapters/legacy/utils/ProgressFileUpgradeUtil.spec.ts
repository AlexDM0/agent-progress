/**
 * The upgrade reads what a build before the current format wrote and hands over the current document. What matters: a document with
 * nothing older in it is left to the current path; the retired task words are replaced on copies, so the parsed document a caller holds is
 * never changed under it, and every other key, unknown ones included, comes through in its order; a version 1 file needs its log, which
 * comes back as notes and out of the document; any version but 1 and 2 is named; and the refusal reasons keep the order the file was always
 * checked in, the top level, a version 1 log array, the rows, then its log entries.
 */
import { describe, expect, test } from 'bun:test';

import type { ProgressFileMigration }                   from '../../progress/@types/ProgressFileMigration.ts';
import type { StoredProgressFile }                      from '../../progress/@types/StoredProgressFile.ts';
import { emptyDocument, emptyProgress, fileRow }        from '../../progress/testing/ProgressFileFixtures.ts';
import { ProgressFileMappingUtil }                      from '../../progress/utils/ProgressFileMappingUtil.ts';
import { documentInRetiredWords, versionOneDocumentOf } from '../testing/LegacyProgressFileFixtures.ts';
import { ProgressFileUpgradeUtil }                      from './ProgressFileUpgradeUtil.ts';

const { migrationOf } = ProgressFileUpgradeUtil;

function migratedDocumentOf(parsed: unknown): StoredProgressFile {
  const migration = migrationOf(parsed);
  if (migration.verdict !== 'migrated') throw new Error(`expected a migrated document, got ${JSON.stringify(migration)}`);
  return migration.document;
}

function reasonOf(migration: ProgressFileMigration): string {
  return migration.verdict === 'unreadable' ? migration.reason : `no refusal: ${migration.verdict}`;
}

/** The retired-words document stored at version 2, with no log of its own. */
function versionTwoDocumentInRetiredWords(): Record<string, unknown> {
  const document: Record<string, unknown> = { ...documentInRetiredWords(), version: 2 };
  delete document['log'];
  return document;
}

/** A version 1 document holding one row filed the way the Board files one. */
function versionOneDocumentWithARow(log: { at: string; text: string }[] = []): Record<string, unknown> {
  const progress = emptyProgress();
  fileRow(progress, { name: 'Example build' });
  return { ...versionOneDocumentOf(progress, log) };
}

/** Parsed from text, as the ingestion does, since a typed literal cannot hold a key the type does not know. */
function documentWithUnknownKeys(version: 1 | 2): unknown {
  const progress = emptyProgress();
  fileRow(progress, { name: 'Example build' });
  const [row] = progress.tasks;
  const text = JSON.stringify({
    version,
    trackerId:     progress.trackerId,
    unknownTopKey: 'kept',
    project:       progress.project,
    startedAt:     progress.startedAt,
    view:          progress.view,
    nextTaskId:    progress.nextTaskId,
    tasks:         [{ ...row, unknownRowKey: 'kept' }],
    ...(version === 1 ? { log: [{ at: progress.startedAt, text: 'Example note' }] } : {}),
    trailingKey:   { nested: true },
  });
  return JSON.parse(text) as unknown;
}

describe('a document with nothing older in it', () => {
  test('is left to the current path, which reads it as parsed', () => {
    const progress = emptyDocument();
    fileRow(progress, { name: 'Review 1 #3 — x', reviewOf: '003', reviewBarRound: 1 });
    fileRow(progress, { name: 'Example build', status: 'in-progress', start: '2026-09-18T20:40:00+02:00' });
    expect(migrationOf(progress)).toEqual({ verdict: 'current' });
  });

  test('that is not a JSON object is left to the current path, which names it', () => {
    for (const parsed of [null, 7, 'text', [1, 2, 3]]) expect(migrationOf(parsed), JSON.stringify(parsed)).toEqual({ verdict: 'current' });
  });

  test('a malformed version 2 document is left to the current validator', () => {
    expect(migrationOf({ ...emptyDocument(), nextTaskId: 0 })).toEqual({ verdict: 'current' });
  });
});

describe('the retired task words', () => {
  test('a document holding the retired words running and finished, in rows and in their history, has no problem', () => {
    expect(migrationOf(documentInRetiredWords()).verdict).toBe('migrated');
  });

  test('running and finished come back as in-progress and in-review, in the row and in its history', () => {
    const migrated = migratedDocumentOf(documentInRetiredWords()).tasks;
    expect(migrated.map((task) => task.status)).toEqual(['in-progress', 'in-review']);
    expect(migrated.map((task) => task.history?.map((phase) => phase.status))).toEqual([['pending', 'in-progress'], ['in-progress', 'in-review']]);
  });

  test('the tasks and history arrays handed in are left exactly as they were', () => {
    const document              = documentInRetiredWords();
    const stored                = document.tasks;
    const storedBeforeMigrating = structuredClone(stored);
    const migrated              = migratedDocumentOf(document).tasks;

    expect(stored).toEqual(storedBeforeMigrating);
    expect(migrated[0]).not.toBe(stored[0]);
    expect(migrated[0]?.history).not.toBe(stored[0]?.history);
  });

  test('a key the tool does not know survives on a row and on a phase, in the order the file had', () => {
    const storedRow = JSON.parse(`{
      "id": 1, "name": "Example build", "status": "running", "unknownRowKey": "kept", "start": null, "end": null, "owner": "", "note": "",
      "ticket": null, "tokens": null, "history": [{ "status": "running", "unknownPhaseKey": "kept", "at": "2026-09-18T20:40:00+02:00" }]
    }`) as Record<string, unknown>;

    const [migrated] = migratedDocumentOf({ ...emptyDocument(), tasks: [storedRow] }).tasks;
    expect(Object.keys(migrated ?? {})).toEqual(Object.keys(storedRow));
    expect(Object.keys(migrated?.history?.[0] ?? {})).toEqual(['status', 'unknownPhaseKey', 'at']);
  });

  test('a row without history is not given one', () => {
    const document    = documentInRetiredWords();
    const [storedRow] = document.tasks;
    if (storedRow === undefined) throw new Error('expected a stored row');
    const withoutHistory = { ...storedRow };
    delete withoutHistory.history;
    const [migrated] = migratedDocumentOf({ ...document, tasks: [withoutHistory] }).tasks;
    expect(migrated === undefined ? [] : Object.keys(migrated)).not.toContain('history');
  });

  test('a history phase in a retired ticket word beside the retired task words is still a problem, since only the task words map', () => {
    const document    = documentInRetiredWords();
    const [storedRow] = document.tasks;
    if (storedRow === undefined) throw new Error('expected a stored row');
    const withTicketWord = { ...storedRow, history: [{ status: 'done', at: '2026-09-18T20:40:00+02:00' }] };
    expect(reasonOf(migrationOf({ ...document, tasks: [withTicketWord] }))).toContain('tasks[0].history');
  });
});

describe('a review bar known only by its name', () => {
  test('a version 2 document holding one is migrated, the bar linked', () => {
    const progress = emptyDocument();
    fileRow(progress, { name: 'Review 1 #3 — x' });
    expect(migratedDocumentOf(progress).tasks[0]).toMatchObject({ reviewOf: '003', reviewBarRound: 1 });
  });

  test('a version 2 document holding an unpadded reviewOf is migrated, the reviewOf padded', () => {
    const progress = emptyDocument();
    fileRow(progress, { name: 'Example review', reviewOf: '3' });
    expect(migratedDocumentOf(progress).tasks[0]?.reviewOf).toBe('003');
  });
});

describe('the version', () => {
  test('a version 1 document with its log has no problem, and one without a log does', () => {
    const withLog = versionOneDocumentOf(emptyProgress(), [{ at: '2026-09-18T20:40:00+02:00', text: 'Example note' }]);
    expect(migrationOf(withLog).verdict).toBe('migrated');
    expect(reasonOf(migrationOf({ ...emptyDocument(), version: 1 }))).toBe('log is not an array');
  });

  test('a document of any version but 1 and 2 is a problem that names the version it has and the ones this build reads', () => {
    expect(reasonOf(migrationOf({ ...emptyDocument(), version: 3 }))).toBe('version is 3, and this build of agent-progress reads versions 1 and 2');
    expect(reasonOf(migrationOf({ ...emptyDocument(), version: '1' }))).toBe('version is "1", and this build of agent-progress reads versions 1 and 2');
  });

  test('a version 1 file\'s log comes back as notes, in order with their stamps, and out of the document', () => {
    const log       = [{ at: '2026-09-18T20:11:03+02:00', text: 'Ticket #001 filed' }, { at: '2026-09-18T20:40:00+02:00', text: 'Example note' }];
    const migration = migrationOf(versionOneDocumentOf(emptyProgress(), log));
    if (migration.verdict !== 'migrated') throw new Error(`expected a migrated document, got ${JSON.stringify(migration)}`);
    expect(migration.carriedOverLog).toEqual([
      { at: '2026-09-18T20:11:03+02:00', kind: 'note', fields: { text: 'Ticket #001 filed' } },
      { at: '2026-09-18T20:40:00+02:00', kind: 'note', fields: { text: 'Example note' } },
    ]);
    expect(Object.keys(migration.document)).not.toContain('log');
    expect(migration.document.version).toBe(2);
  });

  test('a version 2 document in the retired words carries no log over', () => {
    const migration = migrationOf(versionTwoDocumentInRetiredWords());
    expect(migration.verdict === 'migrated' ? migration.carriedOverLog : 'not migrated').toBeNull();
  });

  test('every top-level key but version and log, unknown ones included, comes through in the file\'s order, from a version 1 file', () => {
    const progress = ProgressFileMappingUtil.progressOf(migratedDocumentOf(documentWithUnknownKeys(1)));
    expect(Object.keys(progress), 'version 1').toEqual(['trackerId', 'unknownTopKey', 'project', 'startedAt', 'view', 'nextTaskId', 'tasks', 'trailingKey']);
  });

  test('the stored document puts version 2 first, holds no log, and keeps every other key where the progress had it', () => {
    const versionOne = migratedDocumentOf(documentWithUnknownKeys(1));
    const stored     = ProgressFileMappingUtil.storedDocumentOf(ProgressFileMappingUtil.progressOf(versionOne));
    expect(Object.keys(stored)).toEqual(['version', 'trackerId', 'unknownTopKey', 'project', 'startedAt', 'view', 'nextTaskId', 'tasks', 'trailingKey']);
    expect(stored.version).toBe(2);
    expect(JSON.stringify(stored), 'the file a version 2 build would have written').toBe(JSON.stringify(documentWithUnknownKeys(2)));
  });
});

describe('the order of the reasons on a file with several faults', () => {
  test('a version 1 file whose log is not an array and whose task is broken reports the log', () => {
    const document = versionOneDocumentWithARow();
    const [row]    = document['tasks'] as Record<string, unknown>[];
    expect(reasonOf(migrationOf({ ...document, log: 7, tasks: [{ ...row, owner: undefined }] }))).toBe('log is not an array');
  });

  test('a version 2 file in the retired words that is missing an owner reports the owner', () => {
    const document        = versionTwoDocumentInRetiredWords();
    const [first, second] = document['tasks'] as Record<string, unknown>[];
    expect(reasonOf(migrationOf({ ...document, tasks: [first, { ...second, owner: undefined }] }))).toBe('tasks[1].owner is not a string');
  });

  test('a version 1 file with a bad top-level field and a bad log reports the field', () => {
    expect(reasonOf(migrationOf({ ...versionOneDocumentWithARow(), nextTaskId: 0, log: 7 }))).toContain('nextTaskId is 0');
  });

  test('a version 1 file with a broken task and a bad log entry reports the task, and the log entry once the task is whole', () => {
    const document  = versionOneDocumentWithARow([{ at: '2026-09-18T20:40:00+02:00', text: 'Example note' }]);
    const [row]     = document['tasks'] as Record<string, unknown>[];
    const brokenLog = [{ at: '2026-09-18T20:40:00+02:00' }];
    expect(reasonOf(migrationOf({ ...document, tasks: [{ ...row, tokens: -1 }], log: brokenLog }))).toContain('tasks[0].tokens');
    expect(reasonOf(migrationOf({ ...document, log: brokenLog }))).toBe('log[0].text is not a string');
  });
});
