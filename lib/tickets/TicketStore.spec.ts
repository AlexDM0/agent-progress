/**
 * Every way an id-to-path mapping can go wrong in a directory a person also edits: the `3`/`003`/`#3`
 * spellings, colliding slugs, a deleted file whose number stays spent, and a file that no longer parses.
 */

import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir }         from 'node:os';
import { basename, join } from 'node:path';
import {
  afterEach,
  describe,
  expect,
  test,
} from 'bun:test';
import {
  HTML_FILE_NAME,
  LOCK_FILE_NAME,
  PROGRESS_FILE_NAME,
  TICKETS_DIRECTORY_NAME,
  TRACKER_DIRECTORY_NAME,
} from '../constants/Statuses.ts';
import type { Ticket, TicketType } from '../constants/Types.ts';
import type { Workspace }          from '../platform/Workspace.ts';
import {
  createTicket,
  deleteAllTickets,
  listTickets,
  nextTicketId,
  readTicket,
  writeTicket,
} from './TicketStore.ts';

const FILED_AT    = '2026-09-18T09:00:00+02:00';
const TICKET_BODY = '# Example\n\n## Report\n\nReported by Alex Example.\n';

const scratchRootDirectories: string[] = [];

function scratchWorkspace(): Workspace {
  const rootDirectory    = mkdtempSync(join(tmpdir(), 'agent-progress-tickets-'));
  const trackerDirectory = join(rootDirectory, TRACKER_DIRECTORY_NAME);
  const ticketsDirectory = join(trackerDirectory, TICKETS_DIRECTORY_NAME);

  mkdirSync(ticketsDirectory, { recursive: true });
  scratchRootDirectories.push(rootDirectory);

  return {
    rootDirectory,
    trackerDirectory,
    ticketsDirectory,
    progressFilePath: join(trackerDirectory, PROGRESS_FILE_NAME),
    htmlFilePath:     join(trackerDirectory, HTML_FILE_NAME),
    lockFilePath:     join(trackerDirectory, LOCK_FILE_NAME),
  };
}

function fileTicket(workspace: Workspace, title: string, type: TicketType): Ticket {
  return createTicket(workspace, {
    title,
    type,
    body: TICKET_BODY,
    at:   FILED_AT,
  });
}

afterEach(() => {
  for (const rootDirectory of scratchRootDirectories) {
    rmSync(rootDirectory, { recursive: true, force: true });
  }
  scratchRootDirectories.length = 0;
});

describe('createTicket and listTickets', () => {
  test('files three tickets as <id>-<slug>.md and lists them in id order', () => {
    const workspace = scratchWorkspace();

    fileTicket(workspace, 'Fix the export dialog', 'bug');
    fileTicket(workspace, 'Add a keyboard shortcut', 'feature');
    fileTicket(workspace, 'Tidy the seed data', 'change');

    const listing = listTickets(workspace);

    expect(listing.malformed).toEqual([]);
    expect(listing.tickets.map((ticket) => basename(ticket.filePath))).toEqual([
      '001-fix-the-export-dialog.md',
      '002-add-a-keyboard-shortcut.md',
      '003-tidy-the-seed-data.md',
    ]);
    expect(listing.tickets.map((ticket) => ticket.frontmatter.id)).toEqual(['001', '002', '003']);
  });

  test('a new ticket opens with no timeline and no task row of its own', () => {
    const workspace = scratchWorkspace();
    const ticket    = createTicket(workspace, {
      title: 'Fix the export dialog',
      type:  'bug',
      group: 'export-dialog',
      body:  TICKET_BODY,
      at:    FILED_AT,
    });

    expect(ticket.frontmatter.status).toBe('open');
    expect(ticket.frontmatter.filed).toBe(FILED_AT);
    expect(ticket.frontmatter.updated).toBe(FILED_AT);
    expect(ticket.frontmatter.started).toBeNull();
    expect(ticket.frontmatter.delivered).toBeNull();
    expect(ticket.frontmatter.group).toBe('export-dialog');
    expect(ticket.frontmatter.task).toBeNull();
    expect(ticket.body).toBe(TICKET_BODY);
  });

  test('a repeated title takes a suffixed slug, so the file names stay tellable apart without their ids', () => {
    const workspace = scratchWorkspace();

    fileTicket(workspace, 'Fix the export dialog', 'bug');
    const second = fileTicket(workspace, 'Fix the export dialog', 'bug');
    const third  = fileTicket(workspace, 'Fix the export dialog', 'bug');

    expect(basename(second.filePath)).toBe('002-fix-the-export-dialog-2.md');
    expect(basename(third.filePath)).toBe('003-fix-the-export-dialog-3.md');
  });

  test('a file that does not parse is reported with its path and line while the other tickets still list', () => {
    const workspace = scratchWorkspace();
    fileTicket(workspace, 'Fix the export dialog', 'bug');
    const brokenPath = join(workspace.ticketsDirectory, '002-broken.md');
    writeFileSync(brokenPath, '---\nid: "002"\ntitle: "No fence"\n');

    const listing = listTickets(workspace);

    expect(listing.tickets.map((ticket) => ticket.frontmatter.id)).toEqual(['001']);
    expect(listing.malformed).toEqual([{ filePath: brokenPath, reason: 'the frontmatter has no closing `---` fence', line: 3 }]);
  });

  test('a tickets directory that does not exist reads as no tickets rather than as a failure', () => {
    const workspace = scratchWorkspace();
    rmSync(workspace.ticketsDirectory, { recursive: true, force: true });

    expect(listTickets(workspace)).toEqual({ verdict: 'listed', tickets: [], malformed: [] });
    expect(nextTicketId(workspace)).toBe('001');
  });
});

