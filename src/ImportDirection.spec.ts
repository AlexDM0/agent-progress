/**
 * The Imports rules of the root `CLAUDE.md`, held over every file the root, page and dispatcher programs compile. Every violation list is
 * empty in a tree that obeys them, so the scan first proves it saw the tree (all three programs, every file placed in a layer, every
 * allowlist entry still used), and each kind of violation is planted once in memory to prove the guard still names the edge.
 */
import { describe, expect, test } from 'bun:test';

import type { ImportEdge, ImportGraph }                           from './testing/ImportGraph.ts';
import { createImportGraphScanner, repositoryRootOfThisCheckout } from './testing/ImportGraph.ts';

type ImportViolation =
  | 'layer-imports-upward'
  | 'feature-imports-another-feature'
  | 'command-imports-a-sibling-command'
  | 'binary-imports-beyond-cli'
  | 'test-helper-imported-outside-its-allowlist'
  | 'lib-imports-an-undeclared-package'
  | 'tracker-model-reaches-outside-itself'
  | 'import-cycle'
  | 'barrel';

type Layer =
  | 'binary'
  | 'lib'
  | 'shared'
  | 'adapters'
  | 'render-service'
  | 'tracker-service'
  | 'test-support'
  | 'repository-guard'
  | 'cli'
  | 'page'
  | 'dispatcher'
  | 'unplaced';

interface Finding {
  readonly violation:     ImportViolation;
  readonly sentence:      string;
  readonly involvedPaths: readonly string[];
}

const BINARY_PATH = 'agent-progress.ts';
const FEATURES = ['cli', 'page', 'dispatcher'] as const satisfies readonly Layer[];
const SOURCE_LAYERS = ['lib', 'shared', 'adapters', 'render-service', 'tracker-service'] as const satisfies readonly Layer[];

/** What each layer may import, a folder in a testing folder aside: those are judged by `TESTING_FOLDER_IMPORTERS` alone. */
const LAYER_REACH: Readonly<Record<Layer, readonly Layer[]>> = {
  'binary':           ['cli'],
  'lib':              ['lib'],
  'shared':           ['lib', 'shared'],
  'adapters':         ['lib', 'shared', 'adapters'],
  'render-service':   ['lib', 'shared', 'adapters', 'render-service'],
  'tracker-service':  ['lib', 'shared', 'adapters', 'render-service', 'tracker-service'],
  'test-support':     [...SOURCE_LAYERS],
  'repository-guard': [],
  'cli':              [...SOURCE_LAYERS, 'cli'],
  'page':             [...SOURCE_LAYERS, 'page'],
  'dispatcher':       [...SOURCE_LAYERS, 'dispatcher'],
  'unplaced':         [],
};

/**
 * Each test-only folder and the folders whose specs, or whose own test-only folders, may import it; nothing that ships imports any of them.
 * Exact both ways: every `testing/` folder in the tree has an entry, and every importer folder is used by at least one import.
 */
const TESTING_FOLDER_IMPORTERS: Readonly<Record<string, readonly string[]>> = {
  'src/testing/':                   ['src/', 'cli/', 'page/'],
  'src/lib/tracker-model/testing/': ['src/lib/tracker-model/'],
  'src/adapters/progress/testing/': ['src/adapters/'],
  'src/services/tracker/testing/':  ['src/services/tracker/'],
  'cli/testing/':                   ['cli/'],
  'page/testing/':                  ['page/'],
  'dispatcher/testing/':            ['dispatcher/'],
};

interface Allowlists {
  readonly testingFolderImporters: Readonly<Record<string, readonly string[]>>;
}

const ALLOWLISTS: Allowlists = { testingFolderImporters: TESTING_FOLDER_IMPORTERS };

/** Folders inside a `cli/` set that hold what the set's commands share rather than one command. */
const CLI_SET_SHARED_FOLDERS = ['@types', 'constants', 'utils'];
const TRACKER_MODEL_FOLDER = 'src/lib/tracker-model/';
const LIB_FOLDER = 'src/lib/';
const LIB_DEPENDENCY_SENTENCE = /depends on ([^.]+)/i;
const LIB_PACKAGE_REFERENCE = /`src\/lib\/([a-z-]+)`/g;
const HEADER_COMMENT = /^\/\*\*([\s\S]*?)\*\//;
const SPEC_SUFFIX = '.spec.ts';

