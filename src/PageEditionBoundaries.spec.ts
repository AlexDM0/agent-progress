/**
 * What holds the two page editions apart, so the spec page can reuse the tracker page's views without taking its live behaviour or its
 * markup with it. The cases that matter: the tracker page's entry reaches nothing under `page/spec/`; the spec page's entry reaches no
 * module of `TRACKER_PAGE_ONLY_MODULES`, a list exact both ways; a `page/spec/` literal names only `ap-spec-*` marks or an id of
 * `resources/spec-template.html`, so a spec view never borrows a tracker-page class or id; and no `page/spec/` literal names a hook
 * attribute a tracker-page controller reads. Each scan proves it found something, and each is watched failing on a planted offence.
 */
import { readFileSync } from 'node:fs';
import { join }         from 'node:path';

import { describe, expect, test } from 'bun:test';
import ts                         from 'typescript';

import type { ImportGraph }                                                           from './testing/ImportGraph.ts';
import { createImportGraphScanner, reachablePathsFrom, repositoryRootOfThisCheckout } from './testing/ImportGraph.ts';

const TRACKER_PAGE_ENTRY = 'page/PageStart.ts';
const SPEC_PAGE_ENTRY    = 'page/spec/SpecPageStart.ts';
const SPEC_PAGE_FOLDER   = 'page/spec/';
const SPEC_TEMPLATE_PATH = 'resources/spec-template.html';

/** Live-page behaviour a snapshot never has; a folder ends in `/`, a name prefix in `*`, anything else is one module. */
const TRACKER_PAGE_ONLY_MODULES = [
  'page/reload/',
  'page/finished-work/',
  'page/header/LiveHeaderController.ts',
  'page/header/ActivityBanner*',
  'page/preferences/ViewerPreferences.ts',
  'page/preferences/utils/ViewerPreferenceUtil.ts',
];

/** Attributes tracker-page controllers read and write, which a spec view's markup must not wake. */
const SHARED_HOOK_ATTRIBUTES = ['data-kanban-lane', 'data-selected', 'data-motion', 'data-swapped', 'data-panel-room'];

const MARKUP_TOKEN_PATTERN = /(?<![a-z0-9-])ap-[a-z0-9-]+/g;

const SPEC_MARK_PREFIX = 'ap-spec-';

const TEMPLATE_ID_PATTERN = /(?<![\w-])id="([^"]+)"/g;

const SCANNER = createImportGraphScanner(repositoryRootOfThisCheckout());

function moduleIsNamedBy(entry: string, path: string): boolean {
  if (entry.endsWith('/')) {
    return path.startsWith(entry);
  }
  if (entry.endsWith('*')) {
    return path.startsWith(entry.slice(0, -1));
  }
  return path === entry;
}

function trackerPageOnlyModulesReachedFrom(graph: ImportGraph, entryPath: string, trackerPageOnlyModules: readonly string[]): string[] {
  return [...reachablePathsFrom(graph, [entryPath])]
    .filter((path) => trackerPageOnlyModules.some((entry) => moduleIsNamedBy(entry, path)))
    .sort();
}

function entriesNamingNoModuleOf(graph: ImportGraph, trackerPageOnlyModules: readonly string[]): string[] {
  const trackerPageReach = [...reachablePathsFrom(graph, [TRACKER_PAGE_ENTRY])];
  return trackerPageOnlyModules.filter((entry) => !trackerPageReach.some((path) => moduleIsNamedBy(entry, path)));
}

function specPageSourcePathsOf(graph: ImportGraph): string[] {
  return graph.scannedPaths.filter((path) => path.startsWith(SPEC_PAGE_FOLDER) && path.endsWith('.ts') && !path.endsWith('.spec.ts'));
}

