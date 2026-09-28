/**
 * What `agent-progress status` tells its two readers. The `--json` working view leaves settled work and the old log out and counts what it
 * left out; `--full` is the whole progress file plus the tickets. Both documents are the agent's contract, and both carry the concurrency block.
 */
import { writeFileSync } from 'node:fs';
import { join }          from 'node:path';

import {
  afterEach,
  beforeEach,
  expect,
  test
}                                                                             from 'bun:test';
import type { TicketFrontmatter }             from '../../../src/lib/tracker-model/@types/Ticket.ts';
import type { WordedProgressDocument }        from '../../../src/shared/@types/WordedProgressDocument.ts';
import { removeScratchDirectory }             from '../../../src/testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent }           from '../../../src/testing/ToolGuard.ts';
import { runCommandLine }                     from '../../Main.ts';
import { createCapturedCommandContext }       from '../../testing/CapturedCommandContext.ts';
import { createInitializedScratchRepository } from '../../testing/InitializedScratchRepository.ts';

const FROZEN_NOW = new Date('2026-09-18T20:11:03Z');

type StatusDocument = WordedProgressDocument & {
  tickets:       Array<TicketFrontmatter & { filePath: string }>;
  omitted?:      { settledTasks: number; settledTickets: number; olderLogEntries: number; freeStandingTasks?: number };
  tokensByOwner: {
    owners:        Array<{ owner: string; tokens: number; rows: number }>;
    withoutOwner:  { tokens: number; rows: number };
    withoutTokens: { rows: number };
  };
  concurrency: {
    limit:                 number;
    agentsInFlight:        number;
    freeSlots:             number;
    readyTicketIds:        string[];
    dispatcherState:       string;
    dispatcherRunId?:      string;
    inProgressTicketIds:   string[];
    inProgressReviewOfIds: string[];
  };
  readyTickets:         Array<{ id: string; priority: string; model: string; effort: string; group?: string }>;
  reviewWaitingTickets: Array<{ id: string; model: string; effort: string }>;
  pausedBuilds:         Array<{ id: string; note: string; priority: string; model: string; effort: string }>;
  ticketRows:           Array<{
    id:         string;
    row:        { id: number; status: string; note: string } | null;
    reviewBars: Array<{ id: number; status: string; round?: number }>;
  }>;
};

let repositoryDirectory = '';

function contextHere(): ReturnType<typeof createCapturedCommandContext> {
  return createCapturedCommandContext({ currentDirectory: repositoryDirectory, now: () => FROZEN_NOW });
}

async function run(commandLineArguments: readonly string[]): Promise<ReturnType<typeof createCapturedCommandContext>> {
  const context  = contextHere();
  const exitCode = await runCommandLine(commandLineArguments, context);
  expect(exitCode, `\`agent-progress ${commandLineArguments.join(' ')}\` failed: ${context.errorText()}`).toBe(0);
  return context;
}

beforeEach(async () => {
  repositoryDirectory = await createInitializedScratchRepository('status-command', ['--project', 'Example Agency'], () => FROZEN_NOW);
  await run(['ticket', 'add', 'Double-click a role to edit it']);
  await run(['ticket', 'start', '1']);
  await run(['task', 'add', 'Review pass', '--start', '--owner', 'Alex Example']);
  await run(['log', 'Halfway through the role editor']);
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
});

describeWhenGitIsPresent('the human listing', () => {
  test('hides delivered rows behind a count, and --full lists them', async () => {
    await run(['task', 'deliver', '2']);

    const trimmed = (await run(['status'])).outputText();
    const full    = (await run(['status', '--full'])).outputText();

    expect(trimmed).not.toContain('Review pass');
    expect(trimmed).toContain('1 delivered or abandoned rows not shown');
    expect(full).toContain('Review pass');
    expect(full).not.toContain('not shown');
  });

  test('names the project, counts both ladders, lists every row and ends with the log', async () => {
    const context = await run(['status']);
    const printed = context.outputText();

    expect(printed).toContain('Example Agency');
    expect(printed).toContain('2 in-progress');
    expect(printed).toContain('1 in-progress');
    expect(printed).toContain('#001 Double-click a role to edit it');
    expect(printed).toContain('Review pass');
    expect(printed).toContain('Alex Example');
    expect(printed).toContain('Halfway through the role editor');
  });
});

