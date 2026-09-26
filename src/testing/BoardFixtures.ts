/**
 * A Board over synthetic records, with a logger that keeps every record in a list, for the Board's specs to assert reason codes, records
 * and changed tickets against. Test-only: nothing that ships may import `src/testing/`.
 */
import type { LogRecord }                 from '../lib/tracker-model/@types/LogRecord.ts';
import type { ProgressFile }              from '../lib/tracker-model/@types/ProgressFile.ts';
import type { Task }                      from '../lib/tracker-model/@types/Task.ts';
import type { Ticket, TicketFrontmatter } from '../lib/tracker-model/@types/Ticket.ts';
import { Board }                          from '../lib/tracker-model/Board.ts';
import type { BoardRefusalDetail }        from '../lib/tracker-model/BoardRefusal.ts';
import { refusalIsBoardRefusal }          from '../lib/tracker-model/BoardRefusal.ts';
import { createLogger }                   from '../lib/tracker-model/Logger.ts';

const FIXTURE_STARTED_AT = '2026-09-18T09:00:00+02:00';

const FIXTURE_TICKETS_DIRECTORY = '/example-agency/storefront/.agent-progress/tickets';

export interface BoardFixture {
  board:    Board;
  progress: ProgressFile;
  tickets:  Ticket[];
  records:  LogRecord[];
}

export function taskFixture(overrides: Partial<Task> = {}): Task {
  return {
    id:     1,
    name:   'Example storefront task',
    status: 'pending',
    start:  null,
    end:    null,
    owner:  'Alex Example',
    note:   '',
    ticket: null,
    tokens: null,
    ...overrides,
  };
}

export function ticketFixture(overrides: Partial<TicketFrontmatter> = {}): Ticket {
  const frontmatter: TicketFrontmatter = {
    id:          '001',
    title:       'Example checkout page',
    type:        'feature',
    status:      'pending',
    filed:       FIXTURE_STARTED_AT,
    updated:     FIXTURE_STARTED_AT,
    started:     null,
    finished:    null,
    delivered:   null,
    abandonedAt: null,
    task:        null,
    extra:       [],
    ...overrides,
  };
  return { frontmatter, body: '', filePath: `${FIXTURE_TICKETS_DIRECTORY}/${frontmatter.id}-example.md` };
}

/** The next task id is one past the highest row handed in, as a tracker that filed those rows itself would hold. */
export function boardFixture(contents: { tasks?: Task[]; tickets?: Ticket[]; concurrencyLimit?: number } = {}): BoardFixture {
  const tasks      = contents.tasks ?? [];
  const tickets    = contents.tickets ?? [];
  const records: LogRecord[] = [];
  const progress: ProgressFile = {
    version:    1,
    trackerId:  'example-tracker-id',
    project:    'Example Agency',
    startedAt:  FIXTURE_STARTED_AT,
    view:       { kind: 'auto' },
    nextTaskId: Math.max(0, ...tasks.map((task) => task.id)) + 1,
    ...(contents.concurrencyLimit === undefined ? {} : { concurrencyLimit: contents.concurrencyLimit }),
    tasks,
    log:        [],
  };
  const board = new Board({ progress, tickets, logger: createLogger((record) => records.push(record)) });
  return {
    board,
    progress,
    tickets,
    records,
  };
}

/** The detail of the Board refusal the change throws; any other error is rethrown, and a change that is not refused fails. */
export function refusalDetailOf(change: () => unknown): BoardRefusalDetail {
  try {
    change();
  } catch (error) {
    if (refusalIsBoardRefusal(error)) return error.detail;
    throw error;
  }
  throw new Error('The change was not refused.');
}
