/**
 * The spec page's Progress rows over the snapshot's stage spans. The cases that matter: over the example repository `001`'s three stages
 * are closed rows, `002`'s Implement is the one open row of its spec with the live phase at its start, and `007` and `008` have only an
 * open Specify; no row carries a task id, ticket, tokens or owner; a template-copy `plan.md` gives no Plan row; a stage dated from a
 * modification time is marked, with every birth time unknown on every row; and the trailing markup names the spec and that mark only.
 */

import {
  afterAll,
  describe,
  expect,
  test
} from 'bun:test';

import type { SpecSnapshot }                              from '../../../src/lib/spec-snapshot/@types/SpecSnapshot.ts';
import { deriveSpecSnapshot }                             from '../../../src/lib/spec-snapshot/SpecSnapshotDerivation.ts';
import { scannedExampleSpecKitRepository }                from '../../../src/testing/ScannedExampleSpecKitRepository.ts';
import { createScratchDirectory, removeScratchDirectory } from '../../../src/testing/ScratchWorkspace.ts';
import { sourceFeature, sourceRepository }                from '../../../src/testing/SpecSnapshotSourceFixtures.ts';
import type { SpecStageRow }                              from './SpecStageRows.ts';
import { MODIFICATION_TIME_MARK, SpecStageRows }          from './SpecStageRows.ts';

const EXAMPLE_NOW = new Date('2026-10-06T12:00:00+02:00');

const scratchDirectory = createScratchDirectory('spec-stage-rows');
const EXAMPLE_SNAPSHOT = deriveSpecSnapshot(scannedExampleSpecKitRepository(scratchDirectory), EXAMPLE_NOW);

afterAll(() => removeScratchDirectory(scratchDirectory));

function rowsOfSpec(snapshot: SpecSnapshot, folderPrefix: string): SpecStageRow[] {
  return SpecStageRows.stageRowsOf(snapshot).filter((row) => row.specFolderName.startsWith(folderPrefix));
}

function stateByStageOf(rows: readonly SpecStageRow[]): Array<[string, string, boolean]> {
  return rows.map((row) => [row.name, row.displayState, row.end === null]);
}

/** As the scan writes a file whose birth time is unknown: its creation date is its modification time, so marked. */
const UNKNOWN_BIRTH_TIME_DATES = {
  created:  { at: '2026-09-02T08:00:00.000Z', source: 'modification-time' },
  modified: { at: '2026-09-02T08:00:00.000Z', source: 'modification-time' },
};

describe('SpecStageRows.stageRowsOf over the example repository', () => {
  test('closes all three of 001’s stages', () => {
    expect(stateByStageOf(rowsOfSpec(EXAMPLE_SNAPSHOT, '001'))).toEqual([
      ['Specify', 'delivered', false],
      ['Plan', 'delivered', false],
      ['Implement', 'delivered', false],
    ]);
  });

  test('leaves 002’s Implement open, with one in-progress phase at its start', () => {
    const rows      = rowsOfSpec(EXAMPLE_SNAPSHOT, '002');
    const implement = rows.find((row) => row.name === 'Implement');

    expect(stateByStageOf(rows).at(-1)).toEqual(['Implement', 'in-progress', true]);
    expect(implement?.history).toEqual([{ status: 'in-progress', at: implement?.start ?? '' }]);
  });

  test('gives 007 and 008 only an open Specify', () => {
    expect(stateByStageOf(rowsOfSpec(EXAMPLE_SNAPSHOT, '007'))).toEqual([['Specify', 'in-progress', true]]);
    expect(stateByStageOf(rowsOfSpec(EXAMPLE_SNAPSHOT, '008'))).toEqual([['Specify', 'in-progress', true]]);
  });

  test('carries no task id, ticket, tokens or owner on any row', () => {
    const rows = SpecStageRows.stageRowsOf(EXAMPLE_SNAPSHOT);

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((row) => ['id', 'ticket', 'tokens', 'owner'].some((key) => Object.hasOwn(row, key)))).toEqual([]);
  });
});

describe('SpecStageRows.stageRowsOf over in-memory repositories', () => {
  test('gives a spec whose plan.md is a template copy no Plan row', () => {
    const snapshot = deriveSpecSnapshot(sourceRepository([sourceFeature({ plan: 'template' })]), EXAMPLE_NOW);

    expect(stateByStageOf(SpecStageRows.stageRowsOf(snapshot))).toEqual([['Specify', 'in-progress', true]]);
  });

  test('with every birth time unknown, still dates each stage from the modification time and marks every row', () => {
    const snapshot = deriveSpecSnapshot(sourceRepository([sourceFeature({ plan: 'filled', tasks: 'filled', dates: UNKNOWN_BIRTH_TIME_DATES })]), EXAMPLE_NOW);
    const rows     = SpecStageRows.stageRowsOf(snapshot);

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.datedFromModificationTime && row.start === firstStageStartOf(snapshot))).toBe(true);
    expect(SpecStageRows.progressNoteMarkupOf(rows)).toEndWith('Every stage here is dated that way.');
  });

  test('says where the dates come from, and counts the marked stages only when there are some', () => {
    const rows = SpecStageRows.stageRowsOf(EXAMPLE_SNAPSHOT).map((row) => ({ ...row, datedFromModificationTime: false }));
    const note = SpecStageRows.progressNoteMarkupOf(rows);

    expect(note).toStartWith('Dates are the files’ creation dates on this machine, so a fresh clone or checkout shows them all at that moment.');
    expect(note).toEndWith(`marked <span class="ap-spec-progress-date-mark">${MODIFICATION_TIME_MARK}</span>.`);
    expect(SpecStageRows.progressNoteMarkupOf(rows.map((row, index) => ({ ...row, datedFromModificationTime: index === 0 }))))
      .toEndWith(`1 of ${rows.length} stages here are dated that way.`);
  });
});

function firstStageStartOf(snapshot: SpecSnapshot): string {
  return snapshot.specs[0]?.stageSpans[0]?.start.date?.at ?? 'missing';
}

describe('SpecStageRows.trailingNameMarkupOf', () => {
  const [row] = rowsOfSpec(EXAMPLE_SNAPSHOT, '001');

  test('names the spec, and marks only a stage dated from a modification time', () => {
    if (row === undefined) {
      throw new Error('the example repository has no 001 rows');
    }
    const unmarked = SpecStageRows.trailingNameMarkupOf({ ...row, datedFromModificationTime: false });
    const marked   = SpecStageRows.trailingNameMarkupOf({ ...row, datedFromModificationTime: true });

    expect(unmarked).toContain(`>${row.specFolderName}</span>`);
    expect(unmarked).not.toContain('ap-spec-progress-date-mark');
    expect(marked).toContain(`<span class="ap-spec-progress-date-mark" title="Dated from a file's modification time">${MODIFICATION_TIME_MARK}</span>`);
  });
});