describeWhenGitIsPresent('the --json --full document', () => {
  test('is the progress file itself, so an agent could write the document it read back', async () => {
    const context  = await run(['status', '--json', '--full']);
    const document = JSON.parse(context.outputText()) as StatusDocument;

    expect(document.version).toBe(1);
    expect(document.trackerId.length).toBeGreaterThan(0);
    expect(document.nextTaskId).toBe(3);
  });

  test('carries the project, the view, every row, every ticket\'s frontmatter and the log', async () => {
    const context  = await run(['status', '--json', '--full']);
    const document = JSON.parse(context.outputText()) as StatusDocument;

    expect(document.project).toBe('Example Agency');
    expect(document.view).toEqual({ kind: 'auto' });
    expect(document.startedAt.length).toBeGreaterThan(0);

    expect(document.tasks.map((task) => task.name)).toEqual(['#001 Double-click a role to edit it', 'Review pass']);
    expect(document.tasks[1]).toMatchObject({ status: 'in-progress', owner: 'Alex Example', ticket: null });

    expect(document.tickets).toHaveLength(1);
    expect(document.tickets[0]).toMatchObject({ id: '001', status: 'in-progress', task: 1 });
    expect(document.tickets[0]?.filePath).toContain('001-double-click-a-role-to-edit-it.md');

    expect(document.log.map((entry) => entry.text)).toContain('Halfway through the role editor');
    expect(document.omitted).toBeUndefined();
  });

  test('keeps delivered work and the whole log', async () => {
    await run(['task', 'deliver', '2']);
    for (let i = 0; i < 12; i++) await run(['log', `Milestone ${i}`]);

    const document = JSON.parse((await run(['status', '--json', '--full'])).outputText()) as StatusDocument;

    expect(document.tasks).toHaveLength(2);
    expect(document.log.length).toBeGreaterThan(12);
  });
});

describeWhenGitIsPresent('the --json working view', () => {
  // The document an agent reads at every session start; it has to stay small however long the project runs.
  test('leaves delivered and abandoned rows and tickets out, and counts them', async () => {
    await run(['ticket', 'add', 'Rename the export button']);
    await run(['ticket', 'abandon', '2', '--reason', 'Out of scope']);
    await run(['task', 'deliver', '2']);

    const document = JSON.parse((await run(['status', '--json'])).outputText()) as StatusDocument;

    expect(document.tasks.map((task) => task.name)).toEqual(['#001 Double-click a role to edit it']);
    expect(document.tickets.map((ticket) => ticket.id)).toEqual(['001']);
    expect(document.omitted).toEqual({ settledTasks: 2, settledTickets: 1, olderLogEntries: 0 });
  });

  test('keeps in-review and reviewed rows, which still wait on the orchestrator', async () => {
    await run(['task', 'finish', '2']);

    const document = JSON.parse((await run(['status', '--json'])).outputText()) as StatusDocument;

    expect(document.tasks[1]).toMatchObject({ name: 'Review pass', status: 'in-review' });
  });

  test('carries the last 10 log entries newest first by their stamp, and counts the older ones', async () => {
    for (let i = 0; i < 12; i++) await run(['log', `Milestone ${i}`, '--at', `-${12 - i}m`]);
    await run(['log', 'Backfilled from a day ago', '--at', '-1d']);

    const document     = JSON.parse((await run(['status', '--json'])).outputText()) as StatusDocument;
    const fullDocument = JSON.parse((await run(['status', '--json', '--full'])).outputText()) as StatusDocument;
    const logTexts     = document.log.map((entry) => entry.text);

    expect(logTexts).toHaveLength(10);
    expect(logTexts[0]).toBe('Halfway through the role editor');
    expect(logTexts).not.toContain('Backfilled from a day ago');
    expect(document.omitted?.olderLogEntries).toBe(fullDocument.log.length - 10);
  });

  test('still carries the header fields an agent keys on', async () => {
    const document = JSON.parse((await run(['status', '--json'])).outputText()) as StatusDocument;

    expect(document.project).toBe('Example Agency');
    expect(document.nextTaskId).toBe(3);
    expect(document.trackerId.length).toBeGreaterThan(0);
  });
});

