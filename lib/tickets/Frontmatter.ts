/**
 * Deliberately not a YAML parser: a ticket is edited by hand between CLI runs, so a rewrite keeps
 * every line the CLI does not own and a file the CLI cannot understand is reported rather than
 * half-applied. The subset it accepts is stated in `lib/tickets/CLAUDE.md`.
 */

import { ticketStatusIsKnown, ticketTypeIsKnown } from '../constants/Statuses.ts';
import type { TicketFrontmatter }                 from '../constants/Types.ts';
import { TicketIdUtil }                           from '../utils/TicketIdUtil.ts';

export type ParsedTicketDocument =
  | { verdict: 'parsed'; frontmatter: TicketFrontmatter; body: string }
  | { verdict: 'malformed'; reason: string; line: number };

type FrontmatterValue = string | number | null;

interface KnownValue {
  value: FrontmatterValue;
  line:  number;
}

const FRONTMATTER_FENCE     = '---';
const KEY_VALUE_SEPARATOR   = ': ';
const BYTE_ORDER_MARK   = '\uFEFF';
const KEY_PATTERN       = /^[A-Za-z][A-Za-z0-9_-]*$/;
const INTEGER_PATTERN   = /^-?\d+$/;
const DIGITS_PATTERN    = /^\d+$/;

const COMMENT_KEY    = '#';
const BLANK_LINE_KEY = '';

const OPTIONAL_TEXT_KEYS = ['group', 'branch', 'commit', 'reason'] as const;

const KNOWN_KEYS = new Set<string>([
  'id',
  'title',
  'type',
  'status',
  'filed',
  'updated',
  'started',
  'finished',
  'delivered',
  'abandonedAt',
  ...OPTIONAL_TEXT_KEYS,
  'task',
]);

class FrontmatterProblem extends Error {
  readonly line: number;

  constructor(reason: string, line: number) {
    super(reason);
    this.name = 'FrontmatterProblem';
    this.line = line;
  }
}

/** The closing fence is the first later line equal to `---`, never the last, because ticket bodies contain horizontal rules. */
export function parseTicketDocument(text: string): ParsedTicketDocument {
  const withoutByteOrderMark = text.startsWith(BYTE_ORDER_MARK) ? text.slice(BYTE_ORDER_MARK.length) : text;
  const lines                = withoutByteOrderMark.split('\n');

  try {
    const closingFenceIndex = closingFenceIndexOf(lines);
    const knownValues       = new Map<string, KnownValue>();
    const extra: Array<[key: string, rawValue: string]> = [];

    for (let index = 1; index < closingFenceIndex; index++) {
      const lineNumber = index + 1;
      const line       = withoutCarriageReturn(lines[index] ?? '');

      if (line.trim() === '') {
        extra.push([BLANK_LINE_KEY, '']);
        continue;
      }
      if (line.trim().startsWith(COMMENT_KEY)) {
        extra.push([COMMENT_KEY, line.trim().slice(1).trim()]);
        continue;
      }

      const [key, rawValue] = keyAndRawValueOf(line, lineNumber);

      if (!KNOWN_KEYS.has(key)) {
        extra.push([key, rawValue]);
        continue;
      }
      knownValues.set(key, { value: scalarOf(rawValue, key, lineNumber), line: lineNumber });
    }

    return {
      verdict:     'parsed',
      frontmatter: frontmatterFrom(knownValues, extra, closingFenceIndex + 1),
      body:        bodyAfter(withoutByteOrderMark, lines, closingFenceIndex),
    };
  } catch (problem) {
    if (problem instanceof FrontmatterProblem) {
      return { verdict: 'malformed', reason: problem.message, line: problem.line };
    }
    throw problem;
  }
}

