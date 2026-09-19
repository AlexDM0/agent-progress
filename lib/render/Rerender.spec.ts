/**
 * The three answers `rerenderDashboard` can give; the reads are supplied as literals because
 * `lib/render/` may not import `lib/progress/` or `lib/tickets/`.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test
}                                                              from 'bun:test';
import type { ProgressFile, Ticket }                      from '../constants/Types.ts';
import { workspacePathsFor }                              from '../platform/Workspace.ts';
import type { Workspace }                                 from '../platform/Workspace.ts';
import { createScratchDirectory, removeScratchDirectory } from '../tooling/dev/ScratchWorkspace.ts';
import { rerenderDashboard }                              from './Rerender.ts';
import type { MalformedTicketFile, TrackerReads }         from './Rerender.ts';

const GENERATED_AT = new Date('2026-09-18T20:11:03Z');

const SYNTHETIC_PROGRESS: ProgressFile = {
  version:    1,
  trackerId:  'tracker-for-the-rerender-spec',
  project:    'Example Agency',
  startedAt:  '2026-09-18T20:00:00+02:00',
  nextTaskId: 2,
  view:       { kind: 'auto' },
  tasks:      [{
    id:     1,
    name:   'Review pass',
    status: 'running',
    start:  '2026-09-18T20:05:00+02:00',
    end:    null,
    owner:  'Alex Example',
    note:   '',
    ticket: null,
    tokens: 12_300,
  }],
  log: [{ at: '2026-09-18T20:05:00+02:00', text: 'Review pass started' }],
};

let scratchDirectory = '';
let workspace: Workspace;

function readsReturning(tickets: Ticket[], malformed: MalformedTicketFile[]): TrackerReads {
  return {
    readProgressFile: (asked: Workspace) => {
      try {
        return { verdict: 'readable', progress: JSON.parse(readFileSync(asked.progressFilePath, 'utf8')) as ProgressFile };
      } catch (problem) {
        return { verdict: 'unreadable', reason: problem instanceof Error ? problem.message : String(problem) };
      }
    },
    listTickets: () => ({ verdict: 'listed', tickets, malformed }),
  };
}

beforeEach(() => {
  scratchDirectory = createScratchDirectory('rerender');
  workspace        = workspacePathsFor(scratchDirectory);
  mkdirSync(workspace.ticketsDirectory, { recursive: true });
  writeFileSync(workspace.progressFilePath, JSON.stringify(SYNTHETIC_PROGRESS));
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

});