describeWhenGitIsPresent('when a ticket file will not parse', () => {
  test('it is reported on standard error and both forms still answer', async () => {
    writeFileSync(join(repositoryDirectory, '.agent-progress', 'tickets', '004-broken.md'), 'no frontmatter at all\n');

    const context  = await run(['status', '--json']);
    const document = JSON.parse(context.outputText()) as StatusDocument;

    expect(context.errorText()).toContain('004-broken.md');
    expect(document.tickets).toHaveLength(1);
  });
});

describeWhenGitIsPresent('token counts', () => {
  test('a reported row shows its count, an unreported one shows a dash, and the total names both numbers', async () => {
    await run(['task', 'finish', '2', '--tokens', '12.3k']);

    const printed = (await run(['status'])).outputText();

    expect(printed).toContain('12.3k');
    expect(printed).toContain('Tokens:  12.3k reported across 1 of 2 rows');
    expect(printed).toContain('-  ');
  });

  test('no total line at all when nothing was reported, rather than a zero', async () => {
    expect((await run(['status'])).outputText()).not.toContain('Tokens:');
  });

  test('--json carries the raw field, not the shortened text', async () => {
    await run(['task', 'finish', '2', '--tokens', '12.3k']);

    const document = JSON.parse((await run(['status', '--json'])).outputText()) as StatusDocument;

    expect(document.tasks[1]?.tokens).toBe(12_300);
    expect(document.tasks[0]?.tokens).toBeNull();
  });
});

describeWhenGitIsPresent('token counts per owner', () => {
  // The owner is free text an orchestrator types, so spellings that differ only in case or spaces are one agent, not three.
  async function fileOwnerRows(): Promise<void> {
    await run(['task', 'add', 'Example build one', '--owner', 'Opus', '--tokens', '1000']);
    await run(['task', 'add', 'Example build two', '--owner', 'opus', '--tokens', '2000']);
    await run(['task', 'add', 'Example build three', '--owner', ' opus ', '--tokens', '4000']);
    await run(['task', 'add', 'Example chore', '--tokens', '500']);
  }

  test('--json groups opus, Opus and " opus " into one owner under the most common spelling, and every total adds up', async () => {
    await fileOwnerRows();

    const document = JSON.parse((await run(['status', '--json'])).outputText()) as StatusDocument;
    const grouped  = document.tokensByOwner;
    const reported = document.tasks.reduce((running, task) => running + (task.tokens ?? 0), 0);

    expect(grouped.owners).toEqual([{ owner: 'opus', tokens: 7000, rows: 3 }]);
    expect(grouped.withoutOwner).toEqual({ tokens: 500, rows: 1 });
    expect(grouped.withoutTokens).toEqual({ rows: 2 });
    expect(grouped.owners.reduce((running, owner) => running + owner.tokens, 0) + grouped.withoutOwner.tokens).toBe(reported);
  });

  test('the human listing prints one line per owner group and one for the rows without an owner', async () => {
    await fileOwnerRows();

    const printed = (await run(['status'])).outputText();

    expect(printed).toContain('Tokens:  7.5k reported across 4 of 6 rows');
    expect(printed).toMatch(/\n {9}opus {10}7k {6}3 rows\n/);
    expect(printed).toMatch(/\n {9}no owner {6}500 {5}1 row\n/);
    expect(printed).not.toMatch(/\n {9}Opus /);
  });
});

