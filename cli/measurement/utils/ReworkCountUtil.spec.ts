/**
 * The counting contract `agent-progress rework` is judged by, against constructed diff text. The cases that
 * matter are the ones a reviewer could dodge a threshold through or be charged wrongly by: a trailing comment
 * that is really code, a comment a hunk begins inside, a removed line that looks like a file header, the two
 * sides of a hunk that must not share their comment state, an unknown file type, and the interdiff that must
 * find nothing when a rebase changed nothing.
 */
import { describe, expect, test } from 'bun:test';

import type { FileRework } from './ReworkCountUtil';
import { ReworkCountUtil } from './ReworkCountUtil';

const {
  addedLinesInOnlyOne,
  classifyFileLines,
  combineFileReworks,
  readDiff,
  reworkOfFile,
  totalReworkOf,
} = ReworkCountUtil;

/** A one-hunk git diff of `path`; each line carries its own `+`, `-` or ` ` marker and the header counts are derived from them. */
function diffOf(path: string, hunkLines: readonly string[]): string {
  const oldLength = hunkLines.filter((line) => !line.startsWith('+')).length;
  const newLength = hunkLines.filter((line) => !line.startsWith('-')).length;
  return [
    `diff --git a/${path} b/${path}`,
    'index 1111111..2222222 100644',
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -10,${oldLength} +10,${newLength} @@ function context()`,
    ...hunkLines,
  ].join('\n');
}

function reworkOf(diffText: string): FileRework[] {
  return readDiff(diffText).map(reworkOfFile);
}

function codeLinesOf(diffText: string): number {
  return totalReworkOf(reworkOf(diffText)).reworkedCodeLines;
}

describe('what counts as code', () => {
  test('a line holding code and a trailing comment is code', () => {
    expect(codeLinesOf(diffOf('lib/Example.ts', ['+const answer = 42; // the answer', '+const other = 1; /* aside */']))).toBe(2);
  });

  test('a multi-line block comment added in full is comment, every line of it', () => {
    const rework = totalReworkOf(reworkOf(diffOf('lib/Example.ts', ['+/**', '+ * Explains the next function.', '+ */', '+export function next(): void {}'])));
    expect(rework.reworkedCodeLines).toBe(1);
    expect(rework.commentLines).toBe(3);
  });

  test('code after a block comment closes on the same line is code', () => {
    expect(codeLinesOf(diffOf('lib/Example.ts', ['+/* closed */ const value = 1;']))).toBe(1);
  });

  test('a comment marker inside a string opens no comment, so the lines after it stay code', () => {
    expect(codeLinesOf(diffOf('lib/Example.ts', ['+const glob = \'src/**/*.ts\';', '+const pattern = "/*";', '+runEverything();']))).toBe(3);
  });

  test('a comment marker inside a template literal spanning lines opens no comment either', () => {
    expect(codeLinesOf(diffOf('lib/Example.ts', ['+const text = `first', '+/* not a comment', '+last`;', '+runEverything();']))).toBe(4);
  });

  test('blank lines are never counted, on either side', () => {
    const rework = totalReworkOf(reworkOf(diffOf('lib/Example.ts', ['+', '+   ', '-', '+const value = 1;'])));
    expect(rework.reworkedCodeLines).toBe(1);
    expect(rework.blankLines).toBe(3);
  });

  /** The hand-typed pipeline dropped this line for looking like a `---` file header, which is how a removal went uncounted. */
  test('a removed line whose content starts with two dashes is counted, not taken for a file header', () => {
    const rework = totalReworkOf(reworkOf(diffOf('lib/Example.ts', ['-- pendingCount;', '++ pendingCount;'])));
    expect(rework.removedCodeLines).toBe(1);
    expect(rework.addedCodeLines).toBe(1);
  });

  test('the file headers themselves are not counted', () => {
    const rework = totalReworkOf(reworkOf(diffOf('lib/Example.ts', [' unchanged();', '+added();'])));
    expect(rework).toEqual({
      reworkedCodeLines:  1,
      addedCodeLines:     1,
      removedCodeLines:   0,
      commentLines:       0,
      blankLines:         0,
      documentationLines: 0,
    });
  });

  test('two files in one diff are counted separately, and a file named again is one entry', () => {
    const diffText = [
      diffOf('lib/First.ts', ['+first();']),
      diffOf('lib/Second.ts', ['-second();']),
      diffOf('lib/First.ts', ['+again();']),
    ].join('\n');
    expect(reworkOf(diffText).map(({ path, addedCodeLines, removedCodeLines }) => ({ path, addedCodeLines, removedCodeLines }))).toEqual([
      { path: 'lib/First.ts', addedCodeLines: 2, removedCodeLines: 0 },
      { path: 'lib/Second.ts', addedCodeLines: 0, removedCodeLines: 1 },
    ]);
  });

  test('a deleted file is counted under its old path', () => {
    const diffText = [
      'diff --git a/lib/Gone.ts b/lib/Gone.ts',
      'deleted file mode 100644',
      '--- a/lib/Gone.ts',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-gone();',
      '-// gone',
    ].join('\n');
    expect(reworkOf(diffText)).toEqual([{
      path:               'lib/Gone.ts',
      addedCodeLines:     0,
      removedCodeLines:   1,
      commentLines:       1,
      blankLines:         0,
      documentationLines: 0,
    }]);
  });

  test('a path git quoted is read back as the path it is', () => {
    const diffText = [
      'diff --git "a/lib/caf\\303\\251 \\"x\\".ts" "b/lib/caf\\303\\251 \\"x\\".ts"',
      '--- "a/lib/caf\\303\\251 \\"x\\".ts"',
      '+++ "b/lib/caf\\303\\251 \\"x\\".ts"',
      '@@ -1 +1 @@',
      '-a();',
      '+b();',
    ].join('\n');
    expect(reworkOf(diffText).map(({ path }) => path)).toEqual(['lib/café "x".ts']);
  });
});