describe('readTicket', () => {
  test('resolves 2, 002, #2 and #002 to the same file', () => {
    const workspace = scratchWorkspace();
    fileTicket(workspace, 'Fix the export dialog', 'bug');
    fileTicket(workspace, 'Add a keyboard shortcut', 'feature');
    const expectedPath = join(workspace.ticketsDirectory, '002-add-a-keyboard-shortcut.md');

    for (const reference of ['2', '002', '#2', '#002']) {
      expect(readTicket(workspace, reference)?.filePath).toBe(expectedPath);
    }
  });

  test('a reference that is not a ticket number, and an id with no file, both read as no ticket', () => {
    const workspace = scratchWorkspace();
    fileTicket(workspace, 'Fix the export dialog', 'bug');

    expect(readTicket(workspace, 'the-export-one')).toBeNull();
    expect(readTicket(workspace, '404')).toBeNull();
  });

  test('a broken file reads as no ticket instead of throwing out of the store', () => {
    const workspace = scratchWorkspace();
    writeFileSync(join(workspace.ticketsDirectory, '001-broken.md'), 'not a ticket at all\n');

    expect(readTicket(workspace, '1')).toBeNull();
  });
});

describe('nextTicketId', () => {
  test('a gap left by a ticket deleted by hand is tolerated and never filled', () => {
    const workspace = scratchWorkspace();
    fileTicket(workspace, 'Fix the export dialog', 'bug');
    const second = fileTicket(workspace, 'Add a keyboard shortcut', 'feature');
    fileTicket(workspace, 'Tidy the seed data', 'change');
    unlinkSync(second.filePath);

    expect(nextTicketId(workspace)).toBe('004');
  });

  test('a malformed file still spends its number', () => {
    const workspace = scratchWorkspace();
    writeFileSync(join(workspace.ticketsDirectory, '002-broken.md'), 'not a ticket at all\n');

    expect(nextTicketId(workspace)).toBe('003');
  });
});

describe('writeTicket and deleteAllTickets', () => {
  test('writes exactly the ticket it is given, leaving updated for the transition that owns it', () => {
    const workspace = scratchWorkspace();
    const filed     = fileTicket(workspace, 'Fix the export dialog', 'bug');

    filed.frontmatter.branch = 'ticket/export-dialog';
    filed.body               = `${TICKET_BODY}\n## Acceptance\n\nThe folder is remembered.\n`;
    writeTicket(filed);

    const reread = readTicket(workspace, '1');

    expect(reread?.frontmatter.branch).toBe('ticket/export-dialog');
    expect(reread?.frontmatter.updated).toBe(FILED_AT);
    expect(reread?.body).toBe(filed.body);
  });

  test('deletes every ticket file and answers how many there were', () => {
    const workspace = scratchWorkspace();
    fileTicket(workspace, 'Fix the export dialog', 'bug');
    fileTicket(workspace, 'Add a keyboard shortcut', 'feature');

    expect(deleteAllTickets(workspace)).toBe(2);
    expect(listTickets(workspace).tickets).toEqual([]);
    expect(nextTicketId(workspace)).toBe('001');
  });
});