describeWhenGitIsPresent('--tickets-only', () => {
  // A session working a ticket queue reads past chores: exactly the rows that are no ticket's own row and no review bar go.
  async function fileReviewBar(): Promise<void> {
    await run(['task', 'add', 'Review 1 #001 — Double-click a role to edit it', '--review-of', '1']);
  }

  test('the human listing keeps the ticket\'s row and its review bar, and counts the free-standing row it left out', async () => {
    await fileReviewBar();

    const printed = (await run(['status', '--tickets-only'])).outputText();

    expect(printed).toContain('#001 Double-click a role to edit it');
    expect(printed).toContain('Review 1 #001');
    expect(printed).not.toContain('Review pass');
    expect(printed).toContain('(1 free-standing task rows not shown under --tickets-only)');
    expect(printed).toContain('Halfway through the role editor');
  });

  test('--json and --json --full list exactly the ticket\'s row and its review bar, and keep the tickets and the log', async () => {
    await fileReviewBar();

    const working = JSON.parse((await run(['status', '--json', '--tickets-only'])).outputText()) as StatusDocument;
    const full    = JSON.parse((await run(['status', '--json', '--full', '--tickets-only'])).outputText()) as StatusDocument;

    expect(working.tasks.map((task) => task.id)).toEqual([1, 3]);
    expect(full.tasks.map((task) => task.id)).toEqual([1, 3]);
    expect(working.omitted).toEqual({
      settledTasks: 0, settledTickets: 0, olderLogEntries: 0, freeStandingTasks: 1
    });
    expect(working.tickets.map((ticket) => ticket.id)).toEqual(['001']);
    expect(full.log.map((entry) => entry.text)).toContain('Halfway through the role editor');
  });

  test('without the flag the free-standing row is listed and nothing counts it as left out', async () => {
    const document = JSON.parse((await run(['status', '--json'])).outputText()) as StatusDocument;

    expect(document.tasks.map((task) => task.id)).toEqual([1, 2]);
    expect(Object.keys(document.omitted ?? {})).not.toContain('freeStandingTasks');
  });
});

describeWhenGitIsPresent('the log listing', () => {
  test('is newest first by the stamp, not by the order entries were appended', async () => {
    await run(['log', 'Backfilled from an hour ago', '--at', '-1h']);

    const lines = (await run(['status'])).outputText().split('\n');
    const logStart = lines.findIndex((line) => line.startsWith('Log ('));
    const logLines = lines.slice(logStart + 1).filter((line) => line.startsWith('  '));

    expect(logLines[0]).toContain('Halfway through the role editor');
    expect(logLines.at(-1)).toContain('Backfilled from an hour ago');
  });

  test('a log spanning more than one calendar day carries the date on every line', async () => {
    await run(['log', 'Yesterday afternoon', '--at', '-1d']);

    const printed = (await run(['status'])).outputText();

    expect(printed).toMatch(/\n {2}\d{2}-\d{2} \d{2}:\d{2} {2}Yesterday afternoon/);
  });

  test('a log inside one day carries the clock alone', async () => {
    const printed = (await run(['status'])).outputText();

    expect(printed).toMatch(/\n {2}\d{2}:\d{2} {2}Halfway through the role editor/);
  });
});

