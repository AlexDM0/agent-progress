/**
 * Where a command finds the tracker that governs it: the paths a root owns, the walk up, the nearest
 * tracker winning, and `requireWorkspace`'s refusal. The `AGENT_PROGRESS_ROOT` cases run in a child
 * process because only `src/shared/Environment.spec.ts` assigns the environment in-process.
 */
import { mkdirSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join }                   from 'node:path';
import { afterAll, expect, test }          from 'bun:test';

import { refusalIsOperationRefusal }               from '../../shared/OperationRefusal.ts';
import { CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS } from '../../testing/ChildProcessCaseTimeout.ts';
import { jsonPrintedByAChildProcess }              from '../../testing/JsonPrintedByAChildProcess.ts';
import {
  addWorktree,
  createCanonicalScratchDirectory,
  createScratchGitRepository,
  removeScratchDirectory
} from '../../testing/ScratchWorkspace.ts';
import { testWhenGitIsPresent }                               from '../../testing/ToolGuard.ts';
import { writeMinimalTracker }                                from '../../testing/TrackerFileFixtures.ts';
import { findWorkspace, requireWorkspace, workspacePathsFor } from './Workspace.ts';

const WORKSPACE_MODULE_PATH = join(import.meta.dir, 'Workspace.ts');
const scratchDirectories: string[] = [];

afterAll(() => {
  for (const directory of scratchDirectories) removeScratchDirectory(directory);
});

function scratchDirectory(prefix: string): string {
  const directory = createCanonicalScratchDirectory(prefix);
  scratchDirectories.push(directory);
  return directory;
}

function rootFoundByAChildProcess(childEnvironment: Record<string, string>, startDirectory: string): string | null {
  const source = [
    `const loaded = await import(${JSON.stringify(WORKSPACE_MODULE_PATH)});`,
    `const found = loaded.findWorkspace(${JSON.stringify(startDirectory)});`,
    'console.log(JSON.stringify(found === null ? null : found.rootDirectory));',
  ].join('\n');
  return jsonPrintedByAChildProcess(childEnvironment, source) as string | null;
}

function refusalDetailFromAChildProcess(childEnvironment: Record<string, string>, startDirectory: string): unknown {
  const source = [
    `const loaded = await import(${JSON.stringify(WORKSPACE_MODULE_PATH)});`,
    'try {',
    `  loaded.requireWorkspace(${JSON.stringify(startDirectory)});`,
    '  console.log(JSON.stringify("it found a tracker and refused nothing"));',
    '} catch (refusal) {',
    '  console.log(JSON.stringify({ status: refusal.status, detail: refusal.detail }));',
    '}',
  ].join('\n');
  return jsonPrintedByAChildProcess(childEnvironment, source);
}

test('every path a tracker owns is derived from one root and lands inside it', () => {
  const workspace = workspacePathsFor('/example/repository');
  expect(workspace.rootDirectory).toBe('/example/repository');
  expect(workspace.trackerDirectory).toBe('/example/repository/.agent-progress');
  expect(workspace.progressFilePath).toBe('/example/repository/.agent-progress/progress.json');
  expect(workspace.logFilePath).toBe('/example/repository/.agent-progress/log.jsonl');
  expect(workspace.htmlFilePath).toBe('/example/repository/.agent-progress/progress.html');
  expect(workspace.stampFilePath).toBe('/example/repository/.agent-progress/progress.stamp.js');
  expect(workspace.ticketsDirectory).toBe('/example/repository/.agent-progress/tickets');
  expect(workspace.lockDirectoryPath).toBe('/example/repository/.agent-progress/.lock');
});

test('the paths are produced for a tracker that does not exist yet, because init needs them before it creates one', () => {
  const missingRoot = join(scratchDirectory('workspace-not-yet'), 'never-created');
  expect(workspacePathsFor(missingRoot).progressFilePath).toBe(join(missingRoot, '.agent-progress', 'progress.json'));
});

test('a relative root is made absolute, so nothing is resolved against the process working directory later', () => {
  expect(workspacePathsFor('.').rootDirectory.startsWith('/')).toBe(true);
});

test('a command run in the root finds the tracker there', () => {
  const rootDirectory = writeMinimalTracker(scratchDirectory('workspace-here'));
  expect(findWorkspace(rootDirectory)?.rootDirectory).toBe(rootDirectory);
});

test('a command run deep inside the repository walks up to the tracker', () => {
  const rootDirectory = writeMinimalTracker(scratchDirectory('workspace-deep'));
  const nestedDirectory = join(rootDirectory, 'packages', 'example', 'source');
  mkdirSync(nestedDirectory, { recursive: true });
  expect(findWorkspace(nestedDirectory)?.rootDirectory).toBe(rootDirectory);
});

// `git worktree add ../name` puts the checkout beside the repository, so the walk up never reaches the tracker.
testWhenGitIsPresent('a command run in a sibling worktree finds the main checkout\'s tracker through git', () => {
  const repositoryDirectory = realpathSync(createScratchGitRepository('workspace-worktree'));
  scratchDirectories.push(repositoryDirectory);
  const rootDirectory = writeMinimalTracker(repositoryDirectory);
  const worktreeDirectory = addWorktree(repositoryDirectory, 'sibling');
  scratchDirectories.push(worktreeDirectory);
  expect(findWorkspace(worktreeDirectory)?.rootDirectory).toBe(rootDirectory);
});