function isSpec(path: string): boolean {
  return path.endsWith(SPEC_SUFFIX);
}

function isInside(path: string, folder: string): boolean {
  return path.startsWith(folder);
}

function layerOf(path: string): Layer {
  if (path === BINARY_PATH) return 'binary';
  const [topFolder, layerFolder, unitFolder] = path.split('/');
  if (topFolder === 'cli' || topFolder === 'page' || topFolder === 'dispatcher') return topFolder;
  if (topFolder !== 'src' || layerFolder === undefined) return 'unplaced';
  if (unitFolder === undefined) return isSpec(path) ? 'repository-guard' : 'unplaced';
  switch (layerFolder) {
    case 'lib':
      return path.split('/').length > 3 ? 'lib' : 'unplaced';
    case 'shared':
      return 'shared';
    case 'adapters':
      return 'adapters';
    case 'services':
      if (unitFolder === 'render') return 'render-service';
      return unitFolder === 'tracker' ? 'tracker-service' : 'unplaced';
    case 'testing':
      return 'test-support';
    default:
      return 'unplaced';
  }
}

/** The folder up to and including the first segment named `name`, or null outside one. */
function enclosingFolderNamed(path: string, name: string): string | null {
  const segments = path.split('/');
  const index = segments.slice(0, -1).indexOf(name);
  return index === -1 ? null : `${segments.slice(0, index + 1).join('/')}/`;
}

function testingFolderOf(path: string): string | null {
  return enclosingFolderNamed(path, 'testing');
}

function libPackageOf(path: string): string | null {
  return isInside(path, LIB_FOLDER) && path.split('/').length > 3 ? path.split('/')[2] ?? null : null;
}

/** `cli/<set>/<command>/`: a folder of a set that is not one of the folders the set's commands share. */
function commandFolderOf(path: string): string | null {
  const segments = path.split('/');
  const [topFolder, setFolder, commandFolder] = segments;
  if (topFolder !== 'cli' || setFolder === undefined || commandFolder === undefined || segments.length < 4) return null;
  return CLI_SET_SHARED_FOLDERS.includes(commandFolder) ? null : `cli/${setFolder}/${commandFolder}/`;
}

function isTestOnly(path: string): boolean {
  return isSpec(path) || testingFolderOf(path) !== null;
}

/** The lib packages each package's main module names in its header, the one module of the package whose header says what it depends on. */
function declaredLibDependenciesOf(graph: ImportGraph): ReadonlyMap<string, readonly string[]> {
  const declarations = new Map<string, string[]>();
  for (const path of graph.scannedPaths) {
    const libPackage = libPackageOf(path);
    if (libPackage === null || isTestOnly(path) || path.split('/').length !== 4) continue;
    const header = HEADER_COMMENT.exec(graph.sourceTextOf(path))?.[1]?.replace(/\n\s*\*/g, ' ') ?? '';
    const dependencySentence = LIB_DEPENDENCY_SENTENCE.exec(header)?.[1];
    if (dependencySentence === undefined) continue;
    if (declarations.has(libPackage)) throw new Error(`two modules of src/lib/${libPackage}/ say what it depends on; only its main module does`);
    declarations.set(libPackage, [...dependencySentence.matchAll(LIB_PACKAGE_REFERENCE)].map((match) => match[1] ?? ''));
  }
  return declarations;
}

function describeTarget(edge: ImportEdge): string {
  return edge.target.kind === 'package' ? edge.target.specifier : edge.target.path;
}

function edgeFinding(edge: ImportEdge, violation: ImportViolation, reason: string): Finding {
  const involvedPaths = edge.target.kind === 'package' ? [edge.fromPath] : [edge.fromPath, edge.target.path];
  return { violation, sentence: `${edge.fromPath}:${edge.line} imports ${describeTarget(edge)}: ${reason}`, involvedPaths };
}

