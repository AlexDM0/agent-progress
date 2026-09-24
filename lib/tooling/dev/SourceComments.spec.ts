/**
 * The cases that matter are the ones a pattern gets wrong: a comment opener inside a string, a template or a regular expression
 * literal, which must open nothing, and a real comment after one of them, which must still be found. The guards that scan the tree
 * for text rely on both halves, the first so a glob in a string hides no code, the second so a comment may name what they forbid.
 */
import { describe, expect, test }              from 'bun:test';
import { codeWithCommentsBlanked, commentsIn } from './SourceComments';

describe('the comments of a source', () => {
  test('a glob in a string opens no comment, so the code after it survives the blanking', () => {
    const source = 'const pattern = \'lib/*.spec.ts\';\nconst after = 1;\n/** A later docblock. */\n';
    expect(codeWithCommentsBlanked(source)).toContain('const after = 1;');
    expect(commentsIn(source)).toEqual(['/** A later docblock. */']);
  });

  test('a line marker in a string, a template or a regular expression literal is no comment', () => {
    const source = [
      'const address = \'http://example.test\';',
      'const templated = `a /* b ${address} // c`;',
      'const pattern = /`[^`]*\\/\\/\'"/g;',
      'const kept = 2;',
    ].join('\n');
    expect(commentsIn(source)).toEqual([]);
    expect(codeWithCommentsBlanked(source)).toBe(source);
  });

  test('line, block and trailing comments are all found, in order', () => {
    const source = '// first\nconst value = 1; /* second */\n/**\n * third\n */\nexport const other = value; // fourth\n';
    expect(commentsIn(source)).toEqual(['// first', '/* second */', '/**\n * third\n */', '// fourth']);
  });

  test('a blanked comment keeps its length and its newlines, so every line number is unchanged', () => {
    const source = 'const value = 1; /* one\n two */ const other = 2;\n';
    const blanked = codeWithCommentsBlanked(source);
    expect(blanked.length).toBe(source.length);
    expect(blanked).toBe('const value = 1;       \n        const other = 2;\n');
  });

  /** The parser reads a docblock's tags as nodes of their own, and a `//` in a tag's prose must not become a second comment inside the first. */
  test('a line marker inside a docblock is part of the docblock, and the blanking keeps the length', () => {
    const source = [
      '/**\n * A tag. // not a line comment\n * @param value the // value\n * @returns {string} // x\n */\n',
      'export function echo(value: string): string { return value; }\n',
    ].join('');
    const blanked = codeWithCommentsBlanked(source);
    expect(commentsIn(source)).toHaveLength(1);
    expect(blanked.length).toBe(source.length);
    expect(blanked).not.toContain('*/');
  });

  test('a comment inside a template expression and one at the end of the file are found', () => {
    const source = 'const text = `${/* inside */ 1}`;\n// last line, no newline after it';
    expect(commentsIn(source)).toEqual(['/* inside */', '// last line, no newline after it']);
  });
});
