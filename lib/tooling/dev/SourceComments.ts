/**
 * The comments of a TypeScript source, found by the TypeScript scanner rather than a pattern, so that a `/*` or `//` inside a string, a
 * template or a regular expression literal opens no comment. Shared by the guard specs that scan the tree for text.
 */
import ts from 'typescript';

interface CommentSpan {
  start: number;
  end:   number;
}

function commentSpansIn(fileContents: string): CommentSpan[] {
  const sourceFile = ts.createSourceFile('scanned.ts', fileContents, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const spansByStart = new Map<number, CommentSpan>();
  const record = (ranges: ts.CommentRange[] | undefined): void => {
    for (const range of ranges ?? []) spansByStart.set(range.pos, { start: range.pos, end: range.end });
  };
  // Every comment is trivia before or after some token, and getChildren reaches every token, the end-of-file one included.
  // A docblock's own parsed children sit inside the comment, where a `//` in its prose would read as a comment nested in it.
  const visit = (node: ts.Node): void => {
    if (ts.isJSDoc(node)) return;
    record(ts.getLeadingCommentRanges(fileContents, node.pos));
    record(ts.getTrailingCommentRanges(fileContents, node.end));
    for (const child of node.getChildren(sourceFile)) visit(child);
  };
  visit(sourceFile);
  return [...spansByStart.values()].sort((a, b) => a.start - b.start);
}

/** Blanked character for character, newlines kept, so what is left is still the file's own code and a match's line number is its own. */
export function codeWithCommentsBlanked(fileContents: string): string {
  let code = '';
  let copiedUpTo = 0;
  for (const span of commentSpansIn(fileContents)) {
    code += fileContents.slice(copiedUpTo, span.start) + fileContents.slice(span.start, span.end).replace(/[^\n]/g, ' ');
    copiedUpTo = span.end;
  }
  return code + fileContents.slice(copiedUpTo);
}

export function commentsIn(fileContents: string): string[] {
  return commentSpansIn(fileContents).map((span) => fileContents.slice(span.start, span.end));
}
