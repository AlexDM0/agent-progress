/**
 * The tickets directory as a store. Nothing here throws because a ticket file is bad: a malformed
 * file is a listing entry and a `null`, so one broken file cannot take down `status` or `render`.
 */

import {
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  Ticket,
  TicketFrontmatter,
  TicketPriority,
  TicketType
}                                                       from '../constants/Types.ts';
import { writeFileAtomically }                          from '../platform/AtomicFile.ts';
import type { Workspace }                               from '../platform/Workspace.ts';
import { SlugUtil }                                     from '../utils/SlugUtil.ts';
import { TicketIdUtil }                                 from '../utils/TicketIdUtil.ts';
import { parseTicketDocument, serializeTicketDocument } from './Frontmatter.ts';

export interface MalformedTicketFile {
  filePath: string;
  reason:   string;
  line:     number;
}

export interface TicketListing {
  verdict:   'listed';
  tickets:   Ticket[];
  malformed: MalformedTicketFile[];
}

export interface CreateTicketInput {
  title:     string;
  type:      TicketType;
  /** Written only when given, so a ticket filed without one reads as normal exactly like a ticket filed before priorities existed. */
  priority?: TicketPriority;
  group?:    string;
  /** Given the id this store assigns, so a body that names its own ticket cannot name another. */
  bodyFor:   (ticketId: string) => string;
  /** The timestamp the ticket records as both `filed` and `updated`; the caller owns the clock. */
  at:        string;
}

const TICKET_FILE_EXTENSION      = '.md';
const IDENTIFIER_PREFIX_MATCH    = /^(\d+)-/;
const FILE_NAME_IDENTIFIER_MATCH = /^(\d+)(?:-|\.md$)/;
const IDENTIFIER_LINE_MATCH      = /^id:/;

/**
 * A ticket is known by its frontmatter `id`. A file whose name carries another number, and every file holding an id another
 * also holds, is listed as malformed with its reason, since which of them is the ticket cannot be judged. Ordered by id numerically.
 */
export function listTickets(workspace: Workspace): TicketListing {
  const parsedFiles: ParsedTicketFile[]  = [];
  const malformed: MalformedTicketFile[] = [];

  for (const fileName of ticketFileNamesIn(workspace)) {
    const filePath = join(workspace.ticketsDirectory, fileName);
    const ticket   = ticketAt(filePath);

    if (ticket.verdict === 'parsed') {
      parsedFiles.push({ fileName, ticket: ticket.ticket, identifierLine: ticket.identifierLine });
    } else {
      malformed.push({ filePath, reason: ticket.reason, line: ticket.line });
    }
  }

  const namedConsistently: ParsedTicketFile[] = [];
  for (const parsedFile of parsedFiles) {
    const identifierInName = identifierInFileName(parsedFile.fileName);
    const { id }           = parsedFile.ticket.frontmatter;

    if (identifierInName !== null && identifierInName !== id) {
      malformed.push(malformedEntryOf(parsedFile, `the file name says #${identifierInName} but its \`id\` is ${id}`));
    } else {
      namedConsistently.push(parsedFile);
    }
  }

  const tickets: Ticket[] = [];
  for (const parsedFile of namedConsistently) {
    const otherHolders = namedConsistently.filter((other) => other !== parsedFile && other.ticket.frontmatter.id === parsedFile.ticket.frontmatter.id);

    if (otherHolders.length > 0) {
      const otherFileNames = otherHolders.map((other) => other.fileName).join(', ');
      malformed.push(malformedEntryOf(parsedFile, `ticket #${parsedFile.ticket.frontmatter.id} is also held by ${otherFileNames}`));
    } else {
      tickets.push(parsedFile.ticket);
    }
  }

  tickets.sort((a, b) => Number(a.frontmatter.id) - Number(b.frontmatter.id));
  malformed.sort((a, b) => (a.filePath < b.filePath ? -1 : Number(a.filePath > b.filePath)));
  return { verdict: 'listed', tickets, malformed };
}

/** Looked up by frontmatter `id`, never by file name; a ticket `listTickets` reports as malformed answers for no id. */
export function readTicket(workspace: Workspace, reference: string): Ticket | null {
  const identifier = TicketIdUtil.parseTicketReference(reference);
  if (identifier === null) {
    return null;
  }
  return listTickets(workspace).tickets.find((ticket) => ticket.frontmatter.id === identifier) ?? null;
}

/** Writes through `lib/platform/AtomicFile.ts` and never touches `updated`; only `lib/tickets/TicketTransitions.ts` knows that a ticket changed. */
export function writeTicket(ticket: Ticket): void {
  // The directory is recreated rather than assumed: `clear --all` may have removed it.
  mkdirSync(dirname(ticket.filePath), { recursive: true });
  writeFileAtomically(ticket.filePath, serializeTicketDocument(ticket.frontmatter, ticket.body, ticket.lineEnding));
}

/**
 * One past the highest of every file name's number, every parsed frontmatter `id` and every `ticket` a row in the progress file
 * names, so neither a malformed file, a file renamed by hand nor a row whose ticket file was never written has its id issued again.
 * Gaps are tolerated and never filled.
 */
