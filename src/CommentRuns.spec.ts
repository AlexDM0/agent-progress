/**
 * The root `CLAUDE.md` rule that an inline comment is one or two lines, a why and never a wall: outside a docblock (a file header is
 * one), no run of adjacent `//` lines and no `/* … *\/` block spans more than two lines, in any file the checkout holds. Comments are
 * read from the syntax tree, so `//` inside a string or template is not one. The scan first proves it read runs of both sizes, and each
 * form is planted to prove the guard names it.
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

function commentRangesOf(sourceFile: ts.SourceFile): ts.CommentRange[] {
  const rangesByPosition = new Map<number, ts.CommentRange>();
  const collect = (node: ts.Node): void => {
    const text = sourceFile.getFullText();
    for (const range of [...ts.getLeadingCommentRanges(text, node.getFullStart()) ?? [], ...ts.getTrailingCommentRanges(text, node.getEnd()) ?? []]) {
      rangesByPosition.set(range.pos, range);
    }
    ts.forEachChild(node, collect);
  };
  collect(sourceFile);
  collect(sourceFile.endOfFileToken);
  return [...rangesByPosition.values()].sort((a, b) => a.pos - b.pos);
}

function inlineCommentRunsOf(path: string, text: string): CommentRun[] {
  const sourceFile = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const lineOf = (position: number): number => sourceFile.getLineAndCharacterOfPosition(position).line + 1;
  const runs: CommentRun[] = [];
  let previous: ts.CommentRange | null = null;
  for (const range of commentRangesOf(sourceFile)) {
    if (text.startsWith('/**', range.pos)) {
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
  ])('a planted wall of %s is named', (_form, plantedText) => {
    expect(commentWallsOf('Planted.ts', plantedText)).toEqual([expect.stringContaining('3-line comment')]);
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