function testingFolderFinding(edge: ImportEdge, targetPath: string, allowlists: Allowlists): Finding | null {
  const targetTestingFolder = testingFolderOf(targetPath);
  if (targetTestingFolder === null || testingFolderOf(edge.fromPath) === targetTestingFolder) return null;
  const importerFolders = Object.hasOwn(allowlists.testingFolderImporters, targetTestingFolder) ? allowlists.testingFolderImporters[targetTestingFolder] ?? [] : [];
  if (isTestOnly(edge.fromPath) && importerFolders.some((importerFolder) => isInside(edge.fromPath, importerFolder))) return null;
  const allowed = importerFolders.length === 0 ? 'nothing, as it has no allowlist entry' : `only the specs of ${importerFolders.join(', ')}`;
  return edgeFinding(edge, 'test-helper-imported-outside-its-allowlist', `${targetTestingFolder} is test-only and may be imported by ${allowed}`);
}

function directionFinding(edge: ImportEdge, targetPath: string): Finding | null {
  const fromLayer = layerOf(edge.fromPath);
  const targetLayer = layerOf(targetPath);
  if (testingFolderOf(targetPath) !== null || LAYER_REACH[fromLayer].includes(targetLayer)) return null;
  if (fromLayer === 'binary') {
    return edgeFinding(edge, 'binary-imports-beyond-cli', `${BINARY_PATH} imports only cli/`);
  }
  const isFeature = (layer: Layer): boolean => (FEATURES as readonly Layer[]).includes(layer);
  if (isFeature(fromLayer) && isFeature(targetLayer)) {
    return edgeFinding(edge, 'feature-imports-another-feature', `the ${fromLayer} feature imports another feature, ${targetLayer}`);
  }
  return edgeFinding(edge, 'layer-imports-upward', `${fromLayer} reaches only ${LAYER_REACH[fromLayer].join(', ') || 'nothing'}, not ${targetLayer}`);
}

function commandFinding(edge: ImportEdge, targetPath: string): Finding | null {
  const fromCommand = commandFolderOf(edge.fromPath);
  const targetCommand = commandFolderOf(targetPath);
  if (fromCommand === null || targetCommand === null || fromCommand === targetCommand) return null;
  return edgeFinding(edge, 'command-imports-a-sibling-command', `the command folder ${fromCommand} imports another command's folder; hoist what both need above them`);
}

function libFinding(edge: ImportEdge, declarations: ReadonlyMap<string, readonly string[]>): Finding | null {
  const fromPackage = libPackageOf(edge.fromPath);
  if (fromPackage === null) return null;
  if (isInside(edge.fromPath, TRACKER_MODEL_FOLDER) && !isTestOnly(edge.fromPath)) {
    const staysInside = edge.target.kind === 'repository-file' && isInside(edge.target.path, TRACKER_MODEL_FOLDER) && testingFolderOf(edge.target.path) === null;
    return staysInside ? null : edgeFinding(edge, 'tracker-model-reaches-outside-itself', `${TRACKER_MODEL_FOLDER} imports nothing outside its own folder and no builtin`);
  }
  const targetPackage = edge.target.kind === 'repository-file' ? libPackageOf(edge.target.path) : null;
  if (targetPackage === null || targetPackage === fromPackage || (declarations.get(fromPackage) ?? []).includes(targetPackage)) return null;
  return edgeFinding(edge, 'lib-imports-an-undeclared-package', `the header of src/lib/${fromPackage}/'s main module does not name src/lib/${targetPackage}`);
}

function edgeFindingsOf(edge: ImportEdge, declarations: ReadonlyMap<string, readonly string[]>, allowlists: Allowlists): readonly (Finding | null)[] {
  if (edge.form === 're-export') {
    return [edgeFinding(edge, 'barrel', 'a re-export makes one module stand for others')];
  }
  const libVerdict = libFinding(edge, declarations);
  if (edge.target.kind === 'package') return [libVerdict];
  const targetPath = edge.target.path;
  return [
    directionFinding(edge, targetPath),
    commandFinding(edge, targetPath),
    testingFolderFinding(edge, targetPath, allowlists),
    libVerdict,
  ];
}

