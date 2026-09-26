/**
 * Every way an id-to-path mapping can go wrong in a directory a person also edits: the `3`/`003`/`#3`
 * spellings, colliding slugs, a deleted file whose number stays spent, and a file that no longer parses.
 */

import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
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
import { createProgressFileWriter } from '../../adapters/progress/ProgressFileWriter.ts';
import { createTicketFileWriter }   from '../../adapters/tickets/TicketFileWriter.ts';
import type { Ticket, TicketType }  from '../../lib/tracker-model/@types/Ticket.ts';
import { EmptyProgressUtil }        from '../../lib/tracker-model/utils/EmptyProgressUtil.ts';
import { TaskFilingUtil }           from '../../lib/tracker-model/utils/TaskFilingUtil.ts';
import {
  createTicket,
  deleteAllTickets,
  listTickets,
  nextTicketId,
  readTicket,
} from './TicketStore.ts';
import type { Workspace } from './Workspace.ts';
import { TRACKER_FILES }  from './constants/TrackerFiles.ts';

const FILED_AT    = '2026-09-18T09:00:00+02:00';
const TICKET_BODY = '# Example\n\n## Report\n\nReported by Alex Example.\n';

const scratchRootDirectories: string[] = [];

function scratchWorkspace(): Workspace {
  const rootDirectory    = mkdtempSync(join(tmpdir(), 'agent-progress-tickets-'));
  const trackerDirectory = join(rootDirectory, TRACKER_FILES.TRACKER_DIRECTORY_NAME);
  const ticketsDirectory = join(trackerDirectory, TRACKER_FILES.TICKETS_DIRECTORY_NAME);

  mkdirSync(ticketsDirectory, { recursive: true });
  scratchRootDirectories.push(rootDirectory);

  return {
    rootDirectory,
    trackerDirectory,
    ticketsDirectory,
    progressFilePath:  join(trackerDirectory, TRACKER_FILES.PROGRESS_FILE_NAME),
    logFilePath:       join(trackerDirectory, TRACKER_FILES.LOG_FILE_NAME),
    htmlFilePath:      join(trackerDirectory, TRACKER_FILES.HTML_FILE_NAME),
    lockDirectoryPath: join(trackerDirectory, TRACKER_FILES.LOCK_DIRECTORY_NAME),
  };
}

