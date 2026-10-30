/**
 * The `include` list of `bridge/tsconfig.json`, held against what the Bridge reaches: every file outside its folder that its shipping
 * modules import, directly or through each other, and every shipping module of the tracker model, which it compiles whole to prove the
 * package DOM-safe. The comparison is exact both ways, so a missing entry and one nothing needs both fail. The scan first proves it found
 * the project's reach, and each form is planted once in memory to prove the guard still names it.
 */
import { posix } from 'node:path';

import { describe, expect, test } from 'bun:test';
import ts                         from 'typescript';

import type { ImportGraph }                                                           from './testing/ImportGraph.ts';
import { createImportGraphScanner, reachablePathsFrom, repositoryRootOfThisCheckout } from './testing/ImportGraph.ts';

interface IncludeListContract {
  readonly configurationPath:   string;
  readonly projectFolder:       string;
  /** Folders whose every shipping module the project compiles, reached or not. */
  readonly wholePackageFolders: readonly string[];
  /** The globs naming the project's own folder, one per source extension. */
  readonly ownFolderGlobs:      readonly string[];
}

const TRACKER_MODEL_FOLDER = 'src/lib/tracker-model/';

const BRIDGE_PROJECT: IncludeListContract = {
  configurationPath:   'bridge/tsconfig.json',
  projectFolder:       'bridge/',
  wholePackageFolders: [TRACKER_MODEL_FOLDER],
  ownFolderGlobs:      ['./**/*.ts', './**/*.tsx'],
};

const SCANNER = createImportGraphScanner(repositoryRootOfThisCheckout());

function isShippingModule(path: string): boolean {
  return !path.endsWith('.spec.ts') && !path.endsWith('.dom.tsx') && !path.split('/').includes('testing');
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
  const shippingModulePaths = graph.scannedPaths.filter((path) => path.startsWith(project.projectFolder) && isShippingModule(path));
  const reachedOutside = [...reachablePathsFrom(graph, shippingModulePaths)].filter((path) => !path.startsWith(project.projectFolder));
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
  test('it finds the Bridge\'s reach outside its folder, beyond the tracker model it compiles whole', () => {
    const bridgeReach = [...reachedPathsOf(BRIDGE_PROJECT, SCANNER.graph)];
    expect(bridgeReach.filter((path) => !path.startsWith(TRACKER_MODEL_FOLDER)).length, 'Bridge files reached outside the model').toBeGreaterThanOrEqual(4);
    expect(bridgeReach.filter((path) => path.startsWith(TRACKER_MODEL_FOLDER)).length, 'tracker model modules').toBeGreaterThanOrEqual(20);
    expect(bridgeReach, 'Bridge files reached').toContain('src/shared/constants/ProductNames.ts');
  });

  test('it reads the include list, which names the Bridge\'s own folder by one glob per source extension', () => {
    const includeEntries = includeEntriesOf(BRIDGE_PROJECT.configurationPath);
    expect(listedPathsOf(BRIDGE_PROJECT, includeEntries).length).toBeGreaterThanOrEqual(1);
    expect(includeEntries.filter((entry) => entry.includes('*'))).toEqual([...BRIDGE_PROJECT.ownFolderGlobs]);
  });
});

test('bridge/tsconfig.json lists every file the Bridge reaches and the whole tracker model, and nothing else', () => {
  expect(includeListSentencesOf(BRIDGE_PROJECT, includeEntriesOf(BRIDGE_PROJECT.configurationPath), SCANNER.graph)).toEqual([]);
});

describe('the guard still names each form, planted in memory', () => {
  test('a needed entry removed from the list', () => {
    const includeEntries = includeEntriesOf(BRIDGE_PROJECT.configurationPath).filter((entry) => entry !== '../src/lib/html-escape/HtmlEscapeUtil.ts');
    expect(includeListSentencesOf(BRIDGE_PROJECT, includeEntries, SCANNER.graph)).toEqual([
      'bridge/tsconfig.json does not list src/lib/html-escape/HtmlEscapeUtil.ts, which bridge/ reaches: add it to the include list',
    ]);
  });

  test('a tracker model module no Bridge module imports, removed from the list', () => {
    const includeEntries = includeEntriesOf(BRIDGE_PROJECT.configurationPath).filter((entry) => entry !== '../src/lib/tracker-model/Logger.ts');
    expect(includeListSentencesOf(BRIDGE_PROJECT, includeEntries, SCANNER.graph)).toEqual([
      'bridge/tsconfig.json does not list src/lib/tracker-model/Logger.ts, which bridge/ reaches: add it to the include list',
    ]);
  });

  test('an entry nothing needs, added to the list', () => {
    const includeEntries = [...includeEntriesOf(BRIDGE_PROJECT.configurationPath), '../src/shared/Environment.ts'];
    expect(includeListSentencesOf(BRIDGE_PROJECT, includeEntries, SCANNER.graph)).toEqual([
      'bridge/tsconfig.json lists src/shared/Environment.ts, which nothing bridge/ ships reaches: remove it from the include list',
    ]);
  });

  test('a new outside file a Bridge module imports, directly or through a listed file', () => {
    const graph = SCANNER.graphWithPlantedFiles({
      'bridge/PlantedStep.ts':            'import { planted } from \'../src/shared/PlantedValue.ts\';\nexport const step = planted;\n',
      'src/shared/PlantedValue.ts':       'import { deeper } from \'./PlantedDeeperValue.ts\';\nexport const planted = deeper;\n',
      'src/shared/PlantedDeeperValue.ts': 'export const deeper = 1;\n',
    });
    expect(includeListSentencesOf(BRIDGE_PROJECT, includeEntriesOf(BRIDGE_PROJECT.configurationPath), graph)).toEqual([
      'bridge/tsconfig.json does not list src/shared/PlantedDeeperValue.ts, which bridge/ reaches: add it to the include list',
      'bridge/tsconfig.json does not list src/shared/PlantedValue.ts, which bridge/ reaches: add it to the include list',
    ]);
  });

  test('an import only a spec or a testing helper makes is not a reach', () => {
    const graph = SCANNER.graphWithPlantedFiles({
      'bridge/PlantedStep.spec.ts':    'import { planted } from \'../src/shared/PlantedValue.ts\';\nexport const step = planted;\n',
      'bridge/testing/PlantedHelp.ts': 'import { planted } from \'../../src/shared/PlantedValue.ts\';\nexport const help = planted;\n',
      'src/shared/PlantedValue.ts':    'export const planted = 1;\n',
    });
    expect(includeListSentencesOf(BRIDGE_PROJECT, includeEntriesOf(BRIDGE_PROJECT.configurationPath), graph)).toEqual([]);
  });
});
