/**
 * The store's concerns: what it refuses to believe, that a task id is never handed out twice, and that a move lands in the record
 * a caller holds. What a move and a filing do to a row is pinned against the tracker model's own utils.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { afterAll, expect, test }                 from 'bun:test';

import type { ProgressFile }                              from '../../src/lib/tracker-model/@types/ProgressFile';
import { ConcurrencyUtil }                                from '../../src/lib/tracker-model/utils/ConcurrencyUtil';
import { createScratchDirectory, removeScratchDirectory } from '../../src/testing/ScratchWorkspace';
import { workspacePathsFor }                              from '../platform/Workspace';
import type { Workspace }                                 from '../platform/Workspace';
import {
  addTask,
  appendLogEntry,
  createEmptyProgressFile,
  findTask,
  readProgressFile,
  removeTask,
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
  const concurrency = result.verdict === 'readable' ? ConcurrencyUtil.concurrencyOf(result.progress.tasks, result.progress.concurrencyLimit) : null;
  expect(concurrency).toEqual({ limit: 2, agentsInFlight: 0, freeSlots: 2 });
});

test('a concurrency limit that is not a whole number of at least 1 makes the file unreadable, and the reason names the field', () => {
  for (const malformedLimit of [0, -1, 2.5, '3', null]) {
    const result = readBack('store-malformed-limit', { ...emptyProgress(), concurrencyLimit: malformedLimit });
    expect(result.verdict === 'unreadable' ? result.reason : '', JSON.stringify(malformedLimit)).toContain('concurrencyLimit');
  }
});

// Every review row filed before the field existed has none; the page falls back to its name, and a read must not add the field.
test('a row without reviewOf reads unchanged, and addTask writes the field only when it is given one', () => {
  const progress = emptyProgress();
  const plain    = addTask(progress, { name: 'Review 1 #3 — x' });
  const linked   = addTask(progress, { name: 'Review 2 #3 — x', reviewOf: '003' });
  expect('reviewOf' in plain).toBe(false);
  expect(linked.reviewOf).toBe('003');

  const result = readBack('store-review-of', progress);
  expect(result.verdict === 'readable' ? result.progress : null).toEqual(progress);
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
    { prefix: 'store-history-not-array', document: { ...progress, tasks: [{ ...progress.tasks[0], history: 'in-progress' }] }, named: 'tasks[0].history' },
    {
      prefix:   'store-history-unknown-status',
      document: { ...progress, tasks: [{ ...progress.tasks[0], history: [{ status: 'blocked', at: FILED_AT }] }] },
      named:    'tasks[0].history',
    },
    { prefix: 'store-history-no-stamp', document: { ...progress, tasks: [{ ...progress.tasks[0], history: [{ status: 'in-progress' }] }] }, named: 'tasks[0].history' },
    {
      prefix:   'store-agent-not-text',
      document: { ...progress, tasks: [{ ...progress.tasks[0], agent: 3 }] },
      named:    'tasks[0].agent',
    },
    {
      prefix:   'store-review-of-not-text',
      document: { ...progress, tasks: [{ ...progress.tasks[0], reviewOf: 3 }] },
      named:    'tasks[0].reviewOf',
    },
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

test('a task is found by id, and a missing one is undefined rather than an exception', () => {
  const progress = emptyProgress();
  addTask(progress, { name: 'Review pass' });
  expect(findTask(progress, 1)?.name).toBe('Review pass');
  expect(findTask(progress, 99)).toBeUndefined();
});

test('a round of two or more is read back, because that is a row someone deliberately sent round again', () => {
  const progress = emptyProgress();
  addTask(progress, { name: 'Review pass' });
  const document = { ...progress, tasks: [{ ...progress.tasks[0], reviewRound: 3 }] };
  expect(readBack('store-third-round', document).verdict).toBe('readable');
});

test('a history of known statuses with their stamps is read back', () => {
  const progress = emptyProgress();
  addTask(progress, { name: 'Review pass' });
  const document = { ...progress, tasks: [{ ...progress.tasks[0], history: [{ status: 'in-progress', at: STARTED_AT }] }] };
  expect(readBack('store-history-readable', document).verdict).toBe('readable');
});

/** A file written before the task statuses were renamed: these inputs keep the retired words on purpose. */
function documentInRetiredWords(): ProgressFile {
  const progress = emptyProgress();
  addTask(progress, { name: 'Example build' });
  addTask(progress, { name: 'Example review' });
  const [building, reviewing] = progress.tasks;
  return {
    ...progress,
    tasks: [
      { ...building, status: 'running', history: [{ status: 'pending', at: FILED_AT }, { status: 'running', at: STARTED_AT }] },
      { ...reviewing, status: 'finished', history: [{ status: 'running', at: STARTED_AT }, { status: 'finished', at: FINISHED_AT }] },
    ],
  } as unknown as ProgressFile;
}