/** Tarjan's strongly connected components: each component of more than one file, or a file importing itself, is a loop. */
function cyclesIn(edges: readonly (readonly [string, string])[]): readonly (readonly string[])[] {
  const successors = new Map<string, string[]>();
  for (const [fromNode, toNode] of edges) {
    successors.set(fromNode, [...(successors.get(fromNode) ?? []), toNode]);
  }
  const visitOrder = new Map<string, number>();
  const lowestReachable = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const cycles: string[][] = [];
  const visit = (node: string): void => {
    const order = visitOrder.size;
    visitOrder.set(node, order);
    lowestReachable.set(node, order);
    stack.push(node);
    onStack.add(node);
    for (const successor of successors.get(node) ?? []) {
      if (!visitOrder.has(successor)) {
        visit(successor);
        lowestReachable.set(node, Math.min(lowestReachable.get(node) ?? order, lowestReachable.get(successor) ?? order));
      } else if (onStack.has(successor)) {
        lowestReachable.set(node, Math.min(lowestReachable.get(node) ?? order, visitOrder.get(successor) ?? order));
      }
    }
    if (lowestReachable.get(node) !== order) return;
    const component: string[] = [];
    let member: string | undefined;
    do {
      member = stack.pop();
      if (member !== undefined) {
        onStack.delete(member);
        component.push(member);
      }
    } while (member !== undefined && member !== node);
    if (component.length > 1 || (successors.get(node) ?? []).includes(node)) {
      cycles.push(component.sort());
    }
  };
  for (const node of [...successors.keys()].sort()) {
    if (!visitOrder.has(node)) visit(node);
  }
  return cycles;
}

function cycleFindingsOf(graph: ImportGraph): readonly Finding[] {
  const fileEdges = graph.edges.flatMap((edge): (readonly [string, string])[] => (edge.target.kind === 'repository-file' ? [[edge.fromPath, edge.target.path]] : []));
  const libPackageEdges = fileEdges.flatMap(([fromPath, targetPath]): (readonly [string, string])[] => {
    const fromPackage = libPackageOf(fromPath);
    const targetPackage = libPackageOf(targetPath);
    return fromPackage === null || targetPackage === null || fromPackage === targetPackage ? [] : [[`src/lib/${fromPackage}/`, `src/lib/${targetPackage}/`]];
  });
  return [...cyclesIn(fileEdges), ...cyclesIn(libPackageEdges)].map((cycle): Finding => ({
    violation:     'import-cycle',
    sentence:      `an import cycle loops through ${cycle.join(' → ')}`,
    involvedPaths: cycle,
  }));
}

function findingsOf(graph: ImportGraph, allowlists: Allowlists): readonly Finding[] {
  const declarations = declaredLibDependenciesOf(graph);
  const edgeFindings = graph.edges.flatMap((edge) => edgeFindingsOf(edge, declarations, allowlists)).filter((finding) => finding !== null);
  const indexFileFindings = graph.scannedPaths
    .filter((path) => path.split('/').at(-1) === 'index.ts')
    .map((path): Finding => ({ violation: 'barrel', sentence: `${path} is an index file, which stands for the modules beside it`, involvedPaths: [path] }));
  return [...edgeFindings, ...cycleFindingsOf(graph), ...indexFileFindings];
}

