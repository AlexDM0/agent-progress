/**
 * The store's four concerns: what it refuses to believe, what it does to a task's timestamps, which
 * moves it files as a phase, and that a task id is never handed out twice.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { afterAll, expect, test }                 from 'bun:test';

import type { ProgressFile }                              from '../constants/Types';
import { workspacePathsFor }                              from '../platform/Workspace';
import type { Workspace }                                 from '../platform/Workspace';
import { createScratchDirectory, removeScratchDirectory } from '../tooling/dev/ScratchWorkspace';
import {
  addTask,
  appendLogEntry,
  concurrencyOf,
  createEmptyProgressFile,
  findTask,
  readProgressFile,
  removeTask,
  setTaskTokens,
  transitionTask,
  writeProgressFile
} from './ProgressStore';

const FILED_AT = '2026-09-18T20:11:03+02:00';
const STARTED_AT = '2026-09-18T20:40:00+02:00';
const FINISHED_AT = '2026-09-18T21:05:00+02:00';

const scratchDirectories: string[] = [];

afterAll(() => {
  for (const directory of scratchDirectories) removeScratchDirectory(directory);
});

function scratchWorkspace(prefix: string): Workspace {
  const rootDirectory = createScratchDirectory(prefix);
  scratchDirectories.push(rootDirectory);
  const workspace = workspacePathsFor(rootDirectory);
  mkdirSync(workspace.trackerDirectory, { recursive: true });
  return workspace;
}

function emptyProgress(): ProgressFile {
  return createEmptyProgressFile({ project: 'Example Agency', startedAt: FILED_AT, trackerId: 'example-tracker-id' });
}

function readBack(prefix: string, document: unknown): ReturnType<typeof readProgressFile> {
  const workspace = scratchWorkspace(prefix);
  writeFileSync(workspace.progressFilePath, typeof document === 'string' ? document : JSON.stringify(document));
  return readProgressFile(workspace);
}

test('a new tracker starts at version 1, with the caller\'s id, an automatic view and an unused id counter', () => {
  const progress = emptyProgress();
  expect(progress.version).toBe(1);
  expect(progress.trackerId).toBe('example-tracker-id');
  expect(progress.project).toBe('Example Agency');
  expect(progress.startedAt).toBe(FILED_AT);
  expect(progress.view).toEqual({ kind: 'auto' });
  expect(progress.nextTaskId).toBe(1);
  expect(progress.concurrencyLimit).toBe(2);
  expect(progress.tasks).toEqual([]);
  expect(progress.log).toEqual([]);
});

test('a tracker that has never been initialised is absent, not unreadable', () => {
  expect(readProgressFile(scratchWorkspace('store-absent')).verdict).toBe('absent');
});

test('a written tracker reads back exactly as it was written', () => {
  const workspace = scratchWorkspace('store-round-trip');
  const progress = emptyProgress();
  addTask(progress, { name: 'Review pass', owner: 'Alex Example', note: 'second reading' });
  appendLogEntry(progress, FILED_AT, 'Session started');
  writeProgressFile(workspace, progress);

  const result = readProgressFile(workspace);
  expect(result.verdict).toBe('readable');
  expect(result.verdict === 'readable' ? result.progress : null).toEqual(progress);
});

test('the file on disk is indented and ends with a newline, because people repair it by hand', () => {
  const workspace = scratchWorkspace('store-formatting');
  writeProgressFile(workspace, emptyProgress());
  const onDisk = readFileSync(workspace.progressFilePath, 'utf8');
  expect(onDisk.endsWith('\n')).toBe(true);
  expect(onDisk).toContain('\n  "version": 1');
});

test('a file that is not JSON is unreadable and says so', () => {
  const result = readBack('store-not-json', '{ this is not json');
  expect(result.verdict).toBe('unreadable');
  expect(result.verdict === 'unreadable' ? result.reason : '').toContain('not valid JSON');
});

test('a document from a future format version is refused rather than half-read', () => {
  const result = readBack('store-future-version', { ...emptyProgress(), version: 2 });
  expect(result.verdict).toBe('unreadable');
  expect(result.verdict === 'unreadable' ? result.reason : '').toContain('version');
});

// Every tracker filed before the limit existed has no such field, and must go on reading rather than stop every command in its repository.
test('a document with no concurrency limit reads, and its figures fall back to the default of 2', () => {
  const withoutLimit = emptyProgress();
  delete withoutLimit.concurrencyLimit;
  const result = readBack('store-no-limit', withoutLimit);
  expect(result.verdict).toBe('readable');
  expect(result.verdict === 'readable' ? concurrencyOf(result.progress) : null).toEqual({ limit: 2, inFlight: 0, freeSlots: 2 });
});

test('a concurrency limit that is not a whole number of at least 1 makes the file unreadable, and the reason names the field', () => {
  for (const malformedLimit of [0, -1, 2.5, '3', null]) {
    const result = readBack('store-malformed-limit', { ...emptyProgress(), concurrencyLimit: malformedLimit });
    expect(result.verdict === 'unreadable' ? result.reason : '', JSON.stringify(malformedLimit)).toContain('concurrencyLimit');
  }
});

test('only running rows are in flight, and the free slots never go below zero', () => {
  const progress = { ...emptyProgress(), concurrencyLimit: 1 };
  addTask(progress, { name: 'Review pass one', status: 'running', start: STARTED_AT });
  addTask(progress, { name: 'Review pass two', status: 'running', start: STARTED_AT });
  addTask(progress, { name: 'Paused chore', status: 'paused', start: STARTED_AT });
  addTask(progress, { name: 'Queued chore' });
  expect(concurrencyOf(progress)).toEqual({ limit: 1, inFlight: 2, freeSlots: 0 });
});

test('a task whose status this build does not know makes the whole file unreadable, and the reason names the task and the status', () => {
  const progress = emptyProgress();
  addTask(progress, { name: 'Review pass' });
  const document = { ...progress, tasks: [{ ...progress.tasks[0], status: 'blocked' }] };
  const result = readBack('store-unknown-status', document);
  expect(result.verdict).toBe('unreadable');
  const reason = result.verdict === 'unreadable' ? result.reason : '';
  expect(reason).toContain('tasks[0].status');
  expect(reason).toContain('blocked');
  expect(reason, 'the reason lists what a status may be').toContain('delivered');
});

test('every other missing or mistyped field is named too', () => {
  const progress = emptyProgress();
  addTask(progress, { name: 'Review pass' });
  const cases: Array<{ prefix: string; document: unknown; named: string }> = [
    { prefix: 'store-not-an-object', document: [1, 2, 3], named: 'JSON object' },
    { prefix: 'store-no-tracker-id', document: { ...progress, trackerId: 17 }, named: 'trackerId' },
    { prefix: 'store-no-project', document: { ...progress, project: null }, named: 'project' },
    { prefix: 'store-no-started-at', document: { ...progress, startedAt: undefined }, named: 'startedAt' },
    { prefix: 'store-bad-view', document: { ...progress, view: { kind: 'sliding' } }, named: 'view' },
    { prefix: 'store-tasks-not-array', document: { ...progress, tasks: {} }, named: 'tasks' },
    { prefix: 'store-log-not-array', document: { ...progress, log: 'none' }, named: 'log' },
    { prefix: 'store-task-id', document: { ...progress, tasks: [{ ...progress.tasks[0], id: '1' }] }, named: 'tasks[0].id' },
    { prefix: 'store-task-start', document: { ...progress, tasks: [{ ...progress.tasks[0], start: 17 }] }, named: 'tasks[0].start' },
    { prefix: 'store-task-ticket', document: { ...progress, tasks: [{ ...progress.tasks[0], ticket: 3 }] }, named: 'tasks[0].ticket' },
    { prefix: 'store-log-entry', document: { ...progress, log: [{ at: FILED_AT }] }, named: 'log[0].text' },
    { prefix: 'store-no-next-id', document: { ...progress, nextTaskId: undefined }, named: 'nextTaskId' },
    { prefix: 'store-zero-next-id', document: { ...progress, nextTaskId: 0 }, named: 'nextTaskId' },
    { prefix: 'store-task-tokens', document: { ...progress, tasks: [{ ...progress.tasks[0], tokens: -1 }] }, named: 'tasks[0].tokens' },
    { prefix: 'store-task-reviewed', document: { ...progress, tasks: [{ ...progress.tasks[0], reviewed: true }] }, named: 'tasks[0].reviewed' },
    { prefix: 'store-fractional-tokens', document: { ...progress, tasks: [{ ...progress.tasks[0], tokens: 1.5 }] }, named: 'tasks[0].tokens' },
    { prefix: 'store-first-review-round', document: { ...progress, tasks: [{ ...progress.tasks[0], reviewRound: 1 }] }, named: 'tasks[0].reviewRound' },
    { prefix: 'store-fractional-round', document: { ...progress, tasks: [{ ...progress.tasks[0], reviewRound: 2.5 }] }, named: 'tasks[0].reviewRound' },
    { prefix: 'store-written-round', document: { ...progress, tasks: [{ ...progress.tasks[0], reviewRound: 'second' }] }, named: 'tasks[0].reviewRound' },
    { prefix: 'store-history-not-array', document: { ...progress, tasks: [{ ...progress.tasks[0], history: 'running' }] }, named: 'tasks[0].history' },
    {
      prefix:   'store-history-unknown-status',
      document: { ...progress, tasks: [{ ...progress.tasks[0], history: [{ status: 'blocked', at: FILED_AT }] }] },
      named:    'tasks[0].history',
    },
    { prefix: 'store-history-no-stamp', document: { ...progress, tasks: [{ ...progress.tasks[0], history: [{ status: 'running' }] }] }, named: 'tasks[0].history' },
  ];
  for (const { prefix, document, named } of cases) {
    const result = readBack(prefix, document);
    expect(result.verdict, named).toBe('unreadable');
    expect(result.verdict === 'unreadable' ? result.reason : '', named).toContain(named);
  }
});

test('an absolute view range with its fields intact is accepted, because that is a range someone stored on purpose', () => {
  const stored = {
    ...emptyProgress(),
    view: {
      kind: 'absolute', from: FILED_AT, to: FINISHED_AT, tickMinutes: 15 
    } 
  };
  expect(readBack('store-absolute-view', stored).verdict).toBe('readable');
  const relative = {
    ...emptyProgress(),
    view: {
      kind: 'relative', from: '-2h', to: 'now', tickMinutes: null 
    } 
  };
  expect(readBack('store-relative-view', relative).verdict).toBe('readable');
});

test('ids start at one and the counter moves past every id it hands out', () => {
  const progress = emptyProgress();
  expect(addTask(progress, { name: 'Plan the work' }).id).toBe(1);
  expect(addTask(progress, { name: 'Review pass' }).id).toBe(2);
  expect(progress.nextTaskId).toBe(3);
});

test('an id is never reused after the row that had it is removed', () => {
  const progress = emptyProgress();
  addTask(progress, { name: 'Plan the work' });
  const second = addTask(progress, { name: 'Review pass' });
  removeTask(progress, second.id);
  expect(addTask(progress, { name: 'A third thing' }).id).toBe(3);
});

test('an id is never reused after the rows are thrown away, which is what clear does', () => {
  const progress = emptyProgress();
  addTask(progress, { name: 'Plan the work' });
  addTask(progress, { name: 'Review pass' });
  progress.tasks.length = 0;
  expect(addTask(progress, { name: 'Re-seeded from a ticket' }).id).toBe(3);
});

test('a hand-renumbered row cannot be handed its own id by the next allocation', () => {
  const progress = emptyProgress();
  const onlyRow = addTask(progress, { name: 'Plan the work' });
  onlyRow.id = 40;
  expect(addTask(progress, { name: 'Review pass' }).id).toBe(41);
});

test('a task filed with nothing but a name gets the defaults a fresh row has', () => {
  const task = addTask(emptyProgress(), { name: 'Review pass' });
  expect(task).toEqual({
    id:     1,
    name:   'Review pass',
    status: 'pending',
    start:  null,
    end:    null,
    owner:  '',
    note:   '',
    ticket: null,
    tokens: null,
  });
});

test('a token count is recorded, replaced by a later report, and kept apart from zero', () => {
  const progress = emptyProgress();
  const task = addTask(progress, { name: 'Rewrite the importer', tokens: 12_000 });
  expect(task.tokens).toBe(12_000);
  expect(setTaskTokens(progress, task.id, 18_500)).toBe('applied');
  expect(task.tokens).toBe(18_500);
  expect(setTaskTokens(progress, task.id, 0)).toBe('applied');
  expect(task.tokens).toBe(0);
  expect(setTaskTokens(progress, 99, 100)).toBe('no-such-task');
});

test('a task filed with everything keeps everything', () => {
  const task = addTask(emptyProgress(), {
    name:   'Double-click a role to edit it',
    owner:  'Alex Example',
    note:   'driven by ticket 003',
    ticket: '003',
    status: 'running',
    start:  STARTED_AT,
    end:    null,
  });
  expect(task.ticket).toBe('003');
  expect(task.status).toBe('running');
  expect(task.start).toBe(STARTED_AT);
});

test('a task is found by id, and a missing one is undefined rather than an exception', () => {
  const progress = emptyProgress();
  addTask(progress, { name: 'Review pass' });
  expect(findTask(progress, 1)?.name).toBe('Review pass');
  expect(findTask(progress, 99)).toBeUndefined();
});

test('starting a task sets its start and clears any end it had', () => {
  const progress = emptyProgress();
  const task = addTask(progress, {
    name: 'Review pass', status: 'finished', start: STARTED_AT, end: FINISHED_AT 
  });
  expect(transitionTask(progress, task.id, 'running', '2026-09-18T21:30:00+02:00')).toBe('applied');
  expect(task.start).toBe(STARTED_AT);
  expect(task.end).toBeNull();
  expect(task.status).toBe('running');
});

test('pausing keeps the start and clears the end, and starting again resumes the same bar', () => {
  const progress = emptyProgress();
  const task = addTask(progress, { name: 'Waiting on the user', status: 'running', start: STARTED_AT });
  expect(transitionTask(progress, task.id, 'paused', FINISHED_AT)).toBe('applied');
  expect(task.status).toBe('paused');
  expect(task.start).toBe(STARTED_AT);
  expect(task.end).toBeNull();

  transitionTask(progress, task.id, 'running', '2026-09-18T21:30:00+02:00');
  expect(task.start).toBe(STARTED_AT);
  expect(task.end).toBeNull();
});

test('pausing a task that never ran stamps its start, so the bar is drawn from the pause', () => {
  const progress = emptyProgress();
  const task = addTask(progress, { name: 'Blocked before it began' });
  transitionTask(progress, task.id, 'paused', STARTED_AT);
  expect(task.start).toBe(STARTED_AT);
  expect(task.end).toBeNull();
});

test('starting a task that has never run sets its start to the moment given', () => {
  const progress = emptyProgress();
  const task = addTask(progress, { name: 'Review pass' });
  transitionTask(progress, task.id, 'running', STARTED_AT);
  expect(task.start).toBe(STARTED_AT);
  expect(task.end).toBeNull();
});

test('finishing, reviewing and delivering all close the bar and back-fill a missing start', () => {
  for (const status of ['finished', 'reviewed', 'delivered'] as const) {
    const progress = emptyProgress();
    const task = addTask(progress, { name: `Row taken straight to ${status}` });
    expect(transitionTask(progress, task.id, status, FINISHED_AT)).toBe('applied');
    expect(task.status, status).toBe(status);
    expect(task.start, status).toBe(FINISHED_AT);
    expect(task.end, status).toBe(FINISHED_AT);
  }
});

test('a second finish does not quietly extend the bar to now', () => {
  const progress = emptyProgress();
  const task = addTask(progress, { name: 'Review pass', status: 'running', start: STARTED_AT });
  transitionTask(progress, task.id, 'finished', FINISHED_AT);
  transitionTask(progress, task.id, 'finished', '2026-09-19T09:00:00+02:00');
  expect(task.start).toBe(STARTED_AT);
  expect(task.end).toBe(FINISHED_AT);
});

test('abandoning a task that had started closes its bar', () => {
  const progress = emptyProgress();
  const task = addTask(progress, { name: 'Review pass', status: 'running', start: STARTED_AT });
  transitionTask(progress, task.id, 'abandoned', FINISHED_AT);
  expect(task.start).toBe(STARTED_AT);
  expect(task.end).toBe(FINISHED_AT);
  expect(task.status).toBe('abandoned');
});

test('abandoning a task that never started leaves it with no timestamps at all', () => {
  const progress = emptyProgress();
  const task = addTask(progress, { name: 'Called off before it began' });
  transitionTask(progress, task.id, 'abandoned', FINISHED_AT);
  expect(task.start).toBeNull();
  expect(task.end).toBeNull();
  expect(task.status).toBe('abandoned');
});

test('putting a task back to pending clears both timestamps', () => {
  const progress = emptyProgress();
  const task = addTask(progress, {
    name: 'Review pass', status: 'finished', start: STARTED_AT, end: FINISHED_AT 
  });
  transitionTask(progress, task.id, 'pending', '2026-09-19T09:00:00+02:00');
  expect(task.start).toBeNull();
  expect(task.end).toBeNull();
  expect(task.status).toBe('pending');
});

test('reviewing stamps the review once, and delivery keeps it so the delivered row still says it was reviewed', () => {
  const progress = emptyProgress();
  const task     = addTask(progress, {
    name: 'Review pass', status: 'finished', start: STARTED_AT, end: FINISHED_AT 
  });
  transitionTask(progress, task.id, 'reviewed', FINISHED_AT);
  transitionTask(progress, task.id, 'reviewed', '2026-09-19T09:00:00+02:00');
  transitionTask(progress, task.id, 'delivered', '2026-09-19T10:00:00+02:00');
  expect(task.reviewed).toBe(FINISHED_AT);
});

test('a round of two or more is read back, because that is a row someone deliberately sent round again', () => {
  const progress = emptyProgress();
  addTask(progress, { name: 'Review pass' });
  const document = { ...progress, tasks: [{ ...progress.tasks[0], reviewRound: 3 }] };
  expect(readBack('store-third-round', document).verdict).toBe('readable');
});

test('a repeat review counts from the second round upwards and leaves the bar where the first review closed it', () => {
  const progress = emptyProgress();
  const task     = addTask(progress, {
    name: 'Review pass', status: 'finished', start: STARTED_AT, end: FINISHED_AT
  });
  expect(transitionTask(progress, task.id, 're-review', '2026-09-19T09:00:00+02:00')).toBe('applied');
  expect(task.status).toBe('re-review');
  expect(task.reviewRound).toBe(2);
  expect(task.end).toBe(FINISHED_AT);

  transitionTask(progress, task.id, 're-review', '2026-09-19T10:00:00+02:00');
  expect(task.reviewRound).toBe(3);
  expect(task.end).toBe(FINISHED_AT);
});

test('the round is kept as history once the row is reviewed and delivered', () => {
  const progress = emptyProgress();
  const task     = addTask(progress, {
    name: 'Review pass', status: 're-review', start: STARTED_AT, end: FINISHED_AT, reviewRound: 3
  });
  transitionTask(progress, task.id, 'reviewed', '2026-09-19T09:00:00+02:00');
  expect(task.reviewRound).toBe(3);

  transitionTask(progress, task.id, 'delivered', '2026-09-19T10:00:00+02:00');
  expect(task.reviewRound).toBe(3);
});

test('putting a row that was on its third pass back to pending drops the round with the review stamp', () => {
  const progress = emptyProgress();
  const task     = addTask(progress, {
    name: 'Review pass', status: 're-review', start: STARTED_AT, end: FINISHED_AT, reviewRound: 3
  });
  transitionTask(progress, task.id, 'pending', '2026-09-19T09:00:00+02:00');
  expect(task.reviewRound).toBeUndefined();
  expect(task.status).toBe('pending');
});

test('a task delivered straight from finished carries no review stamp', () => {
  const progress = emptyProgress();
  const task     = addTask(progress, {
    name: 'Review pass', status: 'finished', start: STARTED_AT, end: FINISHED_AT 
  });
  transitionTask(progress, task.id, 'delivered', FINISHED_AT);
  expect(task.reviewed).toBeUndefined();
});

test('putting a reviewed task back to pending drops its review stamp', () => {
  const progress = emptyProgress();
  const task     = addTask(progress, { name: 'Review pass', status: 'reviewed', reviewed: FINISHED_AT });
  transitionTask(progress, task.id, 'pending', '2026-09-19T09:00:00+02:00');
  expect(task.reviewed).toBeUndefined();
});

/**
 * How long a row sat in the queue before anybody picked it up is the interval an orchestrator most wants, and it is
 * measurable only if the filing is a phase of its own. Without a stamp to file it at there is still nothing to record.
 */
