/**
 * The scan of a spec-kit repository on disk. The cases that matter: it reads a repository with no tracker and writes nothing; an absent
 * artefact is null; a feature folder without `spec.md` and a malformed `tasks.md` are unreadable entries with a reason while the rest is
 * read; a missing `specs/` is zero features; and a birth time of 0 falls back to the modification time, saying so. Dates come from an
 * injected reader, so no case depends on the machine's file system keeping birth times.
 */
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import {
  afterEach,
  describe,
  expect,
  test
} from 'bun:test';

import { createCanonicalScratchDirectory, removeScratchDirectory } from '../../testing/ScratchWorkspace.ts';
import { writeSpecKitRepository }                                  from '../../testing/SpecKitRepositoryFixtures.ts';
import type { SpecKitRepositoryDescription }                       from '../../testing/SpecKitRepositoryFixtures.ts';
import type { FileDate, FileTimes }                                from './@types/SpecKitScan.ts';
import { createSpecKitRepositoryScan }                             from './SpecKitRepositoryScan.ts';

const MODIFICATION_TIME_MS = Date.parse('2026-09-10T12:00:00.000Z');
const BIRTH_TIME_MS        = Date.parse('2026-09-05T12:00:00.000Z');

const TWO_FEATURE_REPOSITORY: SpecKitRepositoryDescription = {
  projectName:    'Example Agency',
  speckitVersion: '1.1.0',
  constitution:   {
    version: '1.0.0', ratifiedDate: '2026-09-01', lastAmendedDate: '2026-09-01', principleNames: ['I. Example Principle']
  },
  features: [
    { folderName: '001-example-start', title: 'Example Start', userStories: [{ title: 'Start an example', priority: 1 }] },
    {
      folderName:  '002-example-finish',
      title:       'Example Finish',
      userStories: [{ title: 'Finish an example', priority: 1 }],
      hasPlan:     true,
      phases:      [{ name: 'Setup', doneTaskCount: 1, taskCount: 2 }],
    },
  ],
};

const scratchDirectories: string[] = [];

function scratchDirectory(): string {
  const directory = createCanonicalScratchDirectory('spec-kit-scan');
  scratchDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) removeScratchDirectory(directory);
});

function fixedFileTimes(birthTimeMs: number): (path: string) => FileTimes {
  return () => ({ birthTimeMs, modificationTimeMs: MODIFICATION_TIME_MS });
}

function everyPathUnder(directory: string): string[] {
  return readdirSync(directory, { recursive: true, encoding: 'utf8' }).sort();
}

describe('the scan', () => {
  test('a repository with `.specify/` and no `.agent-progress/` scans, and its listing is the same before and after', () => {
    const root = scratchDirectory();
    writeSpecKitRepository(root, TWO_FEATURE_REPOSITORY, { datesFilesInThePast: false });
    const listingBefore = everyPathUnder(root);

    const scan = createSpecKitRepositoryScan().scan(root);

    expect(scan.features.map((feature) => feature.folderName)).toEqual(['001-example-start', '002-example-finish']);
    expect(scan.unreadable).toEqual([]);
    expect(everyPathUnder(root)).toEqual(listingBefore);
    expect(listingBefore).not.toContain('.agent-progress');
  });

  test('a feature with only `spec.md` lists every other artefact as null and no checklist', () => {
    const root = scratchDirectory();
    writeSpecKitRepository(root, TWO_FEATURE_REPOSITORY, { datesFilesInThePast: false });

    const [specOnlyFeature] = createSpecKitRepositoryScan().scan(root).features;

    expect(specOnlyFeature?.spec.relativePath).toBe('specs/001-example-start/spec.md');
    expect(specOnlyFeature?.spec.fillState).toBe('filled');
    expect(specOnlyFeature).toMatchObject({
      plan: null, research: null, dataModel: null, quickstart: null, contracts: null, tasks: null, checklists: []
    });
  });

  test('a folder without `spec.md` and a malformed `tasks.md` are unreadable entries with path and reason, and the rest is read', () => {
    const root = scratchDirectory();
    writeSpecKitRepository(root, TWO_FEATURE_REPOSITORY, { datesFilesInThePast: false });
    mkdirSync(join(root, 'specs', '000-example-without-spec'));
    writeFileSync(join(root, 'specs', '002-example-finish', 'tasks.md'), 'No title heading here.\n');

    const scan = createSpecKitRepositoryScan().scan(root);

    expect(scan.unreadable).toEqual([
      { relativePath: 'specs/000-example-without-spec', reason: 'the feature folder has no `spec.md`', line: null },
      { relativePath: 'specs/002-example-finish/tasks.md', reason: 'the file has no `# ` title heading', line: 1 },
    ]);
    expect(scan.features.map((feature) => feature.folderName)).toEqual(['001-example-start', '002-example-finish']);
    expect(scan.features[1]?.tasks).toBeNull();
    expect(scan.features[1]?.plan?.document.title).toBe('Implementation Plan: Example Finish');
    expect(scan.constitution?.document.version).toBe('1.0.0');
    expect(scan.initOptions?.document.speckitVersion).toBe('1.1.0');
  });

  test('a repository with `.specify/` and no `specs/` folder scans as zero features with no unreadable entry', () => {
    const root = scratchDirectory();
    mkdirSync(join(root, '.specify'));

    expect(createSpecKitRepositoryScan().scan(root)).toEqual({
      rootDirectory: root, initOptions: null, constitution: null, features: [], unreadable: []
    });
  });
});

describe('file dates', () => {
  test('a birth time is the creation date, and the source says birth-time', () => {
    const root = scratchDirectory();
    writeSpecKitRepository(root, TWO_FEATURE_REPOSITORY, { datesFilesInThePast: false });

    const [feature] = createSpecKitRepositoryScan(fixedFileTimes(BIRTH_TIME_MS)).scan(root).features;

    expect(feature?.spec.dates).toEqual({
      created:  { at: '2026-09-05T12:00:00.000Z', source: 'birth-time' },
      modified: { at: '2026-09-10T12:00:00.000Z', source: 'modification-time' },
    });
  });

  test('with a birth time of 0 the creation date falls back to the modification time, and the source says so', () => {
    const root = scratchDirectory();
    writeSpecKitRepository(root, TWO_FEATURE_REPOSITORY, { datesFilesInThePast: false });

    const scan = createSpecKitRepositoryScan(fixedFileTimes(0)).scan(root);

    const fallback: FileDate = { at: '2026-09-10T12:00:00.000Z', source: 'modification-time' };
    expect(scan.constitution?.dates).toEqual({ created: fallback, modified: fallback });
    expect(scan.features[1]?.tasks?.dates.created).toEqual(fallback);
  });
});

describe('independence from a tracker', () => {
  test('no scan or root code names `findWorkspace` or `requireWorkspace`', () => {
    const sourcePaths = ['SpecKitRepositoryScan.ts', 'SpecKitRoot.ts', '../../testing/SpecKitRepositoryFixtures.ts'].map((path) => join(import.meta.dir, path));
    for (const sourcePath of sourcePaths) {
      const sourceText = readFileSync(sourcePath, 'utf8');
      expect(sourceText.length).toBeGreaterThan(0);
      expect(sourceText).not.toMatch(/findWorkspace|requireWorkspace/);
    }
  });
});
