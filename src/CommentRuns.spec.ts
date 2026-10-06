/**
 * The root `CLAUDE.md` rule that an inline comment is one or two lines, a why and never a wall: outside a docblock (a file header, or a
 * `/** *\/` directly leading a declaration or a `test`, `describe` or `it` call), no run of adjacent `//` lines and no other
 * `/* … *\/` block spans more than two lines, in any file the checkout holds. Comments are read from the syntax tree, so `//` inside a
 * string or template is not one. The scan first proves it read runs of both sizes, and each form is planted to prove the guard names it
 * or lets it pass.
 */
import { describe, expect, test } from 'bun:test';
import ts                         from 'typescript';

import { repositoryRootOfThisCheckout } from './testing/ImportGraph.ts';
import { repositoryTypeScriptSources }  from './testing/RepositorySources.ts';

interface CommentRun {
  readonly firstLine: number;
  readonly lineCount: number;
}

const LONGEST_INLINE_COMMENT_LINES = 2;
const ONLY_A_LINE_BREAK_BETWEEN = /^[ \t]*\r?\n[ \t]*$/;

interface CommentRanges {
  readonly ranges:                          ts.CommentRange[];
  readonly positionsLeadingADocumentedNode: ReadonlySet<number>;
}

const DOCUMENTED_DECLARATION_KINDS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.Constructor,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.MethodSignature,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor,
  ts.SyntaxKind.PropertyDeclaration,
  ts.SyntaxKind.PropertySignature,
  ts.SyntaxKind.PropertyAssignment,
  ts.SyntaxKind.InterfaceDeclaration,
  ts.SyntaxKind.TypeAliasDeclaration,
  ts.SyntaxKind.EnumDeclaration,
  ts.SyntaxKind.EnumMember,
  ts.SyntaxKind.VariableStatement,
  ts.SyntaxKind.ExportDeclaration,
  ts.SyntaxKind.ExportAssignment,
]);
// `src/testing/ToolGuard.ts` wraps `describe` and `test` as `describeWhen…` and `testWhen…`, which take a docblock the same way.
const DOCUMENTED_CALLEE_NAME = /^(?:test|describe|it)(?:When[A-Z]\w*)?$/;

function calleeRootNameOf(expression: ts.Expression): string | null {
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }
  if (ts.isCallExpression(expression) || ts.isPropertyAccessExpression(expression)) {
    return calleeRootNameOf(expression.expression);
  }
  return null;
}

function nodeTakesADocblock(node: ts.Node): boolean {
  if (DOCUMENTED_DECLARATION_KINDS.has(node.kind)) {
    return true;
  }
  if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)) {
    const calleeName = calleeRootNameOf(node.expression.expression);
    return calleeName !== null && DOCUMENTED_CALLEE_NAME.test(calleeName);
  }
  return false;
}

function commentRangesOf(sourceFile: ts.SourceFile): CommentRanges {
  const rangesByPosition = new Map<number, ts.CommentRange>();
  const positionsLeadingADocumentedNode = new Set<number>();
  const text = sourceFile.getFullText();
  const collect = (node: ts.Node): void => {
    const leadingRanges = ts.getLeadingCommentRanges(text, node.getFullStart()) ?? [];
    for (const range of [...leadingRanges, ...ts.getTrailingCommentRanges(text, node.getEnd()) ?? []]) {
      rangesByPosition.set(range.pos, range);
    }
    if (nodeTakesADocblock(node)) {
      leadingRanges.forEach((range) => positionsLeadingADocumentedNode.add(range.pos));
    }
    ts.forEachChild(node, collect);
  };
  collect(sourceFile);
  collect(sourceFile.endOfFileToken);
  return { ranges: [...rangesByPosition.values()].sort((a, b) => a.pos - b.pos), positionsLeadingADocumentedNode };
}

function inlineCommentRunsOf(path: string, text: string): CommentRun[] {
  const sourceFile = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const lineOf = (position: number): number => sourceFile.getLineAndCharacterOfPosition(position).line + 1;
  const { ranges, positionsLeadingADocumentedNode } = commentRangesOf(sourceFile);
  const firstCodePosition = sourceFile.statements[0]?.getStart(sourceFile) ?? sourceFile.endOfFileToken.getStart(sourceFile);
  const isDocblock = (range: ts.CommentRange, index: number): boolean => text.startsWith('/**', range.pos)
    && ((index === 0 && range.end <= firstCodePosition) || positionsLeadingADocumentedNode.has(range.pos));
  const runs: CommentRun[] = [];
  let previous: ts.CommentRange | null = null;
  for (const [index, range] of ranges.entries()) {
    if (isDocblock(range, index)) {
      previous = null;
      continue;
    }
    const lineCount = lineOf(range.end) - lineOf(range.pos) + 1;
    const lastRun = runs.at(-1);
    const continuesTheRun = previous !== null && lastRun !== undefined && range.kind === ts.SyntaxKind.SingleLineCommentTrivia
      && previous.kind === ts.SyntaxKind.SingleLineCommentTrivia && ONLY_A_LINE_BREAK_BETWEEN.test(text.slice(previous.end, range.pos));
    if (continuesTheRun) {
      runs[runs.length - 1] = { firstLine: lastRun.firstLine, lineCount: lastRun.lineCount + lineCount };
    } else {
      runs.push({ firstLine: lineOf(range.pos), lineCount });
    }
    previous = range;
  }
  return runs;
}

