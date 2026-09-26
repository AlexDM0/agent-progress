/**
 * The tickets directory as a store. Nothing here throws because a ticket file is bad: a malformed
 * file is a listing entry and a `null`, so one broken file cannot take down `status` or `render`.
 */

import { readdirSync, unlinkSync } from 'node:fs';
import { join }                    from 'node:path';
import { ProgressFileIngestion }   from '../../src/adapters/progress/ProgressFileIngestion.ts';
import { TicketFileIngestion }     from '../../src/adapters/tickets/TicketFileIngestion.ts';
import type {
  Ticket,
  TicketFrontmatter,
  TicketPriority,
  TicketType
} from '../../src/lib/tracker-model/@types/Ticket.ts';
import { TicketIdUtil }   from '../../src/lib/tracker-model/utils/TicketIdUtil.ts';
import type { Workspace } from '../../src/services/tracker/Workspace.ts';
import { SlugUtil }       from '../utils/SlugUtil.ts';

export interface MalformedTicketFile {
  filePath: string;
  reason:   string;
  line:     number;
}

export interface TicketListing {
  verdict:                'listed';
  tickets:                Ticket[];
  malformed:              MalformedTicketFile[];
  /** The listed tickets whose file still holds a retired word, in id order; the next write of each stores it in the current format. */
  ticketsInAnOlderFormat: Ticket[];
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

/**
 * A ticket is known by its frontmatter `id`. A file whose name carries another number, and every file holding an id another
 * also holds, is listed as malformed with its reason, since which of them is the ticket cannot be judged. Ordered by id numerically.
 */
export function listTickets(workspace: Workspace): TicketListing {
  const parsedFiles: ParsedTicketFile[]  = [];
  const malformed: MalformedTicketFile[] = [];

  for (const fileName of ticketFileNamesIn(workspace)) {
    const filePath = join(workspace.ticketsDirectory, fileName);
    const reading  = new TicketFileIngestion(filePath).read();

    if (reading.verdict === 'parsed') {
      parsedFiles.push({
        fileName,
        ticket:                reading.ticket,
        identifierLine:        reading.identifierLine,
        fileIsInAnOlderFormat: reading.fileIsInAnOlderFormat,
      });
    } else {
      malformed.push({ filePath, reason: reading.reason, line: reading.line });
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

  const listedFiles: ParsedTicketFile[] = [];
  for (const parsedFile of namedConsistently) {
    const otherHolders = namedConsistently.filter((other) => other !== parsedFile && other.ticket.frontmatter.id === parsedFile.ticket.frontmatter.id);

    if (otherHolders.length > 0) {
      const otherFileNames = otherHolders.map((other) => other.fileName).join(', ');
      malformed.push(malformedEntryOf(parsedFile, `ticket #${parsedFile.ticket.frontmatter.id} is also held by ${otherFileNames}`));
    } else {
      listedFiles.push(parsedFile);
    }
  }

  listedFiles.sort((a, b) => Number(a.ticket.frontmatter.id) - Number(b.ticket.frontmatter.id));
  malformed.sort((a, b) => (a.filePath < b.filePath ? -1 : Number(a.filePath > b.filePath)));
  return {
    verdict:                'listed',
    tickets:                listedFiles.map((listedFile) => listedFile.ticket),
    malformed,
    ticketsInAnOlderFormat: listedFiles.filter((listedFile) => listedFile.fileIsInAnOlderFormat).map((listedFile) => listedFile.ticket),
  };
}

/** Looked up by frontmatter `id`, never by file name; a ticket `listTickets` reports as malformed answers for no id. */
export function readTicket(workspace: Workspace, reference: string): Ticket | null {
  const identifier = TicketIdUtil.parseTicketReference(reference);
  if (identifier === null) {
    return null;
  }
  return listTickets(workspace).tickets.find((ticket) => ticket.frontmatter.id === identifier) ?? null;
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
    const reading = new TicketFileIngestion(join(workspace.ticketsDirectory, fileName)).read();
    if (reading.verdict === 'parsed') spend(reading.ticket.frontmatter.id);
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
    status:      'pending',
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

interface ParsedTicketFile {
  fileName:              string;
  ticket:                Ticket;
  identifierLine:        number;
  fileIsInAnOlderFormat: boolean;
}

function malformedEntryOf(parsedFile: ParsedTicketFile, reason: string): MalformedTicketFile {
  return { filePath: parsedFile.ticket.filePath, reason, line: parsedFile.identifierLine };
}

/** `012-slug.md` and `012.md` carry a number; any other name carries none, and a number no ticket could have counts as none. */
function identifierInFileName(fileName: string): string | null {
  const found = FILE_NAME_IDENTIFIER_MATCH.exec(fileName);
  return found === null ? null : TicketIdUtil.parseTicketReference(found[1] ?? '');
}

/** A progress file that is absent or unreadable names nothing: every command that files a ticket has already refused an unreadable one. */
function ticketIdsNamedByTaskRows(workspace: Workspace): string[] {
  const reading = new ProgressFileIngestion(workspace.progressFilePath).read();
  if (reading.verdict !== 'readable') {
    return [];
  }

  const identifiers: string[] = [];
  for (const task of reading.progress.tasks) {
    const identifier = task.ticket === null ? null : TicketIdUtil.parseTicketReference(task.ticket);
    if (identifier !== null) identifiers.push(identifier);
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