function literalTextsOf(path: string, sourceText: string): string[] {
  const sourceFile = ts.createSourceFile(path, sourceText, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const texts: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      texts.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return texts;
}

interface LiteralOffence {
  readonly path:  string;
  readonly token: string;
}

function foreignMarkupTokensOf(graph: ImportGraph, templateIds: ReadonlySet<string>): LiteralOffence[] {
  return specPageSourcePathsOf(graph).flatMap((path) => literalTextsOf(path, graph.sourceTextOf(path))
    .flatMap((text) => [...text.matchAll(MARKUP_TOKEN_PATTERN)].map((match) => match[0]))
    .filter((token) => !token.startsWith(SPEC_MARK_PREFIX) && !templateIds.has(token))
    .map((token) => ({ path, token })));
}

function sharedHookAttributesNamedIn(graph: ImportGraph): LiteralOffence[] {
  return specPageSourcePathsOf(graph).flatMap((path) => literalTextsOf(path, graph.sourceTextOf(path))
    .flatMap((text) => SHARED_HOOK_ATTRIBUTES.filter((attribute) => text.includes(attribute)))
    .map((token) => ({ path, token })));
}

function idsDeclaredIn(templateText: string): ReadonlySet<string> {
  return new Set([...templateText.matchAll(TEMPLATE_ID_PATTERN)].map((match) => match[1] ?? ''));
}

function specTemplateIds(): ReadonlySet<string> {
  return idsDeclaredIn(readFileSync(join(repositoryRootOfThisCheckout(), SPEC_TEMPLATE_PATH), 'utf8'));
}

function specPageEntryWith(appendedSource: string): ImportGraph {
  return SCANNER.graphWithPlantedFiles({ [SPEC_PAGE_ENTRY]: `${SCANNER.graph.sourceTextOf(SPEC_PAGE_ENTRY)}${appendedSource}` });
}

describe('edition isolation', () => {
  test('the tracker page reaches no spec page module', () => {
    const trackerPageReach = [...reachablePathsFrom(SCANNER.graph, [TRACKER_PAGE_ENTRY])];

    expect(trackerPageReach).toContain('page/preferences/ViewerPreferences.ts');
    expect(trackerPageReach.filter((path) => path.startsWith(SPEC_PAGE_FOLDER))).toEqual([]);
  });

  test('a tracker page module importing a spec page module is caught', () => {
    const trackerPageModule = 'page/kanban/KanbanController.ts';
    const plantedImport = 'import { planted } from \'../spec/SpecPageStart.ts\';\n';
    const graph = SCANNER.graphWithPlantedFiles({ [trackerPageModule]: `${plantedImport}${SCANNER.graph.sourceTextOf(trackerPageModule)}` });

    expect([...reachablePathsFrom(graph, [TRACKER_PAGE_ENTRY])].filter((path) => path.startsWith(SPEC_PAGE_FOLDER))).toContain(SPEC_PAGE_ENTRY);
  });

  test('the spec page reaches something, and nothing in TRACKER_PAGE_ONLY_MODULES', () => {
    expect(reachablePathsFrom(SCANNER.graph, [SPEC_PAGE_ENTRY]).size).toBeGreaterThan(1);
    expect(trackerPageOnlyModulesReachedFrom(SCANNER.graph, SPEC_PAGE_ENTRY, TRACKER_PAGE_ONLY_MODULES)).toEqual([]);
  });

  test('the spec page importing the tracker page preferences is caught', () => {
    const graph = specPageEntryWith('import { createViewerPreferences } from \'../preferences/ViewerPreferences.ts\';\n');

    expect(trackerPageOnlyModulesReachedFrom(graph, SPEC_PAGE_ENTRY, TRACKER_PAGE_ONLY_MODULES)).toContain('page/preferences/ViewerPreferences.ts');
  });

  test('every TRACKER_PAGE_ONLY_MODULES entry names a module the tracker page reaches', () => {
    expect(entriesNamingNoModuleOf(SCANNER.graph, TRACKER_PAGE_ONLY_MODULES)).toEqual([]);
  });

  test('an entry naming no module is caught', () => {
    expect(entriesNamingNoModuleOf(SCANNER.graph, [...TRACKER_PAGE_ONLY_MODULES, 'page/planted-nowhere/'])).toEqual(['page/planted-nowhere/']);
  });
});

describe('shared markup', () => {
  test('the spec template declares ids and the scan reads spec page sources', () => {
    expect(specTemplateIds().size).toBeGreaterThan(0);
    expect(specPageSourcePathsOf(SCANNER.graph)).toContain(SPEC_PAGE_ENTRY);
  });

  test('only an id attribute declares a template id, never a data-id', () => {
    expect([...idsDeclaredIn('<main id="ap-spec-root"><i data-id="ap-stat"></i></main>')]).toEqual(['ap-spec-root']);
  });

  test('every ap- token in a spec page literal is an ap-spec mark or a spec template id', () => {
    expect(foreignMarkupTokensOf(SCANNER.graph, specTemplateIds())).toEqual([]);
  });

  test('a spec page literal naming a tracker page mark is caught, in a string and in a template literal', () => {
    const graph = specPageEntryWith('export const planted = [\'ap-stat\', `<i class="ap-chip ${\'\'}">`];\n');

    expect(foreignMarkupTokensOf(graph, specTemplateIds())).toEqual([
      { path: SPEC_PAGE_ENTRY, token: 'ap-stat' },
      { path: SPEC_PAGE_ENTRY, token: 'ap-chip' },
    ]);
  });
});

describe('shared hooks', () => {
  test('no spec page literal names a SHARED_HOOK_ATTRIBUTES entry', () => {
    expect(specPageSourcePathsOf(SCANNER.graph).length).toBeGreaterThan(0);
    expect(sharedHookAttributesNamedIn(SCANNER.graph)).toEqual([]);
  });

  test('a spec page literal naming a shared hook is caught', () => {
    const graph = specPageEntryWith('export const planted = \'[data-kanban-lane="done"]\';\n');

    expect(sharedHookAttributesNamedIn(graph)).toEqual([{ path: SPEC_PAGE_ENTRY, token: 'data-kanban-lane' }]);
  });
});
