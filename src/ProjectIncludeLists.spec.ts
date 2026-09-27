/**
 * The `include` lists of `page/tsconfig.json` and `dispatcher/tsconfig.json`, held against what each project reaches: every file outside its
 * folder that its shipping modules import, directly or through each other, and, for the page, every shipping module of the tracker model, which
 * it compiles whole to prove the package DOM-safe. The comparison is exact both ways, so a missing entry and one nothing needs both fail. The
 * scan first proves it found each project's reach, and each form is planted once in memory to prove the guard still names it.
 */
import { posix } from 'node:path';

import { describe, expect, test } from 'bun:test';
import ts                         from 'typescript';

import type { ImportGraph }                                       from './testing/ImportGraph.ts';
import { createImportGraphScanner, repositoryRootOfThisCheckout } from './testing/ImportGraph.ts';

interface IncludeListContract {
  readonly configurationPath:   string;
  readonly projectFolder:       string;
  /** Folders whose every shipping module the project compiles, reached or not. */
  readonly wholePackageFolders: readonly string[];
}

const PAGE_PROJECT: IncludeListContract = {
  configurationPath:   'page/tsconfig.json',
  projectFolder:       'page/',
  wholePackageFolders: ['src/lib/tracker-model/'],
};

const DISPATCHER_PROJECT: IncludeListContract = {
  configurationPath:   'dispatcher/tsconfig.json',
  projectFolder:       'dispatcher/',
  wholePackageFolders: [],
};

const PROJECTS = [PAGE_PROJECT, DISPATCHER_PROJECT];

const SCANNER = createImportGraphScanner(repositoryRootOfThisCheckout());

function isShippingModule(path: string): boolean {
  return !path.endsWith('.spec.ts') && !path.split('/').includes('testing');
}

function includeEntriesOf(configurationPath: string): readonly string[] {
  const { config } = ts.readConfigFile(posix.join(repositoryRootOfThisCheckout(), configurationPath), ts.sys.readFile) as { config?: { include?: string[] } };
  return config?.include ?? [];
}

/** Repository-relative paths of the entries that name one file; the project's own glob is not a list entry. */
function listedPathsOf(project: IncludeListContract, includeEntries: readonly string[]): readonly string[] {
  return includeEntries.filter((entry) => !entry.includes('*')).map((entry) => posix.normalize(posix.join(project.projectFolder, entry)));
}

function reachedPathsOf(project: IncludeListContract, graph: ImportGraph): ReadonlySet<string> {
  const pending = graph.scannedPaths.filter((path) => path.startsWith(project.projectFolder) && isShippingModule(path));
  const visited = new Set(pending);
  const reachedOutside = new Set<string>();
  while (pending.length > 0) {
    const fromPath = pending.pop() ?? '';
    for (const edge of graph.edges) {
      if (edge.fromPath !== fromPath || edge.target.kind !== 'repository-file' || visited.has(edge.target.path)) continue;
      visited.add(edge.target.path);
      pending.push(edge.target.path);
      if (!edge.target.path.startsWith(project.projectFolder)) reachedOutside.add(edge.target.path);
    }
  }
  const wholePackagePaths = graph.scannedPaths.filter((path) => isShippingModule(path) && project.wholePackageFolders.some((folder) => path.startsWith(folder)));
  return new Set([...reachedOutside, ...wholePackagePaths]);
}

function includeListSentencesOf(project: IncludeListContract, includeEntries: readonly string[], graph: ImportGraph): readonly string[] {
  const listedPaths = new Set(listedPathsOf(project, includeEntries));
  const reachedPaths = reachedPathsOf(project, graph);
  const missing = [...reachedPaths].filter((path) => !listedPaths.has(path)).sort();
  const unneeded = [...listedPaths].filter((path) => !reachedPaths.has(path)).sort();
  return [
    ...missing.map((path) => `${project.configurationPath} does not list ${path}, which ${project.projectFolder} reaches: add it to the include list`),
    ...unneeded.map((path) => `${project.configurationPath} lists ${path}, which nothing ${project.projectFolder} ships reaches: remove it from the include list`),
  ];
}