describe('a hunk that begins inside a block comment', () => {
  test('a closing delimiter in the context turns the changed lines before it into comment', () => {
    const hunkLines = [' * the middle of a docblock', '+ * an added sentence', '+ * with https://example.com in it', ' */', '+export const value = 1;'];
    const rework    = totalReworkOf(reworkOf(diffOf('lib/Example.ts', hunkLines)));
    expect(rework.commentLines).toBe(2);
    expect(rework.reworkedCodeLines).toBe(1);
  });

  test('a closing delimiter after a line comment marker on the same line is still found', () => {
    const rework = totalReworkOf(reworkOf(diffOf('lib/Example.ts', ['+ still the comment the hunk began in', ' see http://example.com */', '+run();'])));
    expect(rework.commentLines).toBe(1);
    expect(rework.reworkedCodeLines).toBe(1);
  });

  /** Nothing in the hunk says it began in a comment, so the lines count: the tool fails towards counting rather than towards a dodge. */
  test('with no delimiter anywhere in the hunk, its lines are counted as code', () => {
    expect(codeLinesOf(diffOf('lib/Example.ts', [' some words', '+more words', ' further words']))).toBe(1);
  });
});

describe('the old side and the new side keep their own comment state', () => {
  /** In the old file `code();` sat between two calls; a shared state would read it inside the comment the new side opened. */
  test('a removed line inside a comment opened only on the new side is still code', () => {
    const rework = totalReworkOf(reworkOf(diffOf('lib/Example.ts', ['+/*', ' first();', '-code();', '+*/', ' last();'])));
    expect(rework.removedCodeLines).toBe(1);
    expect(rework.addedCodeLines).toBe(0);
    expect(rework.commentLines).toBe(2);
  });

  test('an added line inside a comment opened only on the old side is still code', () => {
    const rework = totalReworkOf(reworkOf(diffOf('lib/Example.ts', ['-/*', ' first();', '+code();', '-*/', ' last();'])));
    expect(rework.addedCodeLines).toBe(1);
    expect(rework.removedCodeLines).toBe(0);
  });
});

