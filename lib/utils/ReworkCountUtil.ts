/**
 * Reads unified diff text as `git log -p` and `git diff` print it and says which changed lines are code, for
 * `agent-progress rework`. Every changed line is classified in the context of its own side of its hunk: the
 * old side is the context and removed lines, the new side the context and added lines.
 */
import type { CommentSyntax, DelimiterPair, EmbeddedLanguage } from '../constants/CommentSyntaxes';
import {
  COMMENT_SYNTAX_BY_EXTENSION,
  COMMENT_SYNTAX_BY_FILE_NAME,
  DOCUMENTATION_DIRECTORY_PREFIX,
  DOCUMENTATION_EXTENSIONS
} from '../constants/CommentSyntaxes';

export type LineKind = 'code' | 'comment' | 'blank' | 'documentation';

export type ChangedLineSide = 'added' | 'removed';

export interface ClassifiedChangedLine {
  side: ChangedLineSide;
  text: string;
  kind: LineKind;
}

export interface FileChangedLines {
  path:  string;
  lines: ClassifiedChangedLine[];
}

export interface FileRework {
  path:               string;
  addedCodeLines:     number;
  removedCodeLines:   number;
  commentLines:       number;
  blankLines:         number;
  documentationLines: number;
}

export interface ReworkTotals {
  reworkedCodeLines:  number;
  addedCodeLines:     number;
  removedCodeLines:   number;
  commentLines:       number;
  blankLines:         number;
  documentationLines: number;
}

interface OpenRegion {
  pair:         DelimiterPair;
  holdsComment: boolean;
}

/**
 * One side of one hunk. A hunk may begin inside a block comment, which nothing before the hunk says; until a
 * delimiter settles the state, the lines read are kept so that a closing delimiter with no opening before it
 * can turn them into the comment they were.
 */
interface SideState {
  hostSyntax:            CommentSyntax;
  syntax:                CommentSyntax;
  embeddedLanguage:      EmbeddedLanguage | null;
  openRegion:            OpenRegion | null;
  regionStateIsKnown:    boolean;
  linesBeforeStateKnown: ClassifiedChangedLine[];
}

interface LineLexing {
  kind:                       'code' | 'comment' | 'blank';
  closedARegionOpenedEarlier: boolean;
}

interface HunkInProgress {
  remainingOldLines: number;
  remainingNewLines: number;
  oldSide:           SideState | null;
  newSide:           SideState | null;
  file:              FileChangedLines;
  isDocumentation:   boolean;
}

const HUNK_HEADER = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/;

const OMITTED_HUNK_LENGTH = 1;

const OCTAL_RADIX = 8;

const NULL_DEVICE_PATH = '/dev/null';

const GIT_PATH_PREFIXES = ['a/', 'b/'];

const TAG_NAME_CONTINUATION = /[A-Za-z0-9-]/;

function lastPathSegmentOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function extensionOf(path: string): string {
  const fileName = lastPathSegmentOf(path);
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex <= 0 ? '' : fileName.slice(dotIndex + 1).toLowerCase();
}

function pathIsDocumentation(path: string): boolean {
  return path.startsWith(DOCUMENTATION_DIRECTORY_PREFIX) || DOCUMENTATION_EXTENSIONS.includes(extensionOf(path));
}

/** `null` for a file type nobody listed, whose every non-blank line then counts as code: an unknown type must not be a way under a threshold. */
function commentSyntaxFor(path: string): CommentSyntax | null {
  const fileName = lastPathSegmentOf(path);
  if (Object.hasOwn(COMMENT_SYNTAX_BY_FILE_NAME, fileName)) return COMMENT_SYNTAX_BY_FILE_NAME[fileName] ?? null;
  const extension = extensionOf(path);
  if (extension !== '' && Object.hasOwn(COMMENT_SYNTAX_BY_EXTENSION, extension)) return COMMENT_SYNTAX_BY_EXTENSION[extension] ?? null;
  return null;
}

function createSideState(syntax: CommentSyntax, regionStateIsKnown: boolean): SideState {
  return {
    hostSyntax:            syntax,
    syntax,
    embeddedLanguage:      null,
    openRegion:            null,
    regionStateIsKnown,
    linesBeforeStateKnown: [],
  };
}

