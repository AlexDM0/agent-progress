/**
 * A ticket's or an epic's markdown body replaced or appended to. The new text is written in the line ending the body already uses, so an
 * edit never leaves a file with two.
 */
import type { LineEnding } from '../@types/Ticket.ts';

export interface MarkdownBodyEdit {
  text:    string;
  appends: boolean;
}

const CARRIAGE_RETURN_LINE_ENDING: LineEnding = '\r\n';
const LINE_FEED: LineEnding                   = '\n';
const ANY_LINE_ENDING_PATTERN                 = /\r?\n/g;

/** The body's own first line ending decides; a body holding none takes the frontmatter's. */
function lineEndingOfBody(document: { body: string; lineEnding?: LineEnding }): LineEnding {
  const firstLineFeedIndex = document.body.indexOf(LINE_FEED);
  if (firstLineFeedIndex === -1) return document.lineEnding ?? LINE_FEED;
  return document.body[firstLineFeedIndex - 1] === '\r' ? CARRIAGE_RETURN_LINE_ENDING : LINE_FEED;
}

function appendedBodyOf(body: string, appendedText: string, lineEnding: LineEnding): string {
  if (appendedText === '') return body;
  if (body === '' || body.endsWith(LINE_FEED)) return `${body}${appendedText}`;
  return `${body}${lineEnding}${appendedText}`;
}

/** An append puts one line ending before the text when the body does not already end in one. */
function editedBodyOf(document: { body: string; lineEnding?: LineEnding }, edit: MarkdownBodyEdit): string {
  const lineEnding = lineEndingOfBody(document);
  const text       = edit.text.replace(ANY_LINE_ENDING_PATTERN, lineEnding);
  return edit.appends ? appendedBodyOf(document.body, text, lineEnding) : text;
}

export const MarkdownBodyUtil = { editedBodyOf } as const;
