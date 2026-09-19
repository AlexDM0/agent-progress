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
import { join }                                         from 'node:path';
import type { Ticket, TicketFrontmatter, TicketType }   from '../constants/Types.ts';
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
  title:  string;
  type:   TicketType;
  group?: string;
  body:   string;
  /** The timestamp the ticket records as both `filed` and `updated`; the caller owns the clock. */
  at:     string;
}

const TICKET_FILE_EXTENSION   = '.md';
const IDENTIFIER_PREFIX_MATCH = /^(\d+)-/;

/** Ordered by id numerically rather than lexicographically, so the order still holds once ids outgrow the padding width. */
export function listTickets(workspace: Workspace): TicketListing {
  const tickets: Ticket[] = [];
  const malformed: MalformedTicketFile[] = [];

  for (const fileName of ticketFileNamesIn(workspace)) {
    const filePath = join(workspace.ticketsDirectory, fileName);
    const ticket   = ticketAt(filePath);

    if (ticket.verdict === 'parsed') {
      tickets.push(ticket.ticket);
    } else {
      malformed.push({ filePath, reason: ticket.reason, line: ticket.line });
    }
  }

  tickets.sort((a, b) => Number(a.frontmatter.id) - Number(b.frontmatter.id));
  return { verdict: 'listed', tickets, malformed };
}

export function readTicket(workspace: Workspace, reference: string): Ticket | null {
  const identifier = TicketIdUtil.parseTicketReference(reference);
  if (identifier === null) {
    return null;
  }

  const fileName = ticketFileNamesIn(workspace).find((name) => name.startsWith(`${identifier}-`) || name === `${identifier}${TICKET_FILE_EXTENSION}`);
  if (fileName === undefined) {
    return null;
  }

  const ticket = ticketAt(join(workspace.ticketsDirectory, fileName));
  return ticket.verdict === 'parsed' ? ticket.ticket : null;
}

/** Writes through `lib/platform/AtomicFile.ts` and never touches `updated`; only `lib/tickets/TicketTransitions.ts` knows that a ticket changed. */
export function writeTicket(ticket: Ticket): void {
  writeFileAtomically(ticket.filePath, serializeTicketDocument(ticket.frontmatter, ticket.body));
}

/** The highest id in a file name plus one, so a malformed file still owns its number; gaps are tolerated and never filled. */
export function nextTicketId(workspace: Workspace): string {
  let highest = 0;

  for (const fileName of ticketFileNamesIn(workspace)) {
    const found = IDENTIFIER_PREFIX_MATCH.exec(fileName);
    if (found !== null) {
      highest = Math.max(highest, Number(found[1] ?? '0'));
    }
  }
  return TicketIdUtil.padTicketId(highest + 1);
}

export function createTicket(workspace: Workspace, input: CreateTicketInput): Ticket {
  // The directory is recreated rather than assumed: `clear --all` may have removed it.
  mkdirSync(workspace.ticketsDirectory, { recursive: true });

  const identifier  = nextTicketId(workspace);
  const fileName    = `${identifier}-${unusedSlugFor(workspace, SlugUtil.slugFromTitle(input.title))}${TICKET_FILE_EXTENSION}`;
  const frontmatter: TicketFrontmatter = {
    id:          identifier,
    title:       input.title,
    type:        input.type,
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
  const ticket: Ticket = { frontmatter, body: input.body, filePath: join(workspace.ticketsDirectory, fileName) };

  writeTicket(ticket);
  return ticket;
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
  | { verdict: 'parsed'; ticket: Ticket }
  | { verdict: 'malformed'; reason: string; line: number };

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
  return { verdict: 'parsed', ticket: { frontmatter: parsed.frontmatter, body: parsed.body, filePath } };
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