/** An unknown line is copied back with its raw value untouched, and an absent optional key is omitted rather than written as `null`. */
export function serializeTicketDocument(frontmatter: TicketFrontmatter, body: string): string {
  const lines: string[] = [
    `id: ${JSON.stringify(frontmatter.id)}`,
    `title: ${JSON.stringify(frontmatter.title)}`,
    `type: ${JSON.stringify(frontmatter.type)}`,
    `status: ${JSON.stringify(frontmatter.status)}`,
    `filed: ${JSON.stringify(frontmatter.filed)}`,
    `updated: ${JSON.stringify(frontmatter.updated)}`,
    `started: ${nullableTextLiteral(frontmatter.started)}`,
    `finished: ${nullableTextLiteral(frontmatter.finished)}`,
    `delivered: ${nullableTextLiteral(frontmatter.delivered)}`,
    `abandonedAt: ${nullableTextLiteral(frontmatter.abandonedAt)}`,
  ];

  for (const key of OPTIONAL_TEXT_KEYS) {
    const value = frontmatter[key];
    if (value !== undefined) {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    }
  }

  lines.push(`task: ${frontmatter.task === null ? 'null' : String(frontmatter.task)}`);

  for (const [key, rawValue] of frontmatter.extra) {
    lines.push(extraLineOf(key, rawValue));
  }

  // A CRLF ticket keeps CRLF: the body is preserved byte for byte, so the line ending is read back from it.
  const lineEnding = body.includes('\r\n') ? '\r\n' : '\n';

  return `${[FRONTMATTER_FENCE, ...lines, FRONTMATTER_FENCE].join(lineEnding)}${lineEnding}${body}`;
}

function closingFenceIndexOf(lines: readonly string[]): number {
  if (withoutCarriageReturn(lines[0] ?? '') !== FRONTMATTER_FENCE) {
    throw new FrontmatterProblem('the first line must be the frontmatter fence `---`', 1);
  }
  for (let index = 1; index < lines.length; index++) {
    if (withoutCarriageReturn(lines[index] ?? '') === FRONTMATTER_FENCE) {
      return index;
    }
  }
  const lastWrittenLine = lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
  throw new FrontmatterProblem('the frontmatter has no closing `---` fence', Math.max(lastWrittenLine, 1));
}

/** The body is returned byte for byte from the character after the closing fence's newline. */
function bodyAfter(text: string, lines: readonly string[], closingFenceIndex: number): string {
  let offset = 0;
  for (let index = 0; index <= closingFenceIndex; index++) {
    offset += (lines[index] ?? '').length + 1;
  }
  return text.slice(offset);
}

function withoutCarriageReturn(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

/** Splits at the first `': '`, so `title: Fix: the thing` keeps its second colon; anything that is not a `key: value` line is refused. */
function keyAndRawValueOf(line: string, lineNumber: number): [key: string, rawValue: string] {
  const separatorIndex = line.indexOf(KEY_VALUE_SEPARATOR);
  const key            = separatorIndex > 0 ? line.slice(0, separatorIndex) : line.slice(0, -1);
  const rawValue       = separatorIndex > 0 ? line.slice(separatorIndex + KEY_VALUE_SEPARATOR.length) : '';

  if (separatorIndex <= 0 && !line.endsWith(':')) {
    throw new FrontmatterProblem(`\`${line}\` is not a \`key: value\` line`, lineNumber);
  }
  if (!KEY_PATTERN.test(key)) {
    throw new FrontmatterProblem(`\`${key}\` is not a usable frontmatter key`, lineNumber);
  }
  return [key, rawValue];
}

function scalarOf(rawValue: string, key: string, lineNumber: number): FrontmatterValue {
  if (rawValue === 'null') {
    return null;
  }
  if (INTEGER_PATTERN.test(rawValue)) {
    return Number(rawValue);
  }
  if (rawValue.startsWith('"')) {
    return jsonStringOf(rawValue, key, lineNumber);
  }
  return rawValue;
}

function jsonStringOf(rawValue: string, key: string, lineNumber: number): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    throw new FrontmatterProblem(`\`${key}\` opens a quoted value that does not close: ${rawValue}`, lineNumber);
  }
  if (typeof parsed !== 'string') {
    throw new FrontmatterProblem(`\`${key}\` is quoted but does not hold text`, lineNumber);
  }
  return parsed;
}