describeWhenGitIsPresent('the concurrency block both --json documents carry', () => {
  // A dispatcher reads this to decide whether to start an agent and on what: the review bar counts, and a ticket waiting on unfinished work is not ready.
  test('counts every running row against the limit and lists the ready tickets lowest first', async () => {
    await run(['ticket', 'add', 'Show the role history']);
    await run(['ticket', 'add', 'Export the roles', '--depends-on', '1']);
    await run(['ticket', 'add', 'Import the roles']);

    const working = JSON.parse((await run(['status', '--json'])).outputText()) as StatusDocument;
    const full    = JSON.parse((await run(['status', '--json', '--full'])).outputText()) as StatusDocument;

    const expected = {
      limit:                 2,
      agentsInFlight:        2,
      freeSlots:             0,
      readyTicketIds:        ['002', '004'],
      dispatcherState:       'stopped',
      heldTicketIds:         [],
      inProgressTicketIds:   ['001'],
      inProgressReviewOfIds: [],
    };
    expect(working.concurrency).toEqual(expected);
    expect(full.concurrency).toEqual(expected);
  });

  // The orchestrator reads the state here, so the run to resume rides beside it; absent, the block keeps the shape every older reader knows.
  test('carries the stored run id beside the dispatcher state only while one is stored', async () => {
    await run(['dispatcher', 'running', '--run', 'wf_example-run-2']);

    const working = JSON.parse((await run(['status', '--json'])).outputText()) as StatusDocument;
    const full    = JSON.parse((await run(['status', '--json', '--full'])).outputText()) as StatusDocument;

    expect(working.concurrency).toMatchObject({ dispatcherState: 'running', dispatcherRunId: 'wf_example-run-2' });
    expect(full.concurrency).toMatchObject({ dispatcherState: 'running', dispatcherRunId: 'wf_example-run-2' });
    expect(full.dispatcherRunId).toBe('wf_example-run-2');

    await run(['dispatcher', 'finished']);

    expect(Object.keys((JSON.parse((await run(['status', '--json'])).outputText()) as StatusDocument).concurrency)).not.toContain('dispatcherRunId');
  });

  // A dispatcher starts each ready ticket's agents on what this list says, so it must name the same tickets in the same order as `readyTicketIds`.
  test('readyTickets resolves each ready ticket to its priority, model and effort, in the ready order', async () => {
    await run(['ticket', 'add', 'Show the role history', '--model', 'sonnet', '--effort', 'high']);
    await run(['ticket', 'add', 'Export the roles', '--depends-on', '1']);
    await run(['ticket', 'add', 'Import the roles', '--priority', 'high', '--effort', 'low']);
    await run(['ticket', 'add', 'Rename the roles', '--priority', 'low']);

    const working = JSON.parse((await run(['status', '--json'])).outputText()) as StatusDocument;
    const full    = JSON.parse((await run(['status', '--json', '--full'])).outputText()) as StatusDocument;

    const expected = [
      {
        id:       '004',
        priority: 'high',
        model:    'opus',
        effort:   'low',
      },
      {
        id:       '002',
        priority: 'normal',
        model:    'sonnet',
        effort:   'high',
      },
    ];
    expect(working.readyTickets).toEqual(expected);
    expect(full.readyTickets).toEqual(expected);
    expect(working.readyTickets.map((ready) => ready.id)).toEqual(working.concurrency.readyTicketIds);
  });

  // The group run reads the group off the entry; a whole-board run must not take a ticket of a group awaiting its release.
  test('readyTickets carries a grouped ticket\'s group, and leaves a group out while it has a release ticket', async () => {
    await run(['ticket', 'add', 'Show the role history', '--group', 'example-group']);
    await run(['ticket', 'add', 'Export the roles', '--group', 'example-group']);
    await run(['ticket', 'add', 'Import the roles']);

    const beforeTheMark = JSON.parse((await run(['status', '--json'])).outputText()) as StatusDocument;
    await run(['ticket', 'release-of', '3']);
    const afterTheMark = JSON.parse((await run(['status', '--json', '--full'])).outputText()) as StatusDocument;

    expect(beforeTheMark.readyTickets.map((ready) => [ready.id, ready.group ?? null])).toEqual([['002', 'example-group'], ['003', 'example-group'], ['004', null]]);
    expect(Object.keys(beforeTheMark.readyTickets[2] ?? {})).not.toContain('group');
    expect(afterTheMark.readyTickets.map((ready) => ready.id)).toEqual(['004']);
    expect(afterTheMark.concurrency.readyTicketIds).toEqual(['004']);
  });

  test('readyTickets is empty exactly when nothing is ready', async () => {
    const working = JSON.parse((await run(['status', '--json'])).outputText()) as StatusDocument;

    expect(working.concurrency.readyTicketIds).toEqual([]);
    expect(working.readyTickets).toEqual([]);
  });
});

