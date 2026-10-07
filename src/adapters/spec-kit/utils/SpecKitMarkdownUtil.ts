/**
 * The line walk every spec-kit reader shares: the lines a reader sees, HTML comments and fenced code taken out since templates keep their
 * examples there, and the title heading that opens a document, after a YAML frontmatter when the file has one.
 */
import type { MarkdownLine, SpecKitFillState, SpecKitReading } from '../@types/SpecKitReading.ts';
import {
  CODE_FENCE,
  FRONTMATTER_FENCE,
  HTML_COMMENT_CLOSING,
  HTML_COMMENT_OPENING,
  TITLE_HEADING_PREFIX
} from '../constants/SpecKitMarkers.ts';

export interface TitledDocument {
  readonly titleLine: MarkdownLine;
  /** The title heading without its `# `. */
  readonly title:     string;
  readonly fillState: SpecKitFillState;
  /** The lines after the title. */
  readonly lines:     readonly MarkdownLine[];
}

const BYTE_ORDER_MARK       = '﻿';
const CARRIAGE_RETURN       = '\r';
const NULL_CHARACTER        = '\u0000';
const REPLACEMENT_CHARACTER = '�';

function withoutCarriageReturn(line: string): string {
  return line.endsWith(CARRIAGE_RETURN) ? line.slice(0, -1) : line;
}

/** A NUL or an undecodable byte means the file is not the text its name promises. */
function binaryContentLineOf(text: string): number | null {
  const index = text.split('\n').findIndex((line) => line.includes(NULL_CHARACTER) || line.includes(REPLACEMENT_CHARACTER));
  return index === -1 ? null : index + 1;
}

function visibleTextOf(line: string, insideCommentBefore: boolean): { visibleText: string; insideComment: boolean } {
  let visibleText   = '';
  let remainder     = line;
  let insideComment = insideCommentBefore;
  while (remainder !== '') {
    const markIndex = remainder.indexOf(insideComment ? HTML_COMMENT_CLOSING : HTML_COMMENT_OPENING);
    if (markIndex === -1) {
      if (!insideComment) visibleText += remainder;
      break;
    }
    if (!insideComment) visibleText += remainder.slice(0, markIndex);
    remainder     = remainder.slice(markIndex + (insideComment ? HTML_COMMENT_CLOSING : HTML_COMMENT_OPENING).length);
    insideComment = !insideComment;
  }
  return { visibleText, insideComment };
}

function visibleLinesOf(text: string): MarkdownLine[] {
  const withoutByteOrderMark = text.startsWith(BYTE_ORDER_MARK) ? text.slice(BYTE_ORDER_MARK.length) : text;
  const visibleLines: MarkdownLine[] = [];
  let insideComment   = false;
  let insideCodeFence = false;
  withoutByteOrderMark.split('\n').forEach((rawLine, index) => {
    const line = withoutCarriageReturn(rawLine);
    if (!insideComment && line.trimStart().startsWith(CODE_FENCE)) {
      insideCodeFence = !insideCodeFence;
      return;
    }
    if (insideCodeFence) return;
    const visible = visibleTextOf(line, insideComment);
    ({ insideComment } = visible);
    visibleLines.push({ text: visible.visibleText.trimEnd(), line: index + 1 });
  });
  return visibleLines;
}

/** The index of the first line after a frontmatter opening the file, 0 without one; null when its closing fence is missing. */
function indexAfterFrontmatterOf(lines: readonly MarkdownLine[]): number | null {
  const [firstLine] = lines;
  if (firstLine?.line !== 1 || firstLine.text !== FRONTMATTER_FENCE) return 0;
  const closingIndex = lines.findIndex((candidate, index) => index > 0 && candidate.text === FRONTMATTER_FENCE);
  return closingIndex === -1 ? null : closingIndex + 1;
}

/** `templateTitle` is the title line the file's template holds; a file still carrying it is an unfilled copy. */
function titledDocumentOf(text: string, templateTitle: string, frontmatterMayOpen: boolean): SpecKitReading<TitledDocument> {
  const binaryLine = binaryContentLineOf(text);
  if (binaryLine !== null) return { verdict: 'malformed', reason: 'the file holds binary content, not markdown text', line: binaryLine };

  const lines      = visibleLinesOf(text);
  const startIndex = frontmatterMayOpen ? indexAfterFrontmatterOf(lines) : 0;
  if (startIndex === null) return { verdict: 'malformed', reason: 'the frontmatter has no closing `---` fence', line: lines.at(-1)?.line ?? 1 };

  const titleIndex = lines.findIndex((line, index) => index >= startIndex && line.text.startsWith(TITLE_HEADING_PREFIX));
  const titleLine  = lines[titleIndex];
  if (titleLine === undefined) return { verdict: 'malformed', reason: 'the file has no `# ` title heading', line: lines[startIndex]?.line ?? 1 };
  return {
    verdict:  'parsed',
    document: {
      titleLine,
      title:     titleLine.text.slice(TITLE_HEADING_PREFIX.length).trim(),
      fillState: titleLine.text.trim() === templateTitle ? 'template' : 'filled',
      lines:     lines.slice(titleIndex + 1),
    },
  };
}

/** A named group of a match, empty when the group did not take part. */
function capturedTextOf(match: RegExpMatchArray, groupName: string): string {
  return match.groups?.[groupName] ?? '';
}

export const SpecKitMarkdownUtil = {
  binaryContentLineOf, capturedTextOf, titledDocumentOf, visibleLinesOf
} as const;
