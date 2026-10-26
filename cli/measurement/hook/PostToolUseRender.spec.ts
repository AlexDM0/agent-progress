/**
 * `hook post-tool-use` runs after every tool call of every agent, so what matters is that it renders only a stale page, and that it can
 * neither stall nor fail the call: a held lock is skipped at once, and a malformed store, a missing tracker or another install version
 * each exit 0 with nothing printed and nothing rendered. A render is seen as the page file's modification time moving.
 */
import {
  rmSync,
  statSync,
  utimesSync,
  writeFileSync
} from 'node:fs';

import {
  afterEach,
  beforeEach,
  expect,
  test
}                                                         from 'bun:test';
import { LocalTimeUtil }                                  from '../../../src/lib/local-time/LocalTimeUtil.ts';
import { LockGenerationSteps }                            from '../../../src/services/tracker/TrackerLock.ts';
import { workspacePathsFor }                              from '../../../src/services/tracker/Workspace.ts';
import { createScratchDirectory, removeScratchDirectory } from '../../../src/testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent }                       from '../../../src/testing/ToolGuard.ts';
import { installedFilePathsIn }                           from '../../InstalledFiles.ts';
import { runCommandLine }                                 from '../../Main.ts';
import { createCapturedCommandContext }                   from '../../testing/CapturedCommandContext.ts';
import { createInitializedScratchRepository }             from '../../testing/InitializedScratchRepository.ts';
import { PAGE_RENDER_AGE_THRESHOLD_MILLISECONDS }         from './PostToolUseRender.ts';

const NOW_MILLISECONDS = Date.parse('2026-09-18T20:11:03Z');

const ONE_MINUTE_MILLISECONDS = 60_000;

const HELD_LOCK_BUDGET_MILLISECONDS = 1000;

let repositoryDirectory = '';

function pageFilePath(): string {
  return workspacePathsFor(repositoryDirectory).htmlFilePath;
}

function setPageAge(ageMilliseconds: number): number {
  const modifiedAtSeconds = (NOW_MILLISECONDS - ageMilliseconds) / 1000;
  utimesSync(pageFilePath(), modifiedAtSeconds, modifiedAtSeconds);
  return statSync(pageFilePath()).mtimeMs;
}

async function runTheHook(nowMilliseconds = NOW_MILLISECONDS, currentDirectory = repositoryDirectory): Promise<{ exitCode: number; printed: string }> {
  const context  = createCapturedCommandContext({ currentDirectory, now: () => new Date(nowMilliseconds) });
  const exitCode = await runCommandLine(['hook', 'post-tool-use'], context);
  return { exitCode, printed: `${context.outputText()}${context.errorText()}` };
}

beforeEach(async () => {
  repositoryDirectory = await createInitializedScratchRepository('post-tool-use-hook', ['--project', 'Example Agency'], () => new Date(NOW_MILLISECONDS));
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
});

describeWhenGitIsPresent('hook post-tool-use', () => {
  test('a page older than the threshold is rendered, silently, at exit 0', async () => {
    const modifiedBefore = setPageAge(PAGE_RENDER_AGE_THRESHOLD_MILLISECONDS + ONE_MINUTE_MILLISECONDS);

    expect(await runTheHook()).toEqual({ exitCode: 0, printed: '' });
    expect(statSync(pageFilePath()).mtimeMs).not.toBe(modifiedBefore);
  });

  test('a page younger than the threshold is left as it is', async () => {
    const modifiedBefore = setPageAge(ONE_MINUTE_MILLISECONDS);

    expect(await runTheHook()).toEqual({ exitCode: 0, printed: '' });
    expect(statSync(pageFilePath()).mtimeMs).toBe(modifiedBefore);
  });

  test('run twice within a minute, it renders once', async () => {
    const modifiedBefore = setPageAge(PAGE_RENDER_AGE_THRESHOLD_MILLISECONDS + ONE_MINUTE_MILLISECONDS);
    await runTheHook();
    const modifiedByTheFirstRun = statSync(pageFilePath()).mtimeMs;
    expect(modifiedByTheFirstRun).not.toBe(modifiedBefore);

    expect(await runTheHook(modifiedByTheFirstRun + ONE_MINUTE_MILLISECONDS / 2)).toEqual({ exitCode: 0, printed: '' });
    expect(statSync(pageFilePath()).mtimeMs).toBe(modifiedByTheFirstRun);
  });

  test('with the lock held by a live process it exits 0 at once, rendering and printing nothing', async () => {
    const modifiedBefore = setPageAge(PAGE_RENDER_AGE_THRESHOLD_MILLISECONDS + ONE_MINUTE_MILLISECONDS);
    const lockHolder     = { processId: process.pid, acquiredAt: LocalTimeUtil.formatLocalIso(new Date(NOW_MILLISECONDS)) };
    expect(LockGenerationSteps.attemptedAcquire(workspacePathsFor(repositoryDirectory).lockDirectoryPath, lockHolder, NOW_MILLISECONDS).verdict).toBe('acquired');

    const startedAt = performance.now();
    expect(await runTheHook()).toEqual({ exitCode: 0, printed: '' });
    expect(performance.now() - startedAt).toBeLessThan(HELD_LOCK_BUDGET_MILLISECONDS);
    expect(statSync(pageFilePath()).mtimeMs).toBe(modifiedBefore);
  });

  test('a malformed progress file exits 0, rendering and printing nothing', async () => {
    writeFileSync(workspacePathsFor(repositoryDirectory).progressFilePath, '{ not json');
    const modifiedBefore = setPageAge(PAGE_RENDER_AGE_THRESHOLD_MILLISECONDS + ONE_MINUTE_MILLISECONDS);

    expect(await runTheHook()).toEqual({ exitCode: 0, printed: '' });
    expect(statSync(pageFilePath()).mtimeMs).toBe(modifiedBefore);
  });

  test('installed files of another install version exit 0, rendering and printing nothing', async () => {
    rmSync(installedFilePathsIn(repositoryDirectory).installManifest);
    const modifiedBefore = setPageAge(PAGE_RENDER_AGE_THRESHOLD_MILLISECONDS + ONE_MINUTE_MILLISECONDS);

    expect(await runTheHook()).toEqual({ exitCode: 0, printed: '' });
    expect(statSync(pageFilePath()).mtimeMs).toBe(modifiedBefore);
  });

  test('a directory holding no tracker exits 0 and prints nothing', async () => {
    const elsewhere = createScratchDirectory('post-tool-use-hook-elsewhere');
    try {
      expect(await runTheHook(NOW_MILLISECONDS, elsewhere)).toEqual({ exitCode: 0, printed: '' });
    } finally {
      removeScratchDirectory(elsewhere);
    }
  });
});
