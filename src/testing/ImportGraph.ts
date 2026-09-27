/**
 * Every import edge of the repository's TypeScript, over the files the root, page and dispatcher programs compile, read syntactically with
 * the compiler API so no type checking is paid for. Planted sources add or replace files in memory, so a guard can prove it still fires.
 */
import { readFileSync } from 'node:fs';
import {
  dirname,
  join,
  posix,
  relative,
  resolve
} from 'node:path';

import ts from 'typescript';

export type ImportForm = 'import' | 're-export' | 'dynamic-import';

export type ImportTarget =
  | { readonly kind: 'repository-file'; readonly path: string }
  | { readonly kind: 'package'; readonly specifier: string };

export interface ImportEdge {
  readonly fromPath: string;
  readonly line:     number;
  readonly form:     ImportForm;
  readonly target:   ImportTarget;
}

export interface ImportGraph {
  readonly repositoryRoot: string;
  /** Repository-relative, with forward slashes, sorted. */
  readonly scannedPaths:   readonly string[];
  readonly edges:          readonly ImportEdge[];
  readonly sourceTextOf:   (path: string) => string;
}

/** Each spec project holds its shipping project plus the specs, so these four together name every file the type check compiles. */
const PROGRAM_CONFIGURATION_PATHS = ['tsconfig.json', 'page/tsconfig.spec.json', 'dispatcher/tsconfig.json', 'dispatcher/tsconfig.spec.json'];

function repositoryPathOf(repositoryRoot: string, absolutePath: string): string {
  return relative(repositoryRoot, absolutePath).split('\\').join('/');
}

function programFilePathsOf(repositoryRoot: string): readonly string[] {
  const unreportedDiagnostic = (): void => undefined;
  const parsingHost: ts.ParseConfigFileHost = { ...ts.sys, onUnRecoverableConfigFileDiagnostic: unreportedDiagnostic };
  const filePaths = PROGRAM_CONFIGURATION_PATHS.flatMap((configurationPath) => {
    const parsedConfiguration = ts.getParsedCommandLineOfConfigFile(join(repositoryRoot, configurationPath), {}, parsingHost);
    return (parsedConfiguration?.fileNames ?? []).map((fileName) => repositoryPathOf(repositoryRoot, resolve(fileName)));
  });
  return [...new Set(filePaths)];
}

function stringLiteralTextOf(node: ts.Node | undefined): string | null {
  return node !== undefined && ts.isStringLiteralLike(node) ? node.text : null;
}

function targetOf(fromPath: string, specifier: string): ImportTarget {
  if (!specifier.startsWith('.')) {
    return { kind: 'package', specifier };
  }
  return { kind: 'repository-file', path: posix.normalize(posix.join(posix.dirname(fromPath), specifier)) };
}

function edgesOf(fromPath: string, sourceText: string): readonly ImportEdge[] {
  const sourceFile = ts.createSourceFile(fromPath, sourceText, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const edges: ImportEdge[] = [];
  const record = (node: ts.Node, form: ImportForm, specifier: string | null): void => {
    if (specifier === null) {
      return;
    }
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    edges.push({
      fromPath, line, form, target: targetOf(fromPath, specifier)
    });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      record(node, 'import', stringLiteralTextOf(node.moduleSpecifier));
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined) {
      record(node, 're-export', stringLiteralTextOf(node.moduleSpecifier));
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      record(node, 'import', stringLiteralTextOf(node.moduleReference.expression));
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      record(node, 'dynamic-import', stringLiteralTextOf(node.arguments[0]));
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      record(node, 'import', stringLiteralTextOf(node.argument.literal));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return edges;
}

export interface ImportGraphScanner {
  readonly graph:                 ImportGraph;
  /** The graph with these repository-relative sources added, or put in place of the file at the same path; the tree on disk is untouched. */
  readonly graphWithPlantedFiles: (plantedSources: Readonly<Record<string, string>>) => ImportGraph;
}

export function createImportGraphScanner(repositoryRoot: string): ImportGraphScanner {
  const sourceTexts = new Map(programFilePathsOf(repositoryRoot).map((path) => [path, readFileSync(join(repositoryRoot, path), 'utf8')]));
  const edgesByPath = new Map([...sourceTexts].map(([path, sourceText]) => [path, edgesOf(path, sourceText)]));
  const graphOf = (texts: ReadonlyMap<string, string>, edgesByScannedPath: ReadonlyMap<string, readonly ImportEdge[]>): ImportGraph => ({
    repositoryRoot,
    scannedPaths: [...edgesByScannedPath.keys()].sort(),
    edges:        [...edgesByScannedPath.values()].flat(),
    sourceTextOf: (path) => texts.get(path) ?? '',
  });
  return {
    graph:                 graphOf(sourceTexts, edgesByPath),
    graphWithPlantedFiles: (plantedSources) => {
      const plantedTexts = new Map(sourceTexts);
      const plantedEdgesByPath = new Map(edgesByPath);
      for (const [plantedPath, plantedSource] of Object.entries(plantedSources)) {
        plantedTexts.set(plantedPath, plantedSource);
        plantedEdgesByPath.set(plantedPath, edgesOf(plantedPath, plantedSource));
      }
      return graphOf(plantedTexts, plantedEdgesByPath);
    },
  };
}

export function repositoryRootOfThisCheckout(): string {
  return resolve(dirname(import.meta.path), '..', '..');
}