describeWhenGitIsPresent('the dispatch fields both --json documents carry', () => {
  async function bothDocuments(): Promise<{ working: StatusDocument; full: StatusDocument }> {
    const working = JSON.parse((await run(['status', '--json'])).outputText()) as StatusDocument;
    const full    = JSON.parse((await run(['status', '--json', '--full'])).outputText()) as StatusDocument;
    return { working, full };
  }

  // Older readers key on the document as it was, so the new fields only ever come after every key it carried before.
  test('come last in both documents, after every key in the order the documents had before', async () => {
    const { working, full } = await bothDocuments();
    const progressKeys      = ['version', 'trackerId', 'project', 'startedAt', 'view', 'nextTaskId', 'concurrencyLimit', 'tasks', 'log'];
    const dispatchKeys      = ['reviewWaitingTickets', 'pausedBuilds', 'ticketRows', 'tokensByOwner'];

    expect(Object.keys(working)).toEqual([...progressKeys, 'tickets', 'concurrency', 'readyTickets', 'omitted', ...dispatchKeys]);
    expect(Object.keys(full)).toEqual([...progressKeys, 'tickets', 'concurrency', 'readyTickets', ...dispatchKeys]);
  });

  test('the ids in flight end the concurrency block, after the stored run id', async () => {
    await run(['dispatcher', 'running', '--run', 'wf_example-run-2']);

    const { working, full } = await bothDocuments();
    const expectedKeys      = [
      'limit',
      'agentsInFlight',
      'freeSlots',
      'readyTicketIds',
      'dispatcherState',
      'heldTicketIds',
      'dispatcherRunId',
      'inProgressTicketIds',
      'inProgressReviewOfIds',
    ];

    expect(Object.keys(working.concurrency)).toEqual(expectedKeys);
    expect(Object.keys(full.concurrency)).toEqual(expectedKeys);
  });

  test('a claimed ticket is in flight', async () => {
    await run(['concurrency', '5']);
    await run(['ticket', 'add', 'Show the role history']);
    await run(['ticket', 'claim', '2', '--owner', 'Alex Example']);

    const { working, full } = await bothDocuments();

    expect(working.concurrency.inProgressTicketIds).toEqual(['001', '002']);
    expect(full.concurrency.inProgressTicketIds).toEqual(['001', '002']);
  });

  // A review started with the move is a reviewer at work; one finished without it waits for a reviewer the dispatcher starts on these settings.
  test('finish --start-review puts the ticket\'s review in flight, while a plain finish leaves it waiting with its agents resolved', async () => {
    await run(['concurrency', '5']);
    await run(['ticket', 'add', 'Show the role history', '--model', 'sonnet']);
    await run(['ticket', 'claim', '2']);
    await run(['ticket', 'finish', '1', '--start-review', '--owner', 'Alex Example']);
    await run(['ticket', 'finish', '2']);

    const { working, full } = await bothDocuments();

    expect(working.concurrency.inProgressReviewOfIds).toEqual(['001']);
    expect(working.reviewWaitingTickets).toEqual([{ id: '002', model: 'sonnet', effort: 'medium' }]);
    expect(full.concurrency.inProgressReviewOfIds).toEqual(['001']);
    expect(full.reviewWaitingTickets).toEqual(working.reviewWaitingTickets);
  });

  test('a claimed ticket whose row was paused is a paused build, with the row\'s note', async () => {
    await run(['concurrency', '5']);
    await run(['ticket', 'add', 'Show the role history', '--priority', 'high']);
    await run(['ticket', 'claim', '2', '--note', 'Claimed by Alex Example']);
    await run(['task', 'pause', '3', '--note', 'Waiting on Example Agency']);

    const { working, full } = await bothDocuments();
    const expected          = [{
      id:       '002',
      note:     'Waiting on Example Agency',
      priority: 'high',
      model:    'opus',
      effort:   'medium',
    }];

    expect(working.pausedBuilds).toEqual(expected);
    expect(full.pausedBuilds).toEqual(expected);
  });

  test('ticketRows covers the tickets each document lists, with the ticket\'s row and its review bar\'s round', async () => {
    await run(['ticket', 'add', 'Rename the export button']);
    await run(['ticket', 'abandon', '2', '--reason', 'Out of scope']);
    await run(['ticket', 'finish', '1', '--start-review', '--owner', 'Alex Example']);

    const { working, full } = await bothDocuments();
    const firstTicketRows   = {
      id:         '001',
      row:        { id: 1, status: 'in-review', note: '' },
      reviewBars: [{ id: 4, status: 'in-progress', round: 1 }],
    };

    expect(working.ticketRows).toEqual([firstTicketRows]);
    expect(full.ticketRows.map((entry) => entry.id)).toEqual(['001', '002']);
    expect(full.ticketRows[0]).toEqual(firstTicketRows);
    expect(full.ticketRows[1]).toMatchObject({ id: '002', row: { id: 3, status: 'abandoned' }, reviewBars: [] });
  });
});
