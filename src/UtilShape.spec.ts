/**
 * The root `CLAUDE.md` rule that a util groups a domain and is never a util holding one function: every exported `*Util` object, in
 * every file the checkout holds, has at least two members. The scan first proves it read the utils, and each form a util is written in
 * (`{ … } as const`, `Object.freeze({ … })`, a bare literal) is planted with one member to prove the guard names it.
 */
import { describe, expect, test } from 'bun:test';
import ts                         from 'typescript';

import { repositoryRootOfThisCheckout } from './testing/ImportGraph.ts';
import { repositoryTypeScriptSources }  from './testing/RepositorySources.ts';

interface UtilShape {
  readonly name:        string;
  /** Null when the initializer is not an object literal the scan can count, which the guard reports rather than passes. */
  readonly memberCount: number | null;
}

const UTIL_NAME = /Util$/;
const MINIMUM_UTIL_MEMBER_COUNT = 2;

function objectLiteralInside(expression: ts.Expression): ts.ObjectLiteralExpression | null {
  if (ts.isObjectLiteralExpression(expression)) return expression;
  if (ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression) || ts.isParenthesizedExpression(expression)) {
    return objectLiteralInside(expression.expression);
  }
  const freezesItsArgument = ts.isCallExpression(expression) && expression.expression.getText() === 'Object.freeze';
  const [frozenValue] = ts.isCallExpression(expression) ? expression.arguments : [];
  return freezesItsArgument && frozenValue !== undefined ? objectLiteralInside(frozenValue) : null;
}

function exportedUtilShapesOf(path: string, text: string): UtilShape[] {
  const sourceFile = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  return sourceFile.statements
    .filter(ts.isVariableStatement)
    .filter((statement) => statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true)
    .flatMap((statement) => [...statement.declarationList.declarations])
    .filter((declaration) => ts.isIdentifier(declaration.name) && UTIL_NAME.test(declaration.name.text))
    .map((declaration) => {
      const literal = declaration.initializer === undefined ? null : objectLiteralInside(declaration.initializer);
      return { name: declaration.name.getText(), memberCount: literal === null ? null : literal.properties.length };
    });
}

function undersizedUtilsOf(shapes: readonly UtilShape[]): string[] {
  return shapes
    .filter((shape) => shape.memberCount === null || shape.memberCount < MINIMUM_UTIL_MEMBER_COUNT)
    .map((shape) => `${shape.name} has ${shape.memberCount ?? 'an uncountable set of'} member(s)`);
}

const SHIPPING_SOURCES = repositoryTypeScriptSources(repositoryRootOfThisCheckout()).filter((source) => !source.path.endsWith('.spec.ts'));
const UTIL_SHAPES = SHIPPING_SOURCES.flatMap((source) => exportedUtilShapesOf(source.path, source.text)
  .map((shape) => ({ ...shape, name: `${source.path}: ${shape.name}` })));

describe('every exported util groups at least two members', () => {
  test('the scan reads the utils of every feature and of src/', () => {
    for (const folder of ['src/', 'cli/', 'bridge/']) {
      expect(UTIL_SHAPES.filter((shape) => shape.name.startsWith(folder)).length).toBeGreaterThan(MINIMUM_UTIL_MEMBER_COUNT);
    }
  });

  test('no util in the tree holds fewer than two members', () => {
    expect(undersizedUtilsOf(UTIL_SHAPES)).toEqual([]);
  });

  test.each([
    ['an `as const` literal', 'export const LoneUtil = { only } as const;'],
    ['a frozen literal', 'export const LoneUtil = Object.freeze({ only });'],
    ['a bare literal', 'export const LoneUtil = { only: (): number => 1 };'],
    ['an empty literal', 'export const LoneUtil = {} as const;'],
    ['an initializer the scan cannot count', 'export const LoneUtil = makeUtil();'],
  ])('a planted one-member util written as %s is named', (_form, plantedText) => {
    expect(undersizedUtilsOf(exportedUtilShapesOf('Planted.ts', plantedText))).toEqual([expect.stringContaining('LoneUtil')]);
  });

  test('a two-member util, an unexported one and a non-util object pass', () => {
    const plantedText = [
      'export const PairUtil = Object.freeze({ first, second });',
      'const LocalUtil = { only } as const;',
      'export const SETTINGS = { only };',
    ].join('\n');
    expect(undersizedUtilsOf(exportedUtilShapesOf('Planted.ts', plantedText))).toEqual([]);
  });
});