test('a row filed as pending records that it was filed, at the moment it was filed', () => {
  const progress = emptyProgress();

  expect(addTask(progress, { name: 'Queued', filedAt: FILED_AT }).history).toEqual([{ status: 'pending', at: FILED_AT }]);
  expect(addTask(progress, { name: 'Queued explicitly', status: 'pending', filedAt: FILED_AT }).history).toEqual([{ status: 'pending', at: FILED_AT }]);
  expect(addTask(progress, { name: 'Filed by a caller that said nothing' }).history).toBeUndefined();
});

// A row filed straight into a later status was in that status from the stamp it was filed with; without a stamp there is nothing to record.
test('a row filed into a status it is already in records that as its first phase, at the stamp that status is kept at', () => {
  const progress = emptyProgress();
  const running  = addTask(progress, {
    name: 'Already going', status: 'running', start: STARTED_AT, end: FINISHED_AT
  });
  const closed   = addTask(progress, {
    name: 'Filed closed', status: 'reviewed', start: STARTED_AT, end: FINISHED_AT
  });

  expect(running.history, 'a running row opened its interval at its start, whatever end it was handed').toEqual([{ status: 'running', at: STARTED_AT }]);
  expect(closed.history, 'the row reached that status when it closed, not when it opened').toEqual([{ status: 'reviewed', at: FINISHED_AT }]);
  expect(addTask(progress, { name: 'No stamp at all', status: 'running' }).history).toBeUndefined();
});

