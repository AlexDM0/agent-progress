/**
 * The three answers `rerenderDashboard` can give, an unreadable log among the unreadable ones; the reads are supplied as literals because
 * `lib/render/` may not import `lib/tickets/`.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test
}                                                              from 'bun:test';
import type { StoredLogReading }                          from '../../src/adapters/log/utils/TrackerLogUtil.ts';
import type { ProgressFile }                              from '../../src/lib/tracker-model/@types/ProgressFile.ts';
import type { Ticket }                                    from '../../src/lib/tracker-model/@types/Ticket.ts';
import { createScratchDirectory, removeScratchDirectory } from '../../src/testing/ScratchWorkspace.ts';
import { workspacePathsFor }                              from '../platform/Workspace.ts';
import type { Workspace }                                 from '../platform/Workspace.ts';
import { rerenderDashboard }                              from './Rerender.ts';
import type { MalformedTicketFile, TrackerReads }         from './Rerender.ts';

const GENERATED_AT = new Date('2026-09-18T20:11:03Z');

const SYNTHETIC_PROGRESS: ProgressFile = {
  trackerId:  'tracker-for-the-rerender-spec',
  project:    'Example Agency',
  startedAt:  '2026-09-18T20:00:00+02:00',
  nextTaskId: 2,
  view:       { kind: 'auto' },
  tasks:      [{
    id:     1,
    name:   'Review pass',
    status: 'in-progress',
    start:  '2026-09-18T20:05:00+02:00',
    end:    null,
    owner:  'Alex Example',
    note:   '',
    ticket: null,
    tokens: 12_300,
  }],
};

const SYNTHETIC_STORED_LOG: StoredLogReading = {
  verdict:                'readable',
  records:                [{ at: '2026-09-18T20:05:00+02:00', kind: 'note', fields: { text: 'Review pass started' } }],
  logFileMustBeRewritten: false,
};

let scratchDirectory = '';
let workspace: Workspace;

function readsReturning(tickets: Ticket[], malformed: MalformedTicketFile[], storedLog: StoredLogReading = SYNTHETIC_STORED_LOG): TrackerReads {
  return {
    readProgressFile: (asked: Workspace) => {
      try {
        return { verdict: 'readable', progress: JSON.parse(readFileSync(asked.progressFilePath, 'utf8')) as ProgressFile, embeddedLog: null };
      } catch (problem) {
        return { verdict: 'unreadable', reason: problem instanceof Error ? problem.message : String(problem) };
      }
    },
    readStoredLog: () => storedLog,
    listTickets:   () => ({ verdict: 'listed', tickets, malformed }),
    concurrencyOf: (progress: ProgressFile) => ({ limit: 3, agentsInFlight: progress.tasks.length }),
  };
}

beforeEach(() => {
  scratchDirectory = createScratchDirectory('rerender');
  workspace        = workspacePathsFor(scratchDirectory);
  mkdirSync(workspace.ticketsDirectory, { recursive: true });
  writeFileSync(workspace.progressFilePath, JSON.stringify({ version: 2, ...SYNTHETIC_PROGRESS }));
});

afterEach(() => {
  removeScratchDirectory(scratchDirectory);
});

describe('rendering the dashboard', () => {
  test('writes a whole document to the workspace\'s html path and says it rendered', async () => {
    const outcome = await rerenderDashboard({ workspace, generatedAt: GENERATED_AT, reads: readsReturning([], []) });

    expect(outcome.verdict).toBe('rendered');
    const document = readFileSync(workspace.htmlFilePath, 'utf8');
    expect(document.startsWith('<!doctype html>')).toBe(true);
    expect(document).toContain('Example Agency');
    expect(document).toContain('Review pass');
    expect(document).toContain('<script>');
  });

  test('a malformed ticket file is reported on the verdict and does not appear on the page', async () => {
    const malformed: MalformedTicketFile[] = [{
      filePath: `${workspace.ticketsDirectory}/004-broken.md`,
      reason:   'the frontmatter has no closing fence',
      line:     1,
    }];

    const outcome = await rerenderDashboard({ workspace, generatedAt: GENERATED_AT, reads: readsReturning([], malformed) });

    expect(outcome.verdict).toBe('rendered');
    expect(outcome.verdict === 'rendered' ? outcome.malformedTickets : []).toEqual(malformed);
    expect(readFileSync(workspace.htmlFilePath, 'utf8')).not.toContain('no closing fence');
  });

  test('a ticket that did parse reaches the page', async () => {
    const ticket: Ticket = {
      frontmatter: {
        id:          '003',
        title:       'Double-click a role to edit it',
        type:        'change',
        status:      'in-progress',
        filed:       '2026-09-18T20:01:00+02:00',
        updated:     '2026-09-18T20:05:00+02:00',
        started:     '2026-09-18T20:05:00+02:00',
        finished:    null,
        delivered:   null,
        abandonedAt: null,
        task:        1,
        extra:       [],
      },
      body:     '## Report\n\nThe role editor needs a double-click.\n',
      filePath: `${workspace.ticketsDirectory}/003-double-click-a-role-to-edit-it.md`,
    };

    await rerenderDashboard({ workspace, generatedAt: GENERATED_AT, reads: readsReturning([ticket], []) });

    const document = readFileSync(workspace.htmlFilePath, 'utf8');
    expect(document).toContain('Double-click a role to edit it');
    expect(document).toContain('The role editor needs a double-click.');
  });
});

describe('when something cannot be read', () => {
  test('an unreadable progress file is a verdict naming the file, and no page is written', async () => {
    writeFileSync(workspace.progressFilePath, 'this is not JSON');

    const outcome = await rerenderDashboard({ workspace, generatedAt: GENERATED_AT, reads: readsReturning([], []) });

    expect(outcome.verdict).toBe('unreadable');
    expect(outcome.verdict === 'unreadable' ? outcome.reason : '').toContain(workspace.progressFilePath);
    expect(() => readFileSync(workspace.htmlFilePath, 'utf8')).toThrow();
  });

  test('a progress file that is not there reads as unreadable rather than as an empty tracker', async () => {
    const emptyWorkspace = workspacePathsFor(`${scratchDirectory}/never-initialised`);

    const outcome = await rerenderDashboard({ workspace: emptyWorkspace, generatedAt: GENERATED_AT, reads: readsReturning([], []) });

    expect(outcome.verdict).toBe('unreadable');
  });

  test('an unreadable log is a verdict giving its reason, and no page is written', async () => {
    const unreadableLog: StoredLogReading = { verdict: 'unreadable', reason: `${workspace.logFilePath}, line 3: fields.text is not a string` };

    const outcome = await rerenderDashboard({ workspace, generatedAt: GENERATED_AT, reads: readsReturning([], [], unreadableLog) });

    expect(outcome).toEqual({ verdict: 'unreadable', reason: `The log cannot be read: ${workspace.logFilePath}, line 3: fields.text is not a string` });
    expect(() => readFileSync(workspace.htmlFilePath, 'utf8')).toThrow();
  });
});