// A tracker written before the rename must keep working, rows and the phases the page draws alike.
test('a stored running or finished row and history phase reads as in-progress or in-review', () => {
  const result = readBack('store-retired-words', documentInRetiredWords());
  if (result.verdict !== 'readable') throw new Error(`expected a readable file, got ${JSON.stringify(result)}`);
  expect(result.progress.tasks.map((task) => task.status)).toEqual(['in-progress', 'in-review']);
  expect(result.progress.tasks.map((task) => task.history?.map((phase) => phase.status))).toEqual([['pending', 'in-progress'], ['in-progress', 'in-review']]);
});

// `status` and `render` only read, and a read that rewrote the file would race an agent writing it from another worktree.
test('reading a file in the retired words leaves its bytes as they were', () => {
  const workspace = scratchWorkspace('store-retired-words-untouched');
  const storedText = JSON.stringify(documentInRetiredWords(), null, 2);
  writeFileSync(workspace.progressFilePath, storedText);
  expect(readProgressFile(workspace).verdict).toBe('readable');
  expect(readFileSync(workspace.progressFilePath, 'utf8')).toBe(storedText);
});

test('the next write of a file read in the retired words stores the new ones', () => {
  const workspace = scratchWorkspace('store-retired-words-rewritten');
  writeFileSync(workspace.progressFilePath, JSON.stringify(documentInRetiredWords()));
  const result = readProgressFile(workspace);
  if (result.verdict !== 'readable') throw new Error(`expected a readable file, got ${JSON.stringify(result)}`);
  writeProgressFile(workspace, result.progress);
  const rewrittenText = readFileSync(workspace.progressFilePath, 'utf8');
  expect(rewrittenText).toContain('"in-progress"');
  expect(rewrittenText).toContain('"in-review"');
  expect(rewrittenText).not.toContain('"running"');
  expect(rewrittenText).not.toContain('"finished"');
});

// Only the two retired task words map: a ticket's retired word on a row is as unknown as any other, in the row and in its history.
test('a status that is neither current nor a retired task word still makes the file unreadable, naming the field', () => {
  const progress = emptyProgress();
  addTask(progress, { name: 'Review pass' });
  const unknownRowStatus = readBack('store-retired-ticket-word', { ...progress, tasks: [{ ...progress.tasks[0], status: 'open' }] });
  expect(unknownRowStatus.verdict).toBe('unreadable');
  expect(unknownRowStatus.verdict === 'unreadable' ? unknownRowStatus.reason : '').toContain('tasks[0].status');

  const unknownPhase = readBack('store-retired-ticket-word-phase', { ...progress, tasks: [{ ...progress.tasks[0], history: [{ status: 'done', at: STARTED_AT }] }] });
  expect(unknownPhase.verdict).toBe('unreadable');
  expect(unknownPhase.verdict === 'unreadable' ? unknownPhase.reason : '').toContain('tasks[0].history');
});

// Callers hold the row across a move and read or annotate it afterwards, so the move must land in that same record, its keys where they were.
test('a transition moves the row the caller holds, keeping its keys where the file stores them', () => {
  const progress = emptyProgress();
  const held     = addTask(progress, { name: 'Bundle part', filedAt: FILED_AT });
  held.agent     = '003,004';

  expect(transitionTask(progress, held.id, 'in-review', FINISHED_AT)).toBe('applied');
  expect(progress.tasks[0]).toBe(held);
  expect(held.status).toBe('in-review');
  expect(Object.keys(held)).toEqual(['id', 'name', 'status', 'start', 'end', 'owner', 'note', 'ticket', 'tokens', 'history', 'agent']);

  transitionTask(progress, held.id, 'in-progress', STARTED_AT);
  expect(held.agent, 'a restart drops the key from the held record itself').toBeUndefined();
  expect('agent' in held).toBe(false);
});

test('a transition on a task that is not there says so instead of throwing', () => {
  expect(transitionTask(emptyProgress(), 99, 'in-progress', STARTED_AT)).toBe('no-such-task');
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