function fileTicket(workspace: Workspace, title: string, type: TicketType): Ticket {
  const ticket = createTicket(workspace, {
    title,
    type,
    bodyFor: () => TICKET_BODY,
    at:      FILED_AT,
  });
  createTicketFileWriter().write(ticket);
  return ticket;
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
      title:   'Fix the export dialog',
      type:    'bug',
      group:   'export-dialog',
      bodyFor: () => TICKET_BODY,
      at:      FILED_AT,
    });

    expect(ticket.frontmatter.status).toBe('pending');
    expect(ticket.frontmatter.filed).toBe(FILED_AT);
    expect(ticket.frontmatter.updated).toBe(FILED_AT);
    expect(ticket.frontmatter.started).toBeNull();
    expect(ticket.frontmatter.delivered).toBeNull();
    expect(ticket.frontmatter.group).toBe('export-dialog');
    expect(ticket.frontmatter.task).toBeNull();
    expect(ticket.body).toBe(TICKET_BODY);
  });

  // The command layer writes a new ticket after the progress file; a write in here would come first, and a second time.
  test('writes no file, and composes the body from the id it assigns', () => {
    const workspace = scratchWorkspace();
    fileTicket(workspace, 'Fix the export dialog', 'bug');

    const ticket = createTicket(workspace, {
      title:   'Add a keyboard shortcut',
      type:    'feature',
      bodyFor: (ticketId) => `# ${ticketId} — Add a keyboard shortcut\n`,
      at:      FILED_AT,
    });

    expect(ticket.body).toBe('# 002 — Add a keyboard shortcut\n');
    expect(listTickets(workspace).tickets.map((listed) => listed.frontmatter.id)).toEqual(['001']);
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

    expect(listTickets(workspace)).toEqual({
      verdict: 'listed', tickets: [], malformed: [], ticketsInAnOlderFormat: [] 
    });
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

  test('ticketsInAnOlderFormat is empty when every ticket is stored in the current format', () => {
    const workspace = scratchWorkspace();
    fileTicket(workspace, 'Fix the export dialog', 'bug');
    fileTicket(workspace, 'Add a keyboard shortcut', 'feature');

    const listing = listTickets(workspace);

    expect(listing.tickets.map((listed) => listed.frontmatter.id)).toEqual(['001', '002']);
    expect(listing.ticketsInAnOlderFormat).toEqual([]);
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

// A person renames ticket files by hand; the id the frontmatter holds is the ticket's identity, never the name it was given.
describe('a ticket file renamed by hand', () => {
  test('a file renamed without its number still spends its id, so the next ticket is not issued it again', () => {
    const workspace = scratchWorkspace();
    const first     = fileTicket(workspace, 'Fix the export dialog', 'bug');
    renameSync(first.filePath, join(workspace.ticketsDirectory, 'renamed-by-hand.md'));

    expect(nextTicketId(workspace)).toBe('002');
    expect(readTicket(workspace, '1')?.frontmatter.title).toBe('Fix the export dialog');
  });

  test('a file renamed to another number answers for neither number, and is listed as malformed naming both', () => {
    const workspace   = scratchWorkspace();
    const first       = fileTicket(workspace, 'Fix the export dialog', 'bug');
    const renamedPath = join(workspace.ticketsDirectory, '012-renamed.md');
    renameSync(first.filePath, renamedPath);

    expect(readTicket(workspace, '12')).toBeNull();
    expect(readTicket(workspace, '1')).toBeNull();
    expect(listTickets(workspace)).toEqual({
      verdict:                'listed',
      tickets:                [],
      malformed:              [{ filePath: renamedPath, reason: 'the file name says #012 but its `id` is 001', line: 2 }],
      ticketsInAnOlderFormat: [],
    });
    expect(nextTicketId(workspace)).toBe('013');
  });

  test('two files holding one id are both listed as malformed, and neither answers for it', () => {
    const workspace = scratchWorkspace();
    const first     = fileTicket(workspace, 'Fix the export dialog', 'bug');
    const copyPath  = join(workspace.ticketsDirectory, 'copy-of-the-first.md');
    copyFileSync(first.filePath, copyPath);

    expect(readTicket(workspace, '1')).toBeNull();
    expect(listTickets(workspace)).toEqual({
      verdict:   'listed',
      tickets:   [],
      malformed: [
        { filePath: first.filePath, reason: 'ticket #001 is also held by copy-of-the-first.md', line: 2 },
        { filePath: copyPath, reason: 'ticket #001 is also held by 001-fix-the-export-dialog.md', line: 2 },
      ],
      ticketsInAnOlderFormat: [],
    });
  });

  // `ticket add` writes the progress file before the ticket file; a crash between the two leaves a row naming an id no file holds.
  test('an id a task row names spends its number although no ticket file holds it', () => {
    const workspace = scratchWorkspace();
    fileTicket(workspace, 'Fix the export dialog', 'bug');
    const progress = EmptyProgressUtil.emptyProgressFor({ project: 'Example Agency', startedAt: FILED_AT, trackerId: 'example-tracker-id' });
    createProgressFileWriter(workspace.progressFilePath).write({
      ...progress,
      nextTaskId: 4,
      tasks:      [
        TaskFilingUtil.filedTaskOf(1, { name: 'Fix the export dialog', ticket: '001' }),
        TaskFilingUtil.filedTaskOf(2, { name: 'Example row of a ticket never written', ticket: '005' }),
        TaskFilingUtil.filedTaskOf(3, { name: 'Example free row' }),
      ],
    });

    expect(nextTicketId(workspace)).toBe('006');
  });

  test('a progress file that does not parse leaves the ids to the ticket files', () => {
    const workspace = scratchWorkspace();
    fileTicket(workspace, 'Fix the export dialog', 'bug');
    writeFileSync(workspace.progressFilePath, '{ not json');

    expect(nextTicketId(workspace)).toBe('002');
  });
});

describe('deleteAllTickets', () => {
  test('deletes every ticket file and answers how many there were', () => {
    const workspace = scratchWorkspace();
    fileTicket(workspace, 'Fix the export dialog', 'bug');
    fileTicket(workspace, 'Add a keyboard shortcut', 'feature');

    expect(deleteAllTickets(workspace)).toBe(2);
    expect(listTickets(workspace).tickets).toEqual([]);
    expect(nextTicketId(workspace)).toBe('001');
  });
});