describe('languages other than the C family', () => {
  test('a hash starts a comment in Python, YAML and shell, and a line with code before it is code', () => {
    for (const path of ['tool/run.py', '.github/workflows/check.yml', 'setup.sh']) {
      const rework = totalReworkOf(reworkOf(diffOf(path, ['+# a comment', '+value = 1  # trailing', '+    # indented comment'])));
      expect(rework.reworkedCodeLines, path).toBe(1);
      expect(rework.commentLines, path).toBe(2);
    }
  });

  test('a Python docstring is a comment, and a triple-quoted string assigned to a name is code', () => {
    const hunkLines = ['+    """Explain the function.', '+    Across two lines."""', '+query = """', '+select 1', '+"""', '+run(query)'];
    const rework    = totalReworkOf(reworkOf(diffOf('tool/run.py', hunkLines)));
    expect(rework.commentLines).toBe(2);
    expect(rework.reworkedCodeLines).toBe(4);
  });

  test('a multi-line HTML comment is comment, every line of it', () => {
    const rework = totalReworkOf(reworkOf(diffOf('page/index.html', ['+<!--', '+  commented out', '+-->', '+<p>kept</p>'])));
    expect(rework.commentLines).toBe(3);
    expect(rework.reworkedCodeLines).toBe(1);
  });

  test('inside a script element the script syntax holds, and outside it a double slash is markup text', () => {
    const rework = totalReworkOf(reworkOf(diffOf('page/index.html', ['+<script>', '+  // a script comment', '+  run();', '+</script>', '+// markup text'])));
    expect(rework.commentLines).toBe(1);
    expect(rework.reworkedCodeLines).toBe(4);
  });

  test('a CSS block comment is comment and a declaration is code', () => {
    const rework = totalReworkOf(reworkOf(diffOf('page/style.css', ['+/* spacing', '+   for the header */', '+.header { margin: 0; }'])));
    expect(rework.commentLines).toBe(2);
    expect(rework.reworkedCodeLines).toBe(1);
  });

  /** An unlisted type must not be a way under the threshold, so what might be a comment in it is counted. */
  test('every non-blank line of an unknown file type is code, whatever it starts with', () => {
    const rework = totalReworkOf(reworkOf(diffOf('config/settings.unknownext', ['+# looks like a comment', '+// so does this', '+'])));
    expect(rework.reworkedCodeLines).toBe(2);
    expect(rework.blankLines).toBe(1);
  });
});

describe('documentation', () => {
  test('markdown, MDX, reStructuredText, plain text and anything under docs/ is documentation, never code', () => {
    for (const path of ['README.md', 'guide/intro.mdx', 'notes.RST', 'LICENSE.txt', 'docs/diagram.ts']) {
      const rework = totalReworkOf(reworkOf(diffOf(path, ['+const looksLikeCode = true;', '-removed();'])));
      expect(rework.reworkedCodeLines, path).toBe(0);
      expect(rework.documentationLines, path).toBe(2);
    }
  });

  test('a docs folder deeper in the tree is not the repository-rooted docs/', () => {
    expect(codeLinesOf(diffOf('packages/tool/docs/build.ts', ['+build();']))).toBe(1);
  });
});

describe('a whole file read from its first line', () => {
  test('each line is classified against the state the lines above it left', () => {
    expect(classifyFileLines('lib/Example.ts', '/**\n * Doc.\n */\nrun(); // now\n\n')).toEqual(['comment', 'comment', 'comment', 'code', 'blank', 'blank']);
  });
});

describe('the interdiff of two patches of the same work', () => {
  test('two patches holding the same changed lines under different context differ by nothing', () => {
    const before = readDiff(diffOf('lib/Example.ts', [' oldNeighbour();', '+added();', '-removed();']));
    const after  = readDiff(diffOf('lib/Example.ts', [' newNeighbour();', '-removed();', '+added();']));
    expect(addedLinesInOnlyOne(before, after)).toEqual([]);
  });

  // The removed lines differ only because main changed the line underneath; charging them would count every resolved line twice over.
  test('a line resolved differently counts its two added versions and not the base it replaced, and a comment among them is not code', () => {
    const before = readDiff(diffOf('lib/Example.ts', ['-base();', '+builderVersion();', '+// note']));
    const after  = readDiff(diffOf('lib/Example.ts', ['-mainVersion();', '+resolvedVersion();', '+// note']));
    const rework = totalReworkOf(addedLinesInOnlyOne(before, after).map(reworkOfFile));
    expect(rework.reworkedCodeLines).toBe(2);
    expect(rework.removedCodeLines).toBe(0);
    expect(rework.commentLines).toBe(0);
  });

  test('a line repeated in one patch is matched once per copy, not cancelled wholesale', () => {
    const before = readDiff(diffOf('lib/Example.ts', ['+}']));
    const after  = readDiff(diffOf('lib/Example.ts', ['+}', '+}']));
    expect(totalReworkOf(addedLinesInOnlyOne(before, after).map(reworkOfFile)).reworkedCodeLines).toBe(1);
  });
});

test('combining sums each path once and sorts the paths, so two runs print the same breakdown', () => {
  const combined = combineFileReworks([reworkOf(diffOf('lib/Second.ts', ['+b();'])), reworkOf(diffOf('lib/First.ts', ['+a();'])), reworkOf(diffOf('lib/Second.ts', ['-c();']))]);
  expect(combined.map(({ path, addedCodeLines, removedCodeLines }) => [path, addedCodeLines, removedCodeLines])).toEqual([['lib/First.ts', 1, 0], ['lib/Second.ts', 1, 1]]);
});