function commentWallsOf(path: string, text: string): string[] {
  return inlineCommentRunsOf(path, text)
    .filter((run) => run.lineCount > LONGEST_INLINE_COMMENT_LINES)
    .map((run) => `${path}:${run.firstLine} holds a ${run.lineCount}-line comment`);
}

const SOURCES = repositoryTypeScriptSources(repositoryRootOfThisCheckout());

describe('no inline comment runs past two lines', () => {
  test('the scan reads inline comments of one line and of two lines across the tree', () => {
    const runLengths = SOURCES.flatMap((source) => inlineCommentRunsOf(source.path, source.text).map((run) => run.lineCount));
    expect(runLengths.filter((lineCount) => lineCount === 1).length).toBeGreaterThan(LONGEST_INLINE_COMMENT_LINES);
    expect(runLengths.filter((lineCount) => lineCount === LONGEST_INLINE_COMMENT_LINES).length).toBeGreaterThan(LONGEST_INLINE_COMMENT_LINES);
  });

  test('no file in the tree holds a comment wall', () => {
    expect(SOURCES.flatMap((source) => commentWallsOf(source.path, source.text))).toEqual([]);
  });

  test.each([
    ['three `//` lines in a function', 'function work(): void {\n  // one\n  // two\n  // three\n  run();\n}\n'],
    ['three `//` lines opening a file', '// one\n// two\n// three\nexport const VALUE = 1;\n'],
    ['three `//` lines closing a file', 'export const VALUE = 1;\n// one\n// two\n// three\n'],
    ['a three-line block comment', 'function work(): void {\n  /* one\n     two\n     three */\n  run();\n}\n'],
    ['a three-line `/** */` above a call in a function', 'function work(): void {\n  /** one\n   * two\n   * three */\n  run();\n}\n'],
    ['a three-line `/** */` above a return in a callback', 'run(() => {\n  /** one\n   * two\n   * three */\n  return 1;\n});\n'],
    ['a three-line `/** */` below the code that opens a file', 'run();\n/** one\n * two\n * three */\nrun();\n'],
  ])('a planted wall of %s is named', (_form, plantedText) => {
    expect(commentWallsOf('Planted.ts', plantedText)).toEqual([expect.stringContaining('3-line comment')]);
  });

  const documentedLine = (code: string): string => `/**\n * A docblock of\n * four lines.\n */\n${code}\n`;
  test.each([
    ['a file header', documentedLine('import { run } from \'./Run.ts\';')],
    ['a function', documentedLine('function work(): void {}')],
    [
      'a class, its constructor, method, accessor and property',
      documentedLine('class Work {') + documentedLine('readonly size = 1;') + documentedLine('constructor() {}') + documentedLine('run(): void {}')
        + documentedLine('get total(): number { return 1; }') + '}\n',
    ],
    ['an interface and its members', documentedLine('interface Work {') + documentedLine('readonly size: number;') + documentedLine('run(): void;') + '}\n'],
    ['a type alias', documentedLine('type Work = number;')],
    ['an enum and its member', documentedLine('enum Work {') + documentedLine('Done,') + '}\n'],
    ['a variable statement in a function', 'function work(): void {\n' + documentedLine('const size = 1;') + 'run(size);\n}\n'],
    ['an object literal property', 'run({\n' + documentedLine('size: 1,') + '});\n'],
    [
      'a tool-gated `describeWhen…()` and `testWhen…()` call',
      'run();\n' + documentedLine('describeWhenGitIsPresent(\'work\', () => {') + documentedLine('testWhenBashIsPresent(\'runs\', () => {});') + '});\n',
    ],
    ['an export', 'run();\n' + documentedLine('export { run };') + documentedLine('export default run;')],
    [
      'a `test()` and a `test.each()()` call in a `describe()` call',
      'run();\n' + documentedLine('describe(\'work\', () => {') + documentedLine('test(\'runs\', () => {});')
        + documentedLine('test.each([1])(\'runs %d\', () => {});') + documentedLine('it(\'runs\', () => {});') + '});\n',
    ],
  ])('a long docblock leading %s passes', (_form, plantedText) => {
    expect(commentWallsOf('Planted.ts', plantedText)).toEqual([]);
  });

  test('a two-line comment, a long docblock, trailing comments on code lines and `//` inside strings pass', () => {
    const plantedText = [
      '/**',
      ' * A header of',
      ' * four lines.',
      ' */',
      'function work(): void {',
      '  // one',
      '  // two',
      '  run(); // a',
      '  run(); // b',
      '  run(); // c',
      '  const address = `https://example.com/${"//"}`;',
      '  const other = \'// not a comment\';',
      '}',
    ].join('\n');
    expect(commentWallsOf('Planted.ts', plantedText)).toEqual([]);
  });
});