function tagStartsAt(text: string, position: number, tag: string): boolean {
  if (text.slice(position, position + tag.length).toLowerCase() !== tag) return false;
  const following = text[position + tag.length];
  return following === undefined || !TAG_NAME_CONTINUATION.test(following);
}

function pairOpeningAt(pairs: readonly DelimiterPair[], text: string, position: number): DelimiterPair | undefined {
  return pairs.find((pair) => text.startsWith(pair.opening, position));
}

/** The index just past the closing quote, or the end of the line: a string that does not close on its line ends there. */
function endOfQuotedString(text: string, afterOpeningQuote: number, quote: string): number {
  for (let i = afterOpeningQuote; i < text.length; i++) {
    if (text[i] === '\\') {
      i++;
      continue;
    }
    if (text[i] === quote) return i + 1;
  }
  return text.length;
}

function closingIndexOf(text: string, from: number, region: OpenRegion): number {
  if (region.holdsComment) return text.indexOf(region.pair.closing, from);
  for (let i = from; i < text.length; i++) {
    if (text[i] === '\\') {
      i++;
      continue;
    }
    if (text.startsWith(region.pair.closing, i)) return i;
  }
  return -1;
}

function asymmetricBlockComments(syntax: CommentSyntax): DelimiterPair[] {
  return syntax.blockComments.filter((pair) => pair.opening !== pair.closing);
}

function earliestClosingIndex(text: string, from: number, syntax: CommentSyntax): number {
  const indexes = asymmetricBlockComments(syntax)
    .map((pair) => text.indexOf(pair.closing, from))
    .filter((index) => index !== -1);
  return indexes.length === 0 ? -1 : Math.min(...indexes);
}

/**
 * Classifies one line and moves the side's state past it. A line holding any code outside a comment is
 * code, a trailing comment included; a line holding nothing but comment is a comment.
 */
function lexLine(text: string, state: SideState): LineLexing {
  const firstNonBlankIndex = text.search(/\S/);
  if (firstNonBlankIndex === -1) return { kind: 'blank', closedARegionOpenedEarlier: false };

  let lineHoldsCode              = false;
  let closedARegionOpenedEarlier = false;
  let position                   = firstNonBlankIndex;

  while (position < text.length) {
    const region = state.openRegion;
    if (region !== null) {
      if (!region.holdsComment) lineHoldsCode = true;
      const closingIndex = closingIndexOf(text, position, region);
      if (closingIndex === -1) break;
      state.openRegion = null;
      position = closingIndex + region.pair.closing.length;
      continue;
    }

    if (/\s/.test(text[position] ?? '')) {
      position++;
      continue;
    }

    const { syntax, embeddedLanguage } = state;
    if (embeddedLanguage !== null && tagStartsAt(text, position, embeddedLanguage.closingTag)) {
      state.syntax           = state.hostSyntax;
      state.embeddedLanguage = null;
      lineHoldsCode          = true;
      position += embeddedLanguage.closingTag.length;
      continue;
    }

    const lineStartComment = position === firstNonBlankIndex ? pairOpeningAt(syntax.lineStartBlockComments, text, position) : undefined;
    const blockComment     = lineStartComment ?? pairOpeningAt(syntax.blockComments, text, position);
    if (blockComment !== undefined) {
      state.openRegion         = { pair: blockComment, holdsComment: true };
      state.regionStateIsKnown = true;
      position += blockComment.opening.length;
      continue;
    }

    if (syntax.lineCommentMarkers.some((marker) => text.startsWith(marker, position))) {
      // Inside a comment the hunk began in, `// x */` is comment text followed by the comment's end.
      const laterOrphanClosing = state.regionStateIsKnown ? -1 : earliestClosingIndex(text, position, syntax);
      if (laterOrphanClosing === -1) break;
      position = laterOrphanClosing;
      continue;
    }

    const multiLineString = pairOpeningAt(syntax.multiLineStrings, text, position);
    if (multiLineString !== undefined) {
      state.openRegion         = { pair: multiLineString, holdsComment: false };
      state.regionStateIsKnown = true;
      lineHoldsCode            = true;
      position += multiLineString.opening.length;
      continue;
    }

    // A closing delimiter nobody opened in this hunk means the hunk began inside that comment: all before it was comment text.
    const orphanClosing = state.regionStateIsKnown
      ? undefined
      : asymmetricBlockComments(syntax).find((pair) => text.startsWith(pair.closing, position));
    if (orphanClosing !== undefined) {
      state.regionStateIsKnown   = true;
      closedARegionOpenedEarlier = true;
      lineHoldsCode              = false;
      position += orphanClosing.closing.length;
      continue;
    }

    const enteredLanguage = syntax.embeddedLanguages.find((embedded) => tagStartsAt(text, position, embedded.openingTag));
    if (enteredLanguage !== undefined) {
      state.syntax           = enteredLanguage.syntax;
      state.embeddedLanguage = enteredLanguage;
      lineHoldsCode          = true;
      position += enteredLanguage.openingTag.length;
      continue;
    }

    lineHoldsCode = true;
    const character = text[position] ?? '';
    position = syntax.stringQuotes.includes(character) ? endOfQuotedString(text, position + 1, character) : position + 1;
  }

  return { kind: lineHoldsCode ? 'code' : 'comment', closedARegionOpenedEarlier };
}