export function nextTicketId(workspace: Workspace): string {
  let highest = 0;
  const spend = (identifier: string | null): void => {
    if (identifier !== null) highest = Math.max(highest, Number(identifier));
  };

  for (const fileName of ticketFileNamesIn(workspace)) {
    spend(identifierInFileName(fileName));
    const ticket = ticketAt(join(workspace.ticketsDirectory, fileName));
    if (ticket.verdict === 'parsed') spend(ticket.ticket.frontmatter.id);
  }
  for (const identifier of ticketIdsNamedByTaskRows(workspace)) {
    spend(identifier);
  }
  return TicketIdUtil.padTicketId(highest + 1);
}

/** Writes nothing: the caller holds the lock and writes the ticket after the progress file, so the id it assigns is only safe to use inside that hold. */
export function createTicket(workspace: Workspace, input: CreateTicketInput): Ticket {
  const identifier  = nextTicketId(workspace);
  const fileName    = `${identifier}-${unusedSlugFor(workspace, SlugUtil.slugFromTitle(input.title))}${TICKET_FILE_EXTENSION}`;
  const frontmatter: TicketFrontmatter = {
    id:          identifier,
    title:       input.title,
    type:        input.type,
    ...(input.priority === undefined ? {} : { priority: input.priority }),
    status:      'open',
    filed:       input.at,
    updated:     input.at,
    started:     null,
    finished:    null,
    delivered:   null,
    abandonedAt: null,
    ...(input.group === undefined ? {} : { group: input.group }),
    task:        null,
    extra:       [],
  };
  return { frontmatter, body: input.bodyFor(identifier), filePath: join(workspace.ticketsDirectory, fileName) };
}

export function deleteAllTickets(workspace: Workspace): number {
  let removed = 0;

  for (const fileName of ticketFileNamesIn(workspace)) {
    unlinkSync(join(workspace.ticketsDirectory, fileName));
    removed++;
  }
  return removed;
}

type TicketAtPath =
  | { verdict: 'parsed'; ticket: Ticket; identifierLine: number }
  | { verdict: 'malformed'; reason: string; line: number };

interface ParsedTicketFile {
  fileName:       string;
  ticket:         Ticket;
  identifierLine: number;
}

function ticketAt(filePath: string): TicketAtPath {
  let text: string;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (problem) {
    return { verdict: 'malformed', reason: `the file could not be read: ${String(problem)}`, line: 0 };
  }

  const parsed = parseTicketDocument(text);
  if (parsed.verdict === 'malformed') {
    return parsed;
  }
  const ticket: Ticket = {
    frontmatter: parsed.frontmatter,
    body:        parsed.body,
    filePath,
    lineEnding:  parsed.lineEnding,
  };
  return { verdict: 'parsed', ticket, identifierLine: text.split('\n').findIndex((line) => IDENTIFIER_LINE_MATCH.test(line)) + 1 };
}

function malformedEntryOf(parsedFile: ParsedTicketFile, reason: string): MalformedTicketFile {
  return { filePath: parsedFile.ticket.filePath, reason, line: parsedFile.identifierLine };
}

/** `012-slug.md` and `012.md` carry a number; any other name carries none, and a number no ticket could have counts as none. */
function identifierInFileName(fileName: string): string | null {
  const found = FILE_NAME_IDENTIFIER_MATCH.exec(fileName);
  return found === null ? null : TicketIdUtil.parseTicketReference(found[1] ?? '');
}

/**
 * Read as raw JSON rather than through the progress store, which is a sibling feature. A file that is absent or will not parse
 * names nothing: every command that files a ticket has already refused an unreadable progress file before it gets here.
 */
function ticketIdsNamedByTaskRows(workspace: Workspace): string[] {
  let document: unknown;
  try {
    document = JSON.parse(readFileSync(workspace.progressFilePath, 'utf8'));
  } catch {
    return [];
  }
  if (typeof document !== 'object' || document === null || !('tasks' in document) || !Array.isArray(document.tasks)) {
    return [];
  }

  const identifiers: string[] = [];
  for (const task of document.tasks as unknown[]) {
    if (typeof task === 'object' && task !== null && 'ticket' in task && typeof task.ticket === 'string') {
      const identifier = TicketIdUtil.parseTicketReference(task.ticket);
      if (identifier !== null) identifiers.push(identifier);
    }
  }
  return identifiers;
}

/** A missing tickets directory reads as "no tickets" rather than as a failure. */
function ticketFileNamesIn(workspace: Workspace): string[] {
  let entries: string[];
  try {
    entries = readdirSync(workspace.ticketsDirectory);
  } catch {
    return [];
  }
  return entries.filter((entry) => entry.endsWith(TICKET_FILE_EXTENSION)).sort();
}

/** The id already makes the path unique, so the `-2` suffix buys readability, not collision safety. */
function unusedSlugFor(workspace: Workspace, slug: string): string {
  const takenSlugs = new Set(ticketFileNamesIn(workspace).map(slugPortionOf));
  let candidate    = slug;
  let attempt      = 2;

  while (takenSlugs.has(candidate)) {
    candidate = `${slug}-${attempt}`;
    attempt++;
  }
  return candidate;
}

function slugPortionOf(fileName: string): string {
  return fileName.slice(0, -TICKET_FILE_EXTENSION.length).replace(IDENTIFIER_PREFIX_MATCH, '');
}
