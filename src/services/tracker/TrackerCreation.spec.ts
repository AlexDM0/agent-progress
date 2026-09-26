/**
 * Creating a tracker on real files: a fresh workspace gets its tickets directory, a version 2 progress file holding what the caller handed
 * in, an empty log.jsonl and a first page; an existing progress file is never replaced, and then nothing else is written or rendered.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {
  afterEach,
  beforeEach,
  expect,
  test,
} from 'bun:test';
import { createScratchDirectory, removeScratchDirectory } from '../../testing/ScratchWorkspace.ts';
import { createTracker, type NewTracker }                 from './TrackerCreation.ts';
import { workspacePathsFor, type Workspace }              from './Workspace.ts';

const NEW_TRACKER: NewTracker = {
  project:   'Example Agency',
  startedAt: '2026-09-18T09:00:00+02:00',
  trackerId: 'example-tracker-id',
};

const EXISTING_PROGRESS_TEXT = '{"version":2,"project":"Kept by hand"}\n';

const EXISTING_LOG_TEXT = '{"at":"2026-09-18T20:05:00+02:00","kind":"note","fields":{"text":"Kept by hand"}}\n';

const now = (): Date => new Date('2026-09-18T07:00:00Z');

let workspace: Workspace;

beforeEach(() => {
  workspace = workspacePathsFor(createScratchDirectory('tracker-creation'));
});

afterEach(() => {
  removeScratchDirectory(workspace.rootDirectory);
});

test('a fresh workspace gets its tickets directory, a version 2 progress file, an empty log and a first page, and answers created', async () => {
  const creation = await createTracker(workspace, NEW_TRACKER, now);

  expect(creation).toEqual({ verdict: 'created', renderOutcome: { verdict: 'rendered', malformedTickets: [] } });
  expect(statSync(workspace.ticketsDirectory).isDirectory()).toBe(true);
  expect(JSON.parse(readFileSync(workspace.progressFilePath, 'utf8'))).toMatchObject({ version: 2, ...NEW_TRACKER, tasks: [] });
  expect(readFileSync(workspace.logFilePath, 'utf8')).toBe('');
  expect(readFileSync(workspace.htmlFilePath, 'utf8')).toContain('Example Agency');
});

test('a log.jsonl left from a removed tracker is emptied, never adopted', async () => {
  mkdirSync(workspace.trackerDirectory, { recursive: true });
  writeFileSync(workspace.logFilePath, EXISTING_LOG_TEXT);

  await createTracker(workspace, NEW_TRACKER, now);

  expect(readFileSync(workspace.logFilePath, 'utf8')).toBe('');
});

test('an existing progress file answers already-exists, leaves progress.json and log.jsonl byte for byte, and writes no page', async () => {
  mkdirSync(workspace.trackerDirectory, { recursive: true });
  writeFileSync(workspace.progressFilePath, EXISTING_PROGRESS_TEXT);
  writeFileSync(workspace.logFilePath, EXISTING_LOG_TEXT);

  expect(await createTracker(workspace, NEW_TRACKER, now)).toEqual({ verdict: 'already-exists' });
  expect(readFileSync(workspace.progressFilePath, 'utf8')).toBe(EXISTING_PROGRESS_TEXT);
  expect(readFileSync(workspace.logFilePath, 'utf8')).toBe(EXISTING_LOG_TEXT);
  expect(existsSync(workspace.htmlFilePath)).toBe(false);
});