test('every move a row really makes is appended as a phase, oldest first', () => {
  const progress = emptyProgress();
  const task     = addTask(progress, { name: 'Review pass' });
  transitionTask(progress, task.id, 'running', STARTED_AT);
  transitionTask(progress, task.id, 'finished', FINISHED_AT);
  transitionTask(progress, task.id, 'reviewed', '2026-09-19T09:00:00+02:00');

  expect(task.history).toEqual([
    { status: 'running', at: STARTED_AT },
    { status: 'finished', at: FINISHED_AT },
    { status: 'reviewed', at: '2026-09-19T09:00:00+02:00' },
  ]);
});

// The re-run that keeps a stamp from moving must not file a second phase either: nothing happened.
test('repeating a move files no second phase, because the row did not move', () => {
  const progress = emptyProgress();
  const task     = addTask(progress, { name: 'Review pass' });
  transitionTask(progress, task.id, 'finished', FINISHED_AT);
  transitionTask(progress, task.id, 'finished', '2026-09-19T09:00:00+02:00');

  expect(task.history).toEqual([{ status: 'finished', at: FINISHED_AT }]);
});

// The one exception: a row stays in `re-review` between rounds, so counting only status changes would lose every round after the second.
test('a further review round is a phase of its own although the status does not change', () => {
  const progress = emptyProgress();
  const task     = addTask(progress, { name: 'Review pass' });
  transitionTask(progress, task.id, 'finished', FINISHED_AT);
  transitionTask(progress, task.id, 're-review', '2026-09-19T09:00:00+02:00');
  transitionTask(progress, task.id, 're-review', '2026-09-19T10:00:00+02:00');

  expect(task.history?.map((phase) => phase.status)).toEqual(['finished', 're-review', 're-review']);
  expect(task.reviewRound).toBe(3);
});

