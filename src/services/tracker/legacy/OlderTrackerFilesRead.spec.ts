/**
 * The tracker service on older files it still reads: a version 1 progress.json's embedded log comes back as notes that log.jsonl must take,
 * the pipeline writes that log before progress.json, and a ticket stored in a retired word lists as current without its file changing.
 * It reads the older input `src/adapters/legacy/` and `src/shared/legacy/` exist for, and is deleted with them.
 */
import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { createProgressFileWriter }                               from '../../../adapters/progress/ProgressFileWriter.ts';
import { createTicketFileWriter }                                 from '../../../adapters/tickets/TicketFileWriter.ts';
import type { LogRecord }                                         from '../../../lib/tracker-model/@types/LogRecord.ts';
import type { ProgressFile }                                      from '../../../lib/tracker-model/@types/ProgressFile.ts';
import type { Ticket, TicketType }                                from '../../../lib/tracker-model/@types/Ticket.ts';
import { EmptyProgressUtil }                                      from '../../../lib/tracker-model/utils/EmptyProgressUtil.ts';
import { LIMITS }                                                 from '../../../shared/constants/Limits.ts';
import { createScratchDirectory, removeScratchDirectory }         from '../../../testing/ScratchWorkspace.ts';
import { createRenderState }                                      from '../../render/RenderState.ts';
import { createTicket, listTickets, readTicket }                  from '../TicketStore.ts';
import { writeTracker }                                           from '../TrackerPipeline.ts';
import { readTracker, type TrackerContents, type TrackerReading } from '../TrackerReader.ts';
import { workspacePathsFor, type Workspace }                      from '../Workspace.ts';

const STARTED_AT = '2026-09-18T09:00:00+02:00';

const CHANGED_AT = '2026-09-18T20:05:00+02:00';

const FILED_AT = '2026-09-18T09:00:00+02:00';

const TICKET_BODY = '# Example\n\n## Report\n\nReported by Alex Example.\n';

const NOTE_RECORD: LogRecord = { at: '2026-09-18T10:15:00+02:00', kind: 'note', fields: { text: 'Example session started' } };

const now = (): Date => new Date('2026-09-18T18:05:00Z');

const renderState = createRenderState();

let workspace: Workspace;

function emptyProgress(): ProgressFile {
  return EmptyProgressUtil.emptyProgressFor({ project: 'Example Agency', startedAt: STARTED_AT, trackerId: 'example-tracker-id' });
}

/** A version 1 file keeps its log inside itself as `{ at, text }` notes; the writers only write version 2, so the version is set by hand. */
function writeVersionOneTracker(): void {
  createProgressFileWriter(workspace.progressFilePath).write(emptyProgress());
  const stored = JSON.parse(readFileSync(workspace.progressFilePath, 'utf8')) as Record<string, unknown>;
  const versionOneDocument = { ...stored, version: 1, log: [{ at: NOTE_RECORD.at, text: 'Example session started' }] };
  writeFileSync(workspace.progressFilePath, `${JSON.stringify(versionOneDocument, null, LIMITS.JSON_INDENT_SPACES)}\n`);
}

function fileTicket(title: string, type: TicketType): Ticket {
  const ticket = createTicket(workspace, {
    title,
    type,
    bodyFor: () => TICKET_BODY,
    at:      FILED_AT,
  });
  createTicketFileWriter().write(ticket);
  return ticket;
}

function contentsOf(reading: TrackerReading): TrackerContents {
  if (reading.verdict !== 'readable') throw new Error(`the tracker was expected to be readable, and reads ${reading.verdict}`);
  return reading.contents;
}

async function failureOf(action: () => Promise<unknown>): Promise<unknown> {
  try {
    await action();
  } catch (error) {
    return error;
  }
  throw new Error('the action did not fail');
}

beforeEach(() => {
  workspace = workspacePathsFor(createScratchDirectory('older-tracker-files-read'));
  mkdirSync(workspace.ticketsDirectory, { recursive: true });
});

afterEach(() => {
  removeScratchDirectory(workspace.rootDirectory);
});

describe('readTracker', () => {
  test('a version 1 file beside no log.jsonl reads its embedded notes, and log.jsonl must be rewritten', () => {
    writeVersionOneTracker();

    expect(contentsOf(readTracker(workspace)).storedLog).toEqual({ records: [NOTE_RECORD], logFileMustBeRewritten: true });
  });
});

describe('writeTracker', () => {
  test('for a version 1 tracker, log.jsonl is written before progress.json', async () => {
    writeVersionOneTracker();

    const failure = await failureOf(() => writeTracker({
      workspace,
      at:     CHANGED_AT,
      now,
      renderState,
      mutate: (change) => {
        change.board.addTask({ name: 'Example rendered row', startsNow: false, movesTheLink: false }, change.at);
        rmSync(workspace.progressFilePath);
        mkdirSync(workspace.progressFilePath);
      },
    }));

    expect(String(failure), 'the progress file write is what failed').toContain('/progress.json\'');
    expect(readFileSync(workspace.logFilePath, 'utf8')).toBe(`${JSON.stringify(NOTE_RECORD)}\n`);
  });
});

describe('listTickets and readTicket', () => {
  // Keeps the retired word as input on purpose: only the next write may move a stored ticket to the new word, never a read.
  test('listing or reading a ticket stored as open reads it as pending and leaves the file byte for byte', () => {
    const ticketPath = fileTicket('Fix the export dialog', 'bug').filePath;
    writeFileSync(ticketPath, readFileSync(ticketPath, 'utf8').replace('status: "pending"', 'status: open'));
    const storedBytes = readFileSync(ticketPath, 'utf8');

    expect(listTickets(workspace).tickets.map((listed) => listed.frontmatter.status)).toEqual(['pending']);
    expect(readTicket(workspace, '1')?.frontmatter.status).toBe('pending');
    expect(readFileSync(ticketPath, 'utf8')).toBe(storedBytes);
    expect(storedBytes).toContain('status: open');
  });

  test('ticketsInAnOlderFormat lists exactly the tickets stored with a retired word', () => {
    fileTicket('Fix the export dialog', 'bug');
    const ticketPath = fileTicket('Add a keyboard shortcut', 'feature').filePath;
    writeFileSync(ticketPath, readFileSync(ticketPath, 'utf8').replace('status: "pending"', 'status: open'));

    const listing = listTickets(workspace);

    expect(listing.tickets.map((listed) => listed.frontmatter.id)).toEqual(['001', '002']);
    expect(listing.ticketsInAnOlderFormat.map((listed) => listed.filePath)).toEqual([ticketPath]);
  });
});
