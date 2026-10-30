/**
 * The Watcher bundle is built from `watcher.ts` alone and pinned while agents run, so what it may reach is held here: its static import
 * closure stays inside `src/lib/watcher/` and the packages that package's main module declares, which never reach the board, the
 * tickets or git, and its shipped files name no product and no vendor. A planted import of another lib package proves the guard fires.
 */
import { describe, expect, test } from 'bun:test';

import {
  type ImportGraph,
  createImportGraphScanner,
  reachablePathsFrom,
  repositoryRootOfThisCheckout
} from '../../testing/ImportGraph.ts';

const WATCHER_BINARY_PATH = 'watcher.ts';
const WATCHER_PACKAGE_FOLDER = 'src/lib/watcher/';
const WATCHER_MAIN_MODULE_PATH = 'src/lib/watcher/Watcher.ts';
const DECLARED_PACKAGE_PATTERN = /`src\/lib\/([a-z-]+)`/g;
const HEADER_COMMENT = /^\/\*\*([\s\S]*?)\*\//;

/** What the Watcher must never reach: the tracker and its model, the git primitives, and the app layers above `src/lib/`. */
const FORBIDDEN_FOLDERS = ['src/lib/tracker-model/', 'src/lib/git/', 'src/shared/', 'src/adapters/', 'src/services/', 'cli/'];
const FORBIDDEN_NAMES = /agent-progress|claude|anthropic/i;

const SCANNER = createImportGraphScanner(repositoryRootOfThisCheckout());

function declaredPackageFoldersOf(graph: ImportGraph): readonly string[] {
  const header = HEADER_COMMENT.exec(graph.sourceTextOf(WATCHER_MAIN_MODULE_PATH))?.[1]?.replace(/\n\s*\*/g, ' ') ?? '';
  return [...header.matchAll(DECLARED_PACKAGE_PATTERN)].map((match) => `src/lib/${match[1] ?? ''}/`);
}

function closureOf(graph: ImportGraph): readonly string[] {
  return [...reachablePathsFrom(graph, [WATCHER_BINARY_PATH])].sort();
}

/** Every file of the closure outside the package and its declared packages, and every test-only file in it. */
function strayPathsOf(graph: ImportGraph): readonly string[] {
  const allowedFolders = [WATCHER_PACKAGE_FOLDER, ...declaredPackageFoldersOf(graph)];
  return closureOf(graph).filter((path) => path !== WATCHER_BINARY_PATH
    && (!allowedFolders.some((folder) => path.startsWith(folder)) || path.endsWith('.spec.ts') || path.split('/').includes('testing')));
}

describe('the Watcher bundle closure', () => {
  test('the scan reaches the Watcher package and both declared packages from watcher.ts', () => {
    expect(declaredPackageFoldersOf(SCANNER.graph)).toEqual(['src/lib/atomic-file/', 'src/lib/process-identity/']);
    expect(closureOf(SCANNER.graph)).toEqual(expect.arrayContaining([
      WATCHER_BINARY_PATH, WATCHER_MAIN_MODULE_PATH, 'src/lib/watcher/EventLog.ts', 'src/lib/atomic-file/AtomicFile.ts', 'src/lib/process-identity/ProcessIdentity.ts',
    ]));
  });

  test('stays inside the package and its declared packages', () => {
    expect(strayPathsOf(SCANNER.graph)).toEqual([]);
  });

  test('a planted import of another lib package is named', () => {
    const plantedPath = 'src/lib/watcher/WatcherFiles.ts';
    const plantedSource = `import { CLAUDE_CODE_ADAPTER } from '../claude-code/ClaudeCodeAdapter.ts';\n${SCANNER.graph.sourceTextOf(plantedPath)}`;
    const strayPaths = strayPathsOf(SCANNER.graphWithPlantedFiles({ [plantedPath]: plantedSource }));
    expect(strayPaths).toContain('src/lib/claude-code/ClaudeCodeAdapter.ts');
  });

  test('never reaches the board, the ticket files or git', () => {
    expect(closureOf(SCANNER.graph).filter((path) => FORBIDDEN_FOLDERS.some((folder) => path.startsWith(folder)))).toEqual([]);
    const builtins = SCANNER.graph.edges
      .filter((edge) => closureOf(SCANNER.graph).includes(edge.fromPath) && edge.target.kind === 'package')
      .map((edge) => (edge.target.kind === 'package' ? edge.target.specifier : ''));
    expect([...new Set(builtins)].sort()).toEqual(['node:crypto', 'node:fs', 'node:net', 'node:path']);
  });

  test('its shipped files name no product and no vendor', () => {
    const shippedPackagePaths = SCANNER.graph.scannedPaths.filter((path) => path.startsWith(WATCHER_PACKAGE_FOLDER) && !path.endsWith('.spec.ts'));
    expect(shippedPackagePaths.length).toBeGreaterThanOrEqual(5);
    expect(shippedPackagePaths.filter((path) => FORBIDDEN_NAMES.test(SCANNER.graph.sourceTextOf(path)))).toEqual([]);
  });
});
