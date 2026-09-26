/**
 * The three answers `renderDashboard` can give, read from real tracker files written through the store's own writers: a page and the
 * malformed tickets it left out, or an unreadable tracker with the reading that says which file failed, and then no page. The page follows
 * the files, so a row stored after one render is on the next. `renderDashboardUnderLock` is pinned to take the lock and hand it back.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test';
import { createLogFileWriter }                            from '../../adapters/log/LogFileWriter.ts';
import { createProgressFileWriter }                       from '../../adapters/progress/ProgressFileWriter.ts';
import { createTicketFileWriter }                         from '../../adapters/tickets/TicketFileWriter.ts';
import type { LogRecord }                                 from '../../lib/tracker-model/@types/LogRecord.ts';
import type { ProgressFile }                              from '../../lib/tracker-model/@types/ProgressFile.ts';
import type { Task }                                      from '../../lib/tracker-model/@types/Task.ts';
import { ticketFixture }                                  from '../../testing/BoardFixtures.ts';
import { createScratchDirectory, removeScratchDirectory } from '../../testing/ScratchWorkspace.ts';
import { createRenderState }                              from '../render/RenderState.ts';
import { renderDashboard, renderDashboardUnderLock }      from './DashboardRendering.ts';
import { listTickets }                                    from './TicketStore.ts';
import { LockGenerationSteps }                            from './TrackerLock.ts';
import { workspacePathsFor, type Workspace }              from './Workspace.ts';

const GENERATED_AT = new Date('2026-09-18T20:11:03Z');

const renderState = createRenderState();

const REVIEW_PASS_TASK: Task = {
  id:     1,
  name:   'Review pass',
  status: 'in-progress',
  start:  '2026-09-18T20:05:00+02:00',
  end:    null,
  owner:  'Alex Example',
  note:   '',
  ticket: null,
  tokens: 12_300,
};

const EXAMPLE_PROGRESS: ProgressFile = {
  trackerId:  'tracker-for-the-dashboard-rendering-spec',
  project:    'Example Agency',
  startedAt:  '2026-09-18T20:00:00+02:00',
  nextTaskId: 2,
  view:       { kind: 'auto' },
  tasks:      [REVIEW_PASS_TASK],
};

const REVIEW_STARTED_NOTE: LogRecord = { at: '2026-09-18T20:05:00+02:00', kind: 'note', fields: { text: 'Review pass started' } };

const MALFORMED_TICKET_TEXT = 'no frontmatter here\n';

const BROKEN_LOG_TEXT = '{"at":"2026-09-18T20:05:00+02:00","kind":"note","fields":{"text":5}}\n';

let workspace: Workspace;

function writeTracker(progress: ProgressFile = EXAMPLE_PROGRESS): void {
  createProgressFileWriter(workspace.progressFilePath).write(progress);
  createLogFileWriter(workspace.logFilePath).write([REVIEW_STARTED_NOTE]);
}

function writtenPage(): string {
  return readFileSync(workspace.htmlFilePath, 'utf8');
}

beforeEach(() => {
  workspace = workspacePathsFor(createScratchDirectory('dashboard-rendering'));
  mkdirSync(workspace.ticketsDirectory, { recursive: true });
});

afterEach(() => {
  removeScratchDirectory(workspace.rootDirectory);
});

describe('rendering the dashboard', () => {
  test('writes a whole document to the workspace\'s html path and says it rendered', async () => {
    writeTracker();

    const outcome = await renderDashboard(workspace, GENERATED_AT, renderState);

    expect(outcome).toEqual({ verdict: 'rendered', malformedTickets: [] });
    const document = writtenPage();
    expect(document.startsWith('<!doctype html>')).toBe(true);
    expect(document).toContain('Example Agency');
    expect(document).toContain('Review pass');
    expect(document).toContain('<script>');
  });

  test('a malformed ticket file is reported on the verdict and does not appear on the page', async () => {
    writeTracker();
    const malformedFilePath = join(workspace.ticketsDirectory, '004-broken-by-hand.md');
    writeFileSync(malformedFilePath, MALFORMED_TICKET_TEXT);
    const expectedMalformed = listTickets(workspace).malformed;

    const outcome = await renderDashboard(workspace, GENERATED_AT, renderState);

    expect(expectedMalformed.map((malformed) => malformed.filePath)).toEqual([malformedFilePath]);
    expect(outcome).toEqual({ verdict: 'rendered', malformedTickets: expectedMalformed });
    for (const malformed of expectedMalformed) expect(writtenPage()).not.toContain(malformed.reason);
    expect(writtenPage()).not.toContain('004-broken-by-hand');
  });

  test('a ticket that did parse reaches the page', async () => {
    writeTracker();
    createTicketFileWriter().write({
      ...ticketFixture({ id: '003', title: 'Double-click a role to edit it' }),
      body:     '## Report\n\nThe role editor needs a double-click.\n',
      filePath: join(workspace.ticketsDirectory, '003-double-click-a-role-to-edit-it.md'),
    });

    await renderDashboard(workspace, GENERATED_AT, renderState);

    const document = writtenPage();
    expect(document).toContain('Double-click a role to edit it');
    expect(document).toContain('The role editor needs a double-click.');
  });

  test('a row written to disk after an earlier render appears on the next render', async () => {
    writeTracker();
    await renderDashboard(workspace, GENERATED_AT, renderState);
    expect(writtenPage()).not.toContain('Stored after the first render');

    const laterRow: Task = {
      ...REVIEW_PASS_TASK, id: 2, name: 'Stored after the first render', status: 'pending', start: null 
    };
    createProgressFileWriter(workspace.progressFilePath).write({ ...EXAMPLE_PROGRESS, nextTaskId: 3, tasks: [REVIEW_PASS_TASK, laterRow] });
    await renderDashboard(workspace, GENERATED_AT, renderState);

    expect(writtenPage()).toContain('Stored after the first render');
  });

  test('under the lock it renders the same way, and leaves the lock released', async () => {
    writeTracker();

    const outcome = await renderDashboardUnderLock(workspace, () => GENERATED_AT, renderState);

    expect(outcome).toEqual({ verdict: 'rendered', malformedTickets: [] });
    expect(writtenPage()).toContain('Review pass');
    const newestGeneration = (LockGenerationSteps.generationsIn(workspace.lockDirectoryPath) ?? []).at(-1);
    expect(newestGeneration).toBeDefined();
    const newestRecord = JSON.parse(readFileSync(LockGenerationSteps.generationPathFor(workspace.lockDirectoryPath, newestGeneration ?? 0), 'utf8')) as unknown;
    expect(newestRecord).toMatchObject({ state: 'released' });
  });
});

describe('when something cannot be read', () => {
  test('an unreadable progress file is an unreadable verdict carrying the reading, and no page is written', async () => {
    writeFileSync(workspace.progressFilePath, 'this is not JSON');

    const outcome = await renderDashboard(workspace, GENERATED_AT, renderState);

    expect(outcome.verdict).toBe('unreadable');
    const reading = outcome.verdict === 'unreadable' ? outcome.reading : null;
    expect(reading?.verdict === 'unreadable' ? reading.unreadableFile : null).toBe('progress-file');
    expect(reading?.filePath).toBe(workspace.progressFilePath);
    expect(existsSync(workspace.htmlFilePath)).toBe(false);
  });

  test('a progress file that is not there reads as absent rather than as an empty tracker, and no page is written', async () => {
    const outcome = await renderDashboard(workspace, GENERATED_AT, renderState);

    expect(outcome).toEqual({ verdict: 'unreadable', reading: { verdict: 'absent', filePath: workspace.progressFilePath } });
    expect(existsSync(workspace.htmlFilePath)).toBe(false);
  });

  test('an unreadable log is an unreadable log file carrying its reason, and no page is written', async () => {
    createProgressFileWriter(workspace.progressFilePath).write(EXAMPLE_PROGRESS);
    writeFileSync(workspace.logFilePath, BROKEN_LOG_TEXT);

    const outcome = await renderDashboard(workspace, GENERATED_AT, renderState);

    expect(outcome).toEqual({
      verdict: 'unreadable',
      reading: {
        verdict:        'unreadable',
        unreadableFile: 'log-file',
        filePath:       workspace.logFilePath,
        reason:         `${workspace.logFilePath}, line 1: fields.text is not a string`,
      },
    });
    expect(existsSync(workspace.htmlFilePath)).toBe(false);
  });
});