// The phases are the record of what happened; a row sent back to pending went back, which is itself something that happened.
test('sending a row back to pending files that as a phase and keeps the phases that led there', () => {
  const progress = emptyProgress();
  const task     = addTask(progress, { name: 'Review pass', filedAt: FILED_AT });
  transitionTask(progress, task.id, 'running', STARTED_AT);
  transitionTask(progress, task.id, 'pending', FINISHED_AT);

  expect(task.history).toEqual([
    { status: 'pending', at: FILED_AT },
    { status: 'running', at: STARTED_AT },
    { status: 'pending', at: FINISHED_AT },
  ]);
});

test('a history of known statuses with their stamps is read back', () => {
  const progress = emptyProgress();
  addTask(progress, { name: 'Review pass' });
  const document = { ...progress, tasks: [{ ...progress.tasks[0], history: [{ status: 'running', at: STARTED_AT }] }] };
  expect(readBack('store-history-readable', document).verdict).toBe('readable');
});

test('a transition on a task that is not there says so instead of throwing', () => {
  expect(transitionTask(emptyProgress(), 99, 'running', STARTED_AT)).toBe('no-such-task');
});

test('log entries are appended in order, oldest first', () => {
  const progress = emptyProgress();
  appendLogEntry(progress, FILED_AT, 'Ticket #003 filed: Double-click a role to edit it');
  appendLogEntry(progress, STARTED_AT, 'Ticket #003 started');
  expect(progress.log.map((entry) => entry.text)).toEqual([
    'Ticket #003 filed: Double-click a role to edit it',
    'Ticket #003 started',
  ]);
  expect(progress.log[0]?.at).toBe(FILED_AT);
});

test('removing a task hands the row back, so the caller can find the ticket that owned it', () => {
  const progress = emptyProgress();
  addTask(progress, { name: 'Plan the work' });
  const linked = addTask(progress, { name: 'Double-click a role to edit it', ticket: '003' });
  const removed = removeTask(progress, linked.id);
  expect(removed?.ticket).toBe('003');
  expect(progress.tasks.map((task) => task.name)).toEqual(['Plan the work']);
});

test('removing a task that is not there is undefined rather than an exception', () => {
  expect(removeTask(emptyProgress(), 99)).toBeUndefined();
});
