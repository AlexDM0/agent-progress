/**
 * What wakes the DrivePass. What matters: a burst of writes in the data folder is debounced into one wake; a request written into a Hatch
 * folder created after the start still wakes it; the sweep wakes it with no file event at all; and a stopped watcher wakes nothing.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join }                     from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test
} from 'bun:test';

import { OVERSEER_WATCH_DEBOUNCE_MILLISECONDS }           from '../../shared/constants/OverseerLimits.ts';
import { PRODUCT_NAMES }                                  from '../../shared/constants/ProductNames.ts';
import { createScratchDirectory, removeScratchDirectory } from '../../testing/ScratchWorkspace.ts';
import { DataFolderWatch }                                from './DataFolderWatch.ts';

const SETTLE_MILLISECONDS = OVERSEER_WATCH_DEBOUNCE_MILLISECONDS * 4;
const NO_SWEEP_MILLISECONDS = 600_000;
const QUICK_SWEEP_MILLISECONDS = 50;
const BURST_WRITES = 5;

let repositoryRoot = '';
let trackerDirectory = '';

beforeEach(() => {
  repositoryRoot   = createScratchDirectory('board-watcher');
  trackerDirectory = join(repositoryRoot, PRODUCT_NAMES.DATA_FOLDER);
  mkdirSync(trackerDirectory);
});

afterEach(() => {
  removeScratchDirectory(repositoryRoot);
});

describe('DataFolderWatch', () => {
  test('a burst of writes in the data folder wakes once, and a request in a Hatch folder made after the start wakes again', async () => {
    let wakes = 0;
    const watcher = DataFolderWatch.startWatching({
      trackerDirectory, repositoryRoot, wake: () => { wakes += 1; }, sweepMilliseconds: NO_SWEEP_MILLISECONDS
    });
    try {
      // The platform may still report the folders this spec made just before the start; the count starts once they settled.
      await Bun.sleep(SETTLE_MILLISECONDS);
      wakes = 0;
      for (let i = 0; i < BURST_WRITES; i += 1) writeFileSync(join(trackerDirectory, 'progress.json'), `{"write":${i}}\n`);
      await Bun.sleep(SETTLE_MILLISECONDS);
      expect(wakes).toBe(1);

      const requestsFolder = join(repositoryRoot, PRODUCT_NAMES.WORKTREES_FOLDER, 'hatch', 'J7', 'requests');
      mkdirSync(requestsFolder, { recursive: true });
      writeFileSync(join(requestsFolder, 'request-1.json'), '{}\n');
      await Bun.sleep(SETTLE_MILLISECONDS);
      expect(wakes).toBe(2);
    } finally {
      watcher.stop();
    }
    writeFileSync(join(trackerDirectory, 'progress.json'), '{"write":"after the stop"}\n');
    await Bun.sleep(SETTLE_MILLISECONDS);
    expect(wakes).toBe(2);
  });

  test('the sweep wakes with no file event', async () => {
    let wakes = 0;
    const watcher = DataFolderWatch.startWatching({
      trackerDirectory, repositoryRoot, wake: () => { wakes += 1; }, sweepMilliseconds: QUICK_SWEEP_MILLISECONDS
    });
    await Bun.sleep(SETTLE_MILLISECONDS);
    watcher.stop();
    expect(wakes).toBeGreaterThanOrEqual(2);
  });
});