/** An allowlist entry or a header declaration no import uses any more: each allowlist is exact in both directions. */
function unusedAllowancesOf(graph: ImportGraph, allowlists: Allowlists): readonly string[] {
  const fileEdges = graph.edges.flatMap((edge) => (edge.target.kind === 'repository-file' ? [{ fromPath: edge.fromPath, targetPath: edge.target.path }] : []));
  const testingFoldersInTree = new Set(graph.scannedPaths.flatMap((path) => testingFolderOf(path) ?? []));
  const listedTestingFolders = Object.keys(allowlists.testingFolderImporters);
  const unusedImporters = Object.entries(allowlists.testingFolderImporters).flatMap(([testingFolder, importerFolders]) => importerFolders
    .filter((importerFolder) => !fileEdges.some(({ fromPath, targetPath }) => testingFolderOf(targetPath) === testingFolder
      && testingFolderOf(fromPath) !== testingFolder
      && isInside(fromPath, importerFolder)))
    .map((importerFolder) => `TESTING_FOLDER_IMPORTERS lets ${importerFolder} import ${testingFolder}, and nothing there does`));
  const importedLibPackages = new Set(fileEdges.flatMap(({ fromPath, targetPath }) => {
    const fromPackage = libPackageOf(fromPath);
    const targetPackage = libPackageOf(targetPath);
    return fromPackage === null || targetPackage === null || isTestOnly(fromPath) ? [] : [`${fromPackage} → ${targetPackage}`];
  }));
  const unusedDeclarations = [...declaredLibDependenciesOf(graph)].flatMap(([libPackage, dependencies]) => dependencies
    .filter((dependency) => !importedLibPackages.has(`${libPackage} → ${dependency}`))
    .map((dependency) => `the header of src/lib/${libPackage}/ names src/lib/${dependency}, which the package does not import`));
  return [
    ...[...testingFoldersInTree].filter((folder) => !listedTestingFolders.includes(folder)).map((folder) => `${folder} has no TESTING_FOLDER_IMPORTERS entry`),
    ...listedTestingFolders.filter((folder) => !testingFoldersInTree.has(folder)).map((folder) => `TESTING_FOLDER_IMPORTERS lists ${folder}, which holds no file`),
    ...unusedImporters,
    ...unusedDeclarations,
  ].sort();
}

function sentencesAbout(findings: readonly Finding[], violation: ImportViolation): readonly string[] {
  return findings.filter((finding) => finding.violation === violation).map((finding) => finding.sentence).sort();
}

const SCANNER = createImportGraphScanner(repositoryRootOfThisCheckout());
const GRAPH = SCANNER.graph;
const FINDINGS = findingsOf(GRAPH, ALLOWLISTS);

/** Only findings that involve a planted file, or a folder holding one, count, so a violation elsewhere in the tree cannot sway a self-test. */
function plantedFindingsOf(plantedSources: Readonly<Record<string, string>>): readonly Finding[] {
  const plantedPaths = Object.keys(plantedSources);
  const involvesAPlantedFile = (involvedPath: string): boolean => plantedPaths
    .some((plantedPath) => plantedPath === involvedPath || (involvedPath.endsWith('/') && isInside(plantedPath, involvedPath)));
  return findingsOf(SCANNER.graphWithPlantedFiles(plantedSources), ALLOWLISTS).filter((finding) => finding.involvedPaths.some(involvesAPlantedFile));
}

function plantedSentencesOf(plantedSources: Readonly<Record<string, string>>): readonly string[] {
  return plantedFindingsOf(plantedSources).map((finding) => `${finding.violation} — ${finding.sentence}`).sort();
}

function importing(specifier: string): string {
  return `import { planted } from '${specifier}';\nexport const plantedValue = planted;\n`;
}

describe('the scan itself', () => {
  /** The floors are round numbers well under today's counts, to fail a scan that read the wrong tree or only one program. */
  test('it read the root, page and dispatcher programs and found the imports inside the repository in each', () => {
    const repositoryEdges = GRAPH.edges.filter((edge) => edge.target.kind === 'repository-file');
    expect(GRAPH.scannedPaths).toContain(BINARY_PATH);
    for (const topFolder of ['cli/', 'page/', 'dispatcher/', 'src/lib/', 'src/shared/', 'src/adapters/', 'src/services/', 'src/testing/']) {
      expect(GRAPH.scannedPaths.filter((path) => isInside(path, topFolder)).length, `files under ${topFolder}`).toBeGreaterThanOrEqual(5);
      expect(repositoryEdges.filter((edge) => isInside(edge.fromPath, topFolder)).length, `imports made under ${topFolder}`).toBeGreaterThanOrEqual(5);
    }
    expect(repositoryEdges.length, 'imports inside the repository').toBeGreaterThanOrEqual(1500);
  });

  test('it sees dynamic, package and builtin imports as well as static ones inside the repository', () => {
    expect(GRAPH.edges.some((edge) => edge.form === 'dynamic-import' && edge.fromPath === 'cli/CommandTable.ts'), 'the command table\'s lazy imports').toBe(true);
    expect(GRAPH.edges.some((edge) => edge.target.kind === 'package' && edge.target.specifier === 'bun:test'), 'the test runner').toBe(true);
    expect(GRAPH.edges.some((edge) => edge.target.kind === 'package' && edge.target.specifier === 'node:fs'), 'a builtin').toBe(true);
  });

  /** A file no rule places is judged by none, so it fails here until its folder is placed in a layer. */
  test('every scanned file belongs to a layer the rules name', () => {
    expect(GRAPH.scannedPaths.filter((path) => layerOf(path) === 'unplaced')).toEqual([]);
  });

  test('it finds the command folders, the lib packages and the header that declares a lib dependency', () => {
    const commandFolders = new Set(GRAPH.scannedPaths.flatMap((path) => commandFolderOf(path) ?? []));
    const libPackages = new Set(GRAPH.scannedPaths.flatMap((path) => libPackageOf(path) ?? []));
    expect(commandFolders.size, 'command folders under cli/').toBeGreaterThanOrEqual(10);
    expect(libPackages.size, 'packages under src/lib/').toBeGreaterThanOrEqual(4);
    expect(declaredLibDependenciesOf(GRAPH).get('claude-code')).toEqual(['atomic-file', 'json-record', 'local-time']);
  });

  test('every allowlist entry and every declared lib dependency is still used, and every testing folder is listed', () => {
    expect(unusedAllowancesOf(GRAPH, ALLOWLISTS)).toEqual([]);
  });
});

