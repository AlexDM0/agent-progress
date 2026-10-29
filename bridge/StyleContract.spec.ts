/**
 * The Bridge's style contract, held both ways: every class a shipping component emits is styled in `bridge/styles/board.css`, and every
 * class `board.css` styles is emitted, so an unstyled class and a dead rule both fail. Classes are read from the syntax tree, as `className`
 * literals (a string, a template without substitutions, or a conditional between those); a `className` the scan cannot read fails too,
 * since its classes could not be held. The scan first proves it found a floor of each, and each form is planted in memory.
 */
import { readFileSync } from 'node:fs';
import { join }         from 'node:path';

import { describe, expect, test } from 'bun:test';
import ts                         from 'typescript';

const BRIDGE_FOLDER = import.meta.dir;
const BOARD_STYLESHEET_PATH = join(BRIDGE_FOLDER, 'styles', 'board.css');
const SMALLEST_CLASS_COUNT = 10;

interface ComponentSource {
  readonly path: string;
  readonly text: string;
}

interface EmittedClasses {
  readonly classNames: ReadonlySet<string>;
  /** `<path>:<line>` of each `className` whose value is not a literal the scan can read. */
  readonly unreadable: readonly string[];
}

function isShippingComponent(path: string): boolean {
  return path.endsWith('.tsx') && !path.endsWith('.dom.tsx') && !path.split('/').includes('testing');
}

function shippingComponentSources(): ComponentSource[] {
  return [...new Bun.Glob('**/*.tsx').scanSync({ cwd: BRIDGE_FOLDER })]
    .filter(isShippingComponent)
    .sort()
    .map((path) => ({ path, text: readFileSync(join(BRIDGE_FOLDER, path), 'utf8') }));
}

/** The literal texts an expression can evaluate to, or `null` when it is anything else. */
function literalTextsOf(expression: ts.Expression): string[] | null {
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return [expression.text];
  if (ts.isParenthesizedExpression(expression)) return literalTextsOf(expression.expression);
  if (ts.isConditionalExpression(expression)) {
    const whenTrue = literalTextsOf(expression.whenTrue);
    const whenFalse = literalTextsOf(expression.whenFalse);
    return whenTrue === null || whenFalse === null ? null : [...whenTrue, ...whenFalse];
  }
  return null;
}

function emittedClassesOf(sources: readonly ComponentSource[]): EmittedClasses {
  const classNames = new Set<string>();
  const unreadable: string[] = [];
  for (const { path, text } of sources) {
    const sourceFile = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node): void => {
      if (ts.isJsxAttribute(node) && node.name.getText(sourceFile) === 'className') {
        const { initializer } = node;
        let texts: string[] | null = null;
        if (initializer !== undefined && ts.isStringLiteral(initializer)) texts = [initializer.text];
        else if (initializer !== undefined && ts.isJsxExpression(initializer) && initializer.expression !== undefined) texts = literalTextsOf(initializer.expression);
        if (texts === null) unreadable.push(`${path}:${sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1}`);
        else texts.flatMap((classText) => classText.split(/\s+/)).filter((className) => className !== '').forEach((className) => classNames.add(className));
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return { classNames, unreadable };
}

/** Every class selector the stylesheet's rules name; its comments are prose and are left out. */
function styledClassesOf(stylesheetText: string): ReadonlySet<string> {
  const withoutComments = stylesheetText.replace(/\/\*[\s\S]*?\*\//g, '');
  return new Set([...withoutComments.matchAll(/\.(-?[a-zA-Z_][\w-]*)/g)].map(([, className = '']) => className));
}

function contractSentencesOf(emitted: EmittedClasses, styled: ReadonlySet<string>): string[] {
  return [
    ...emitted.unreadable.map((site) => `${site} sets a className the scan cannot read: use a literal`),
    ...[...emitted.classNames].filter((className) => !styled.has(className)).sort().map((className) => `.${className} is emitted but board.css does not style it`),
    ...[...styled].filter((className) => !emitted.classNames.has(className)).sort().map((className) => `.${className} is styled in board.css but no component emits it`),
  ];
}

const SOURCES = shippingComponentSources();
const EMITTED = emittedClassesOf(SOURCES);
const STYLED = styledClassesOf(readFileSync(BOARD_STYLESHEET_PATH, 'utf8'));

describe('the scan itself', () => {
  test('it reads the shipping components and the stylesheet, and finds a floor of classes in each', () => {
    expect(SOURCES.map(({ path }) => path)).toContain('shell/BridgeApp.tsx');
    expect(SOURCES.some(({ path }) => path.endsWith('.dom.tsx'))).toBe(false);
    expect(EMITTED.classNames.size).toBeGreaterThanOrEqual(SMALLEST_CLASS_COUNT);
    expect(STYLED.size).toBeGreaterThanOrEqual(SMALLEST_CLASS_COUNT);
  });
});

describe('the guard, planted in memory', () => {
  const planted = (text: string): EmittedClasses => emittedClassesOf([{ path: 'shell/Planted.tsx', text }]);

  test('an unstyled class, a dead rule and an unreadable className are each named', () => {
    expect(contractSentencesOf(planted('export const view = <p className="bridge-planted bridge-empty" />;'), new Set(['bridge-empty', 'bridge-dead']))).toEqual([
      '.bridge-planted is emitted but board.css does not style it',
      '.bridge-dead is styled in board.css but no component emits it',
    ]);
    expect(planted('export const view = (name: string) => <p className={name} />;').unreadable).toEqual(['shell/Planted.tsx:1']);
  });

  test('a conditional between literals and a template without substitutions are read, and a comment is not a rule', () => {
    expect([...planted('export const view = (on: boolean) => <p className={on ? \'bridge-on\' : `bridge-off`} />;').classNames]).toEqual(['bridge-on', 'bridge-off']);
    expect([...styledClassesOf('/* .bridge-prose */ .bridge-rule { color: var(--ink); line-height: 1.45; }')]).toEqual(['bridge-rule']);
  });
});

describe('the components and board.css', () => {
  test('every emitted class is styled and every styled class is emitted', () => {
    expect(contractSentencesOf(EMITTED, STYLED)).toEqual([]);
  });
});