/** A context line passes `null` for the changed line: it moves the state and is counted nowhere. */
function readLineOnSide(text: string, state: SideState, changedLine: ClassifiedChangedLine | null): void {
  const lexing = lexLine(text, state);
  if (changedLine !== null) changedLine.kind = lexing.kind;

  if (lexing.closedARegionOpenedEarlier) {
    for (const earlierLine of state.linesBeforeStateKnown) {
      if (earlierLine.kind !== 'blank') earlierLine.kind = 'comment';
    }
  }
  if (state.regionStateIsKnown) {
    state.linesBeforeStateKnown = [];
    return;
  }
  if (changedLine !== null) state.linesBeforeStateKnown.push(changedLine);
}

/** Whole-file classification, for a file read from its first line: no state is unknown there, so nothing is inferred. */
function classifyFileLines(path: string, fileText: string): LineKind[] {
  const lines = fileText.split('\n');
  if (pathIsDocumentation(path)) return lines.map(() => 'documentation');
  const syntax = commentSyntaxFor(path);
  if (syntax === null) return lines.map((line) => (line.trim() === '' ? 'blank' : 'code'));
  const state = createSideState(syntax, true);
  return lines.map((line) => lexLine(line, state).kind);
}

/** A path git quoted because it holds a quote, a backslash or a control character, with its octal escapes decoded as the UTF-8 bytes they are. */
function unquotedGitPath(quoted: string): string {
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  const inner = quoted.slice(1, -1);
  const namedEscapes: Record<string, string> = {
    'n':  '\n',
    't':  '\t',
    '"':  '"',
    '\\': '\\',
  };
  for (let i = 0; i < inner.length; i++) {
    const character = inner[i] ?? '';
    if (character !== '\\') {
      bytes.push(...encoder.encode(character));
      continue;
    }
    const octalDigits = /^[0-7]{3}/.exec(inner.slice(i + 1));
    if (octalDigits !== null) {
      bytes.push(Number.parseInt(octalDigits[0], OCTAL_RADIX));
      i += octalDigits[0].length;
      continue;
    }
    const escaped = inner[i + 1] ?? '';
    bytes.push(...encoder.encode(Object.hasOwn(namedEscapes, escaped) ? namedEscapes[escaped] ?? escaped : escaped));
    i++;
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/** git ends a `---`/`+++` path holding a space with a tab, and quotes one holding stranger characters. */
function pathFromFileHeader(headerValue: string): string | null {
  const withoutTab = headerValue.endsWith('\t') ? headerValue.slice(0, -1) : headerValue;
  if (withoutTab === NULL_DEVICE_PATH) return null;
  const unquoted = withoutTab.startsWith('"') && withoutTab.endsWith('"') && withoutTab.length > 1 ? unquotedGitPath(withoutTab) : withoutTab;
  const prefix = GIT_PATH_PREFIXES.find((candidate) => unquoted.startsWith(candidate));
  return prefix === undefined ? unquoted : unquoted.slice(prefix.length);
}

function recordChangedLine(hunk: HunkInProgress, side: ChangedLineSide, text: string, state: SideState | null): void {
  const changedLine: ClassifiedChangedLine = { side, text, kind: 'code' };
  hunk.file.lines.push(changedLine);
  if (hunk.isDocumentation) {
    changedLine.kind = 'documentation';
    return;
  }
  if (state === null) {
    changedLine.kind = text.trim() === '' ? 'blank' : 'code';
    return;
  }
  readLineOnSide(text, state, changedLine);
}

/** `false` for a line that cannot belong to a hunk, which ends it: the header counts were wrong, and the parser recovers at the next header. */
function readHunkLine(line: string, hunk: HunkInProgress): boolean {
  // An empty line is a blank context line written by a git configured with `diff.suppressBlankEmpty`.
  const marker = line.length === 0 ? ' ' : line[0];
  const text   = line.slice(1);
  if (marker === '+') {
    hunk.remainingNewLines--;
    recordChangedLine(hunk, 'added', text, hunk.newSide);
    return true;
  }
  if (marker === '-') {
    hunk.remainingOldLines--;
    recordChangedLine(hunk, 'removed', text, hunk.oldSide);
    return true;
  }
  if (marker === ' ') {
    hunk.remainingOldLines--;
    hunk.remainingNewLines--;
    if (hunk.oldSide !== null) readLineOnSide(text, hunk.oldSide, null);
    if (hunk.newSide !== null) readLineOnSide(text, hunk.newSide, null);
    return true;
  }
  return false;
}

/**
 * Every changed line of a diff, grouped per file and classified. Hunk lengths are read from each `@@` header
 * and counted down, so a removed line that reads `--- x` or an added one reading `+++ y` is content, not a
 * file header. Files come back in the order the diff first names them, a file named twice as one entry.
 */
function readDiff(diffText: string): FileChangedLines[] {
  const filesByPath = new Map<string, FileChangedLines>();
  let oldPath: string | null = null;
  let newPath: string | null = null;
  let hunk: HunkInProgress | null = null;

  for (const line of diffText.split('\n')) {
    if (hunk !== null && (hunk.remainingOldLines > 0 || hunk.remainingNewLines > 0)) {
      if (line.startsWith('\\')) continue;
      if (readHunkLine(line, hunk)) continue;
    }
    hunk = null;

    if (line.startsWith('diff ')) {
      oldPath = null;
      newPath = null;
      continue;
    }
    if (line.startsWith('--- ')) {
      oldPath = pathFromFileHeader(line.slice('--- '.length));
      continue;
    }
    if (line.startsWith('+++ ')) {
      newPath = pathFromFileHeader(line.slice('+++ '.length));
      continue;
    }

    const header = HUNK_HEADER.exec(line);
    const path   = newPath ?? oldPath;
    if (header === null || path === null) continue;

    const file = filesByPath.get(path) ?? { path, lines: [] };
    filesByPath.set(path, file);
    const isDocumentation = pathIsDocumentation(path);
    const syntax          = isDocumentation ? null : commentSyntaxFor(path);
    hunk = {
      remainingOldLines: header[1] === undefined ? OMITTED_HUNK_LENGTH : Number(header[1]),
      remainingNewLines: header[2] === undefined ? OMITTED_HUNK_LENGTH : Number(header[2]),
      oldSide:           syntax === null ? null : createSideState(syntax, false),
      newSide:           syntax === null ? null : createSideState(syntax, false),
      file,
      isDocumentation,
    };
  }
  return [...filesByPath.values()];
}

function changedLineKey(line: ClassifiedChangedLine): string {
  return `${line.side === 'added' ? '+' : '-'}${line.text}`;
}

/** The lines of `from` left once each line of `against` has cancelled one identical line, same side and same text. */
function linesNotMatchedIn(from: readonly ClassifiedChangedLine[], against: readonly ClassifiedChangedLine[]): ClassifiedChangedLine[] {
  const unmatchedCounts = new Map<string, number>();
  for (const line of against) {
    const key = changedLineKey(line);
    unmatchedCounts.set(key, (unmatchedCounts.get(key) ?? 0) + 1);
  }
  const leftOver: ClassifiedChangedLine[] = [];
  for (const line of from) {
    const key       = changedLineKey(line);
    const available = unmatchedCounts.get(key) ?? 0;
    if (available > 0) {
      unmatchedCounts.set(key, available - 1);
      continue;
    }
    leftOver.push(line);
  }
  return leftOver;
}

/**
 * The interdiff of two patches of the same work: per file, the added lines one patch holds and the other does not,
 * as a multiset of text. Removed lines are left out because they differ whenever the main line changed a line the
 * branch replaced, which is the base moving rather than rework; a line resolved by hand counts 2, as in a commit.
 */
function addedLinesInOnlyOne(before: readonly FileChangedLines[], after: readonly FileChangedLines[]): FileChangedLines[] {
  const addedLinesOf = (file: FileChangedLines): ClassifiedChangedLine[] => file.lines.filter((line) => line.side === 'added');
  const beforeByPath = new Map(before.map((file) => [file.path, addedLinesOf(file)]));
  const afterByPath  = new Map(after.map((file) => [file.path, addedLinesOf(file)]));
  const paths        = [...new Set([...beforeByPath.keys(), ...afterByPath.keys()])];
  return paths
    .map((path) => {
      const beforeLines = beforeByPath.get(path) ?? [];
      const afterLines  = afterByPath.get(path) ?? [];
      return { path, lines: [...linesNotMatchedIn(beforeLines, afterLines), ...linesNotMatchedIn(afterLines, beforeLines)] };
    })
    .filter((file) => file.lines.length > 0);
}

function reworkOfFile(file: FileChangedLines): FileRework {
  const rework: FileRework = {
    path:               file.path,
    addedCodeLines:     0,
    removedCodeLines:   0,
    commentLines:       0,
    blankLines:         0,
    documentationLines: 0,
  };
  for (const line of file.lines) {
    if (line.kind === 'code' && line.side === 'added') rework.addedCodeLines++;
    if (line.kind === 'code' && line.side === 'removed') rework.removedCodeLines++;
    if (line.kind === 'comment') rework.commentLines++;
    if (line.kind === 'blank') rework.blankLines++;
    if (line.kind === 'documentation') rework.documentationLines++;
  }
  return rework;
}

/** One entry per path across every list, sorted by path, so two runs over the same history print the same breakdown. */
function combineFileReworks(reworkLists: readonly (readonly FileRework[])[]): FileRework[] {
  const combinedByPath = new Map<string, FileRework>();
  for (const rework of reworkLists.flat()) {
    const combined = combinedByPath.get(rework.path);
    if (combined === undefined) {
      combinedByPath.set(rework.path, { ...rework });
      continue;
    }
    combined.addedCodeLines += rework.addedCodeLines;
    combined.removedCodeLines += rework.removedCodeLines;
    combined.commentLines += rework.commentLines;
    combined.blankLines += rework.blankLines;
    combined.documentationLines += rework.documentationLines;
  }
  return [...combinedByPath.values()].sort((a, b) => (a.path < b.path ? -1 : Number(a.path > b.path)));
}

function totalReworkOf(files: readonly FileRework[]): ReworkTotals {
  const totals: ReworkTotals = {
    reworkedCodeLines:  0,
    addedCodeLines:     0,
    removedCodeLines:   0,
    commentLines:       0,
    blankLines:         0,
    documentationLines: 0,
  };
  for (const file of files) {
    totals.addedCodeLines += file.addedCodeLines;
    totals.removedCodeLines += file.removedCodeLines;
    totals.commentLines += file.commentLines;
    totals.blankLines += file.blankLines;
    totals.documentationLines += file.documentationLines;
  }
  totals.reworkedCodeLines = totals.addedCodeLines + totals.removedCodeLines;
  return totals;
}

export const ReworkCountUtil = {
  pathIsDocumentation,
  commentSyntaxFor,
  classifyFileLines,
  readDiff,
  addedLinesInOnlyOne,
  reworkOfFile,
  combineFileReworks,
  totalReworkOf,
} as const;