testWhenGitIsPresent('a repository with no tracker anywhere still finds nothing, worktree or not', () => {
  const repositoryDirectory = realpathSync(createScratchGitRepository('workspace-untracked'));
  scratchDirectories.push(repositoryDirectory);
  expect(findWorkspace(repositoryDirectory)).toBeNull();
});

test('the nearest tracker wins, not the outermost one', () => {
  const outerRoot = writeMinimalTracker(scratchDirectory('workspace-nesting'));
  const innerRoot = writeMinimalTracker(join(outerRoot, 'vendor', 'inner'));
  mkdirSync(join(innerRoot, 'source'), { recursive: true });
  expect(findWorkspace(join(innerRoot, 'source'))?.rootDirectory).toBe(innerRoot);
});

test('a tracker directory with no progress file in it is walked straight past', () => {
  const outerRoot = writeMinimalTracker(scratchDirectory('workspace-empty-tracker'));
  const emptyTrackerRoot = join(outerRoot, 'nested');
  mkdirSync(join(emptyTrackerRoot, '.agent-progress'), { recursive: true });
  expect(findWorkspace(emptyTrackerRoot)?.rootDirectory).toBe(outerRoot);
});

test('a directory with no tracker above it at all finds nothing', () => {
  const plainDirectory = scratchDirectory('workspace-none');
  expect(findWorkspace(plainDirectory)).toBeNull();
});

test('a start directory that does not exist finds nothing rather than throwing', () => {
  const plainDirectory = scratchDirectory('workspace-gone');
  const removedDirectory = join(plainDirectory, 'removed');
  mkdirSync(removedDirectory);
  rmSync(removedDirectory, { recursive: true, force: true });
  expect(findWorkspace(removedDirectory)).toBeNull();
});

test('requireWorkspace refuses with an actionable status and the directory it searched from, for the command line to word', () => {
  const plainDirectory = scratchDirectory('workspace-refusal');
  let caught: unknown = null;
  try {
    requireWorkspace(plainDirectory);
  } catch (error) {
    caught = error;
  }
  expect(refusalIsOperationRefusal(caught)).toBe(true);
  expect(refusalIsOperationRefusal(caught) ? caught.status : null).toBe('refused');
  expect(refusalIsOperationRefusal(caught) ? caught.detail : null).toEqual({ kind: 'no-tracker-found', searchedFrom: plainDirectory });
});

test('requireWorkspace hands back the tracker when there is one, rather than refusing defensively', () => {
  const rootDirectory = writeMinimalTracker(scratchDirectory('workspace-required'));
  expect(requireWorkspace(rootDirectory).progressFilePath).toBe(join(rootDirectory, '.agent-progress', 'progress.json'));
});

test('the child-process harness can tell a found tracker from none, so its silences count', () => {
  const rootDirectory = writeMinimalTracker(scratchDirectory('workspace-harness'));
  expect(rootFoundByAChildProcess({}, rootDirectory)).toBe(rootDirectory);
  expect(rootFoundByAChildProcess({}, dirname(rootDirectory))).not.toBe(rootDirectory);
}, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);

test('AGENT_PROGRESS_ROOT names the tracker outright, from a directory nowhere near it', () => {
  const rootDirectory = writeMinimalTracker(scratchDirectory('workspace-override'));
  const unrelatedDirectory = scratchDirectory('workspace-override-elsewhere');
  expect(rootFoundByAChildProcess({ AGENT_PROGRESS_ROOT: rootDirectory }, unrelatedDirectory)).toBe(rootDirectory);
}, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);

test('the override wins over a tracker the walk would otherwise have found', () => {
  const overriddenRoot = writeMinimalTracker(scratchDirectory('workspace-override-wins'));
  const walkableRoot = writeMinimalTracker(scratchDirectory('workspace-override-loses'));
  expect(rootFoundByAChildProcess({ AGENT_PROGRESS_ROOT: overriddenRoot }, walkableRoot)).toBe(overriddenRoot);
}, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);

test('an override naming a directory with no tracker finds nothing, instead of falling back to the walk', () => {
  const walkableRoot = writeMinimalTracker(scratchDirectory('workspace-override-missing'));
  const emptyDirectory = scratchDirectory('workspace-override-empty');
  expect(rootFoundByAChildProcess({ AGENT_PROGRESS_ROOT: emptyDirectory }, walkableRoot)).toBeNull();
}, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);

test('the refusal under an override carries the override path as its only fact, and not the directory the command ran in', () => {
  const walkableRoot   = writeMinimalTracker(scratchDirectory('workspace-override-message-walkable'));
  const emptyDirectory = scratchDirectory('workspace-override-message-empty');

  expect(refusalDetailFromAChildProcess({ AGENT_PROGRESS_ROOT: emptyDirectory }, walkableRoot)).toEqual({
    status: 'refused',
    detail: { kind: 'no-tracker-at-override', overrideDirectory: emptyDirectory },
  });
}, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);

test('the refusal without an override still carries the directory that was searched from', () => {
  const plainDirectory = scratchDirectory('workspace-no-override-message');
  expect(refusalDetailFromAChildProcess({}, plainDirectory)).toEqual({
    status: 'refused',
    detail: { kind: 'no-tracker-found', searchedFrom: plainDirectory },
  });
}, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);