describe('the guard still names each violation, planted in memory', () => {
  test('a layer importing upward, and not one importing below itself', () => {
    expect(plantedSentencesOf({ 'src/adapters/log/PlantedWording.ts': importing('../../services/render/RenderState.ts') })).toEqual([
      'layer-imports-upward — src/adapters/log/PlantedWording.ts:1 imports src/services/render/RenderState.ts: adapters reaches only lib, shared, adapters, not render-service',
    ]);
    expect(plantedSentencesOf({ 'src/services/render/PlantedStep.ts': importing('../tracker/TrackerLock.ts') })).toEqual([
      'layer-imports-upward — src/services/render/PlantedStep.ts:1 imports src/services/tracker/TrackerLock.ts: '
        + 'render-service reaches only lib, shared, adapters, render-service, not tracker-service',
    ]);
    expect(plantedSentencesOf({ 'src/shared/PlantedValue.ts': importing('../../cli/Main.ts') })).toEqual([
      'layer-imports-upward — src/shared/PlantedValue.ts:1 imports cli/Main.ts: shared reaches only lib, shared, not cli',
    ]);
    expect(plantedSentencesOf({ 'src/services/tracker/PlantedStep.ts': importing('../render/RenderState.ts') })).toEqual([]);
  });

  test('a feature importing another feature', () => {
    expect(plantedSentencesOf({ 'page/PlantedView.ts': importing('../dispatcher/Dispatcher.ts') })).toEqual([
      'feature-imports-another-feature — page/PlantedView.ts:1 imports dispatcher/Dispatcher.ts: the page feature imports another feature, dispatcher',
    ]);
  });

  test('a command folder importing a sibling command\'s folder, and not the set\'s shared files or cli/utils/', () => {
    expect(plantedSentencesOf({ 'cli/tracking/log/PlantedStep.ts': importing('../status/StatusCommand.ts') })).toEqual([
      'command-imports-a-sibling-command — cli/tracking/log/PlantedStep.ts:1 imports cli/tracking/status/StatusCommand.ts: '
        + 'the command folder cli/tracking/log/ imports another command\'s folder; hoist what both need above them',
    ]);
    const importingHoistedFiles = `${importing('../RenderDashboardOrRefuse.ts')}${importing('../../utils/PlantedUtil.ts').replaceAll('planted', 'plantedUtil')}`;
    expect(plantedSentencesOf({ 'cli/tracking/log/PlantedStep.ts': importingHoistedFiles })).toEqual([]);
  });

  test('the binary importing anything but cli/', () => {
    expect(plantedSentencesOf({ 'agent-progress.ts': importing('./src/shared/Environment.ts') })).toEqual([
      'binary-imports-beyond-cli — agent-progress.ts:1 imports src/shared/Environment.ts: agent-progress.ts imports only cli/',
    ]);
  });

  test('a test-only folder imported by shipped code, by a spec outside its allowlist or with no entry at all, and not by an allowed spec', () => {
    expect(plantedSentencesOf({ 'src/shared/PlantedValue.ts': importing('../testing/ScratchWorkspace.ts') })).toEqual([
      'test-helper-imported-outside-its-allowlist — src/shared/PlantedValue.ts:1 imports src/testing/ScratchWorkspace.ts: '
        + 'src/testing/ is test-only and may be imported by only the specs of src/, cli/, page/',
    ]);
    expect(plantedSentencesOf({ 'page/PlantedView.spec.ts': importing('../cli/testing/CliProcess.ts') })).toEqual([
      'test-helper-imported-outside-its-allowlist — page/PlantedView.spec.ts:1 imports cli/testing/CliProcess.ts: '
        + 'cli/testing/ is test-only and may be imported by only the specs of cli/',
    ]);
    expect(plantedSentencesOf({
      'src/shared/PlantedValue.spec.ts':      importing('./testing/PlantedFixture.ts'),
      'src/shared/testing/PlantedFixture.ts': 'export const planted = 1;\n',
    })).toEqual([
      'test-helper-imported-outside-its-allowlist — src/shared/PlantedValue.spec.ts:1 imports src/shared/testing/PlantedFixture.ts: '
        + 'src/shared/testing/ is test-only and may be imported by nothing, as it has no allowlist entry',
    ]);
    expect(plantedSentencesOf({ 'src/shared/PlantedValue.spec.ts': importing('../testing/ScratchWorkspace.ts') })).toEqual([]);
  });

  test('a lib package importing a package its main module\'s header does not name, and not one it names', () => {
    expect(plantedSentencesOf({ 'src/lib/utils/PlantedUtil.ts': importing('../git/GitProcess.ts') })).toEqual([
      'lib-imports-an-undeclared-package — src/lib/utils/PlantedUtil.ts:1 imports src/lib/git/GitProcess.ts: '
        + 'the header of src/lib/utils/\'s main module does not name src/lib/git',
    ]);
    expect(plantedSentencesOf({ 'src/lib/git/utils/PlantedUtil.ts': importing('../../atomic-file/AtomicFile.ts') })).toEqual([]);
  });

  test('the tracker model importing a builtin or a file outside its folder, and not a spec of it importing the test runner', () => {
    expect(plantedSentencesOf({ 'src/lib/tracker-model/utils/PlantedUtil.ts': importing('node:fs') })).toEqual([
      'tracker-model-reaches-outside-itself — src/lib/tracker-model/utils/PlantedUtil.ts:1 imports node:fs: '
        + 'src/lib/tracker-model/ imports nothing outside its own folder and no builtin',
    ]);
    expect(plantedSentencesOf({ 'src/lib/tracker-model/utils/PlantedUtil.ts': importing('../../utils/TimeUtil.ts') })).toEqual([
      'tracker-model-reaches-outside-itself — src/lib/tracker-model/utils/PlantedUtil.ts:1 imports src/lib/utils/TimeUtil.ts: '
        + 'src/lib/tracker-model/ imports nothing outside its own folder and no builtin',
    ]);
    expect(plantedSentencesOf({ 'src/lib/tracker-model/utils/PlantedUtil.spec.ts': importing('bun:test') })).toEqual([]);
  });

  test('an import cycle between two files, and between two lib packages through different files', () => {
    expect(plantedSentencesOf({
      'src/shared/utils/PlantedFirst.ts':  importing('./PlantedSecond.ts'),
      'src/shared/utils/PlantedSecond.ts': importing('./PlantedFirst.ts'),
    })).toEqual(['import-cycle — an import cycle loops through src/shared/utils/PlantedFirst.ts → src/shared/utils/PlantedSecond.ts']);
    const libPackageCycle = plantedFindingsOf({
      'src/lib/utils/PlantedFirst.ts': importing('../git/PlantedSecond.ts'),
      'src/lib/git/PlantedSecond.ts':  'export const planted = 1;\n',
      'src/lib/git/PlantedThird.ts':   importing('../utils/PlantedFirst.ts'),
    });
    expect(sentencesAbout(libPackageCycle, 'import-cycle')).toEqual(['an import cycle loops through src/lib/git/ → src/lib/utils/']);
  });

  test('a barrel, in either re-export spelling, and an index file', () => {
    expect(plantedSentencesOf({
      'page/utils/PlantedBarrel.ts': 'export { planted } from \'./PlantedView.ts\';\nexport * from \'./PlantedView.ts\';\n',
      'page/utils/PlantedView.ts':   'export const planted = 1;\n',
    })).toEqual([
      'barrel — page/utils/PlantedBarrel.ts:1 imports page/utils/PlantedView.ts: a re-export makes one module stand for others',
      'barrel — page/utils/PlantedBarrel.ts:2 imports page/utils/PlantedView.ts: a re-export makes one module stand for others',
    ]);
    expect(plantedSentencesOf({ 'src/shared/utils/index.ts': 'export const planted = 1;\n' })).toEqual([
      'barrel — src/shared/utils/index.ts is an index file, which stands for the modules beside it',
    ]);
  });

  test('an allowlist entry or a declared lib dependency nothing uses any more, and a testing folder without an entry', () => {
    const plantedAllowlists: Allowlists = { testingFolderImporters: { ...TESTING_FOLDER_IMPORTERS, 'cli/testing/': ['cli/', 'dispatcher/'], 'src/retired/testing/': ['src/'] }, };
    const mainModulePath = 'src/lib/claude-code/ClaudeTranscripts.ts';
    const plantedHeader = GRAPH.sourceTextOf(mainModulePath).replace('depends on `src/lib/atomic-file`', 'depends on `src/lib/git`, `src/lib/atomic-file`');
    const plantedGraph = SCANNER.graphWithPlantedFiles({ [mainModulePath]: plantedHeader, 'src/shared/testing/PlantedFixture.ts': 'export const planted = 1;\n' });
    expect(unusedAllowancesOf(plantedGraph, plantedAllowlists)).toEqual([
      'TESTING_FOLDER_IMPORTERS lets dispatcher/ import cli/testing/, and nothing there does',
      'TESTING_FOLDER_IMPORTERS lets src/ import src/retired/testing/, and nothing there does',
      'TESTING_FOLDER_IMPORTERS lists src/retired/testing/, which holds no file',
      'src/shared/testing/ has no TESTING_FOLDER_IMPORTERS entry',
      'the header of src/lib/claude-code/ names src/lib/git, which the package does not import',
    ]);
  });
});