describe('the scan itself', () => {
  /** Floors well under today's counts, to fail a scan that read the wrong tree or followed no import. */
  test('it finds each project\'s reach outside its folder, beyond the tracker model the page compiles whole', () => {
    const pageReach = [...reachedPathsOf(PAGE_PROJECT, SCANNER.graph)];
    const dispatcherReach = [...reachedPathsOf(DISPATCHER_PROJECT, SCANNER.graph)];
    expect(pageReach.filter((path) => !path.startsWith('src/lib/tracker-model/')).length, 'page files reached outside the model').toBeGreaterThanOrEqual(4);
    expect(pageReach.filter((path) => path.startsWith('src/lib/tracker-model/')).length, 'tracker model modules').toBeGreaterThanOrEqual(20);
    expect(dispatcherReach.length, 'dispatcher files reached').toBeGreaterThanOrEqual(5);
  });

  test('it reads each include list, and each names its own folder by one glob', () => {
    for (const project of PROJECTS) {
      const includeEntries = includeEntriesOf(project.configurationPath);
      expect(listedPathsOf(project, includeEntries).length, project.configurationPath).toBeGreaterThanOrEqual(5);
      expect(includeEntries.filter((entry) => entry.includes('*')), project.configurationPath).toEqual(['./**/*.ts']);
    }
  });
});

describe('each include list is exactly what its project reaches', () => {
  for (const project of PROJECTS) {
    test(`${project.configurationPath} lists every file its project reaches and nothing else`, () => {
      expect(includeListSentencesOf(project, includeEntriesOf(project.configurationPath), SCANNER.graph)).toEqual([]);
    });
  }
});

describe('the guard still names each form, planted in memory', () => {
  test('a needed entry removed from the page\'s list', () => {
    const includeEntries = includeEntriesOf(PAGE_PROJECT.configurationPath).filter((entry) => entry !== '../src/lib/html-escape/HtmlEscapeUtil.ts');
    expect(includeListSentencesOf(PAGE_PROJECT, includeEntries, SCANNER.graph)).toEqual([
      'page/tsconfig.json does not list src/lib/html-escape/HtmlEscapeUtil.ts, which page/ reaches: add it to the include list',
    ]);
  });

  test('a tracker model module removed from the page\'s list', () => {
    const includeEntries = includeEntriesOf(PAGE_PROJECT.configurationPath).filter((entry) => entry !== '../src/lib/tracker-model/Logger.ts');
    expect(includeListSentencesOf(PAGE_PROJECT, includeEntries, SCANNER.graph)).toEqual([
      'page/tsconfig.json does not list src/lib/tracker-model/Logger.ts, which page/ reaches: add it to the include list',
    ]);
  });

  test('an entry nothing needs, added to the page\'s and the dispatcher\'s list', () => {
    for (const project of PROJECTS) {
      const includeEntries = [...includeEntriesOf(project.configurationPath), '../src/shared/Environment.ts'];
      expect(includeListSentencesOf(project, includeEntries, SCANNER.graph)).toEqual([
        `${project.configurationPath} lists src/shared/Environment.ts, which nothing ${project.projectFolder} ships reaches: remove it from the include list`,
      ]);
    }
  });

  test('a new outside file a dispatcher module imports, directly or through a listed file', () => {
    const graph = SCANNER.graphWithPlantedFiles({
      'dispatcher/PlantedStep.ts':        'import { planted } from \'../src/shared/PlantedValue.ts\';\nexport const step = planted;\n',
      'src/shared/PlantedValue.ts':       'import { deeper } from \'./PlantedDeeperValue.ts\';\nexport const planted = deeper;\n',
      'src/shared/PlantedDeeperValue.ts': 'export const deeper = 1;\n',
    });
    expect(includeListSentencesOf(DISPATCHER_PROJECT, includeEntriesOf(DISPATCHER_PROJECT.configurationPath), graph)).toEqual([
      'dispatcher/tsconfig.json does not list src/shared/PlantedDeeperValue.ts, which dispatcher/ reaches: add it to the include list',
      'dispatcher/tsconfig.json does not list src/shared/PlantedValue.ts, which dispatcher/ reaches: add it to the include list',
    ]);
  });

  test('an import only a spec or a testing helper makes is not a reach', () => {
    const graph = SCANNER.graphWithPlantedFiles({
      'dispatcher/PlantedStep.spec.ts':    'import { planted } from \'../src/shared/PlantedValue.ts\';\nexport const step = planted;\n',
      'dispatcher/testing/PlantedHelp.ts': 'import { planted } from \'../../src/shared/PlantedValue.ts\';\nexport const help = planted;\n',
      'src/shared/PlantedValue.ts':        'export const planted = 1;\n',
    });
    expect(includeListSentencesOf(DISPATCHER_PROJECT, includeEntriesOf(DISPATCHER_PROJECT.configurationPath), graph)).toEqual([]);
  });
});