function frontmatterFrom(
  knownValues: Map<string, KnownValue>,
  extra: Array<[key: string, rawValue: string]>,
  closingFenceLine: number,
): TicketFrontmatter {
  const typeText   = requiredText(knownValues, 'type', closingFenceLine);
  const statusText = requiredText(knownValues, 'status', closingFenceLine);

  if (!ticketTypeIsKnown(typeText)) {
    throw new FrontmatterProblem(`\`type\` is not a known ticket type: ${typeText}`, lineOf(knownValues, 'type', closingFenceLine));
  }
  if (!ticketStatusIsKnown(statusText)) {
    throw new FrontmatterProblem(`\`status\` is not a known ticket status: ${statusText}`, lineOf(knownValues, 'status', closingFenceLine));
  }

  return {
    id:          identifierFrom(knownValues, closingFenceLine),
    title:       requiredText(knownValues, 'title', closingFenceLine),
    type:        typeText,
    status:      statusText,
    filed:       requiredText(knownValues, 'filed', closingFenceLine),
    updated:     requiredText(knownValues, 'updated', closingFenceLine),
    started:     nullableText(knownValues, 'started'),
    finished:    nullableText(knownValues, 'finished'),
    delivered:   nullableText(knownValues, 'delivered'),
    abandonedAt: nullableText(knownValues, 'abandonedAt'),
    ...optionalTextFields(knownValues),
    task:        nullableInteger(knownValues, 'task'),
    extra,
  };
}

/** The id is stored padded however it was written, so `id: 003`, `id: "003"` and `id: 3` name the same ticket. */
function identifierFrom(knownValues: Map<string, KnownValue>, closingFenceLine: number): string {
  const text = requiredText(knownValues, 'id', closingFenceLine);
  if (!DIGITS_PATTERN.test(text)) {
    throw new FrontmatterProblem(`\`id\` is not a ticket number: ${text}`, lineOf(knownValues, 'id', closingFenceLine));
  }
  return TicketIdUtil.padTicketId(Number(text));
}

function optionalTextFields(knownValues: Map<string, KnownValue>): Pick<TicketFrontmatter, 'group' | 'branch' | 'commit' | 'reason'> {
  const fields: Pick<TicketFrontmatter, 'group' | 'branch' | 'commit' | 'reason'> = {};

  for (const key of OPTIONAL_TEXT_KEYS) {
    const found = knownValues.get(key);
    // `group: null` reads as "no group", the same as the key being absent.
    if (found !== undefined && found.value !== null) {
      fields[key] = textOf(found, key);
    }
  }
  return fields;
}

function requiredText(knownValues: Map<string, KnownValue>, key: string, closingFenceLine: number): string {
  const found = knownValues.get(key);
  if (found === undefined) {
    throw new FrontmatterProblem(`the frontmatter has no \`${key}\` key`, closingFenceLine);
  }
  return textOf(found, key);
}

function nullableText(knownValues: Map<string, KnownValue>, key: string): string | null {
  const found = knownValues.get(key);
  if (found === undefined || found.value === null) {
    return null;
  }
  return textOf(found, key);
}

function nullableInteger(knownValues: Map<string, KnownValue>, key: string): number | null {
  const found = knownValues.get(key);
  if (found === undefined || found.value === null) {
    return null;
  }
  if (typeof found.value !== 'number') {
    throw new FrontmatterProblem(`\`${key}\` is not a whole number: ${found.value}`, found.line);
  }
  return found.value;
}

function textOf(found: KnownValue, key: string): string {
  if (found.value === null) {
    throw new FrontmatterProblem(`\`${key}\` may not be null`, found.line);
  }
  return String(found.value);
}

function lineOf(knownValues: Map<string, KnownValue>, key: string, closingFenceLine: number): number {
  return knownValues.get(key)?.line ?? closingFenceLine;
}

function nullableTextLiteral(value: string | null): string {
  return value === null ? 'null' : JSON.stringify(value);
}

function extraLineOf(key: string, rawValue: string): string {
  if (key === BLANK_LINE_KEY) {
    return '';
  }
  if (key === COMMENT_KEY) {
    return rawValue === '' ? COMMENT_KEY : `${COMMENT_KEY} ${rawValue}`;
  }
  return rawValue === '' ? `${key}:` : `${key}: ${rawValue}`;
}