describe('the imports of the tree', () => {
  test('no layer imports upward: each reaches only the layers below it and itself', () => {
    expect(sentencesAbout(FINDINGS, 'layer-imports-upward')).toEqual([]);
  });

  test('no feature imports another feature', () => {
    expect(sentencesAbout(FINDINGS, 'feature-imports-another-feature')).toEqual([]);
  });

  test('no cli/ command folder imports a sibling command\'s folder', () => {
    expect(sentencesAbout(FINDINGS, 'command-imports-a-sibling-command')).toEqual([]);
  });

  test('agent-progress.ts imports only cli/', () => {
    expect(sentencesAbout(FINDINGS, 'binary-imports-beyond-cli')).toEqual([]);
  });

  test('nothing that ships imports a testing folder, and each testing folder is imported only by the specs its entry names', () => {
    expect(sentencesAbout(FINDINGS, 'test-helper-imported-outside-its-allowlist')).toEqual([]);
  });

  test('a lib package imports only the lib packages its main module\'s header names', () => {
    expect(sentencesAbout(FINDINGS, 'lib-imports-an-undeclared-package')).toEqual([]);
  });

  test('the tracker model imports nothing outside its own folder and no builtin', () => {
    expect(sentencesAbout(FINDINGS, 'tracker-model-reaches-outside-itself')).toEqual([]);
  });

  test('no import cycle exists, between files or between lib packages', () => {
    expect(sentencesAbout(FINDINGS, 'import-cycle')).toEqual([]);
  });

  test('no file re-exports another, and no index file exists', () => {
    expect(sentencesAbout(FINDINGS, 'barrel')).toEqual([]);
  });
});
