/**
 * The Watcher code an Overseer pins at its start. What matters: a Watcher spawned after the entry's source was edited still runs the code bundled
 * at the start, since a landing or a pull must never change what a later Watcher runs; and pinning again for the same code version keeps
 * the bundle rather than rebuilding it from the edited source.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join }                                   from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test
} from 'bun:test';

import { watcherFilesOf }                                 from '../../lib/watcher/WatcherFiles.ts';
import { createScratchDirectory, removeScratchDirectory } from '../../testing/ScratchWorkspace.ts';
import { WatcherBundle }                                  from './WatcherBundle.ts';
import { WatcherFleet }                                   from './WatcherFleet.ts';

const WATCHER_WAIT_TRIES = 200;
const WATCHER_WAIT_MILLISECONDS = 25;

let scratchDirectory = '';

beforeEach(() => {
  scratchDirectory = createScratchDirectory('watcher-bundle');
});

afterEach(() => {
  removeScratchDirectory(scratchDirectory);
});

async function watcherLogOnceWritten(watcherLogPath: string): Promise<string> {
  for (let attempt = 0; attempt < WATCHER_WAIT_TRIES; attempt += 1) {
    const text = readFileSync(watcherLogPath, 'utf8');
    if (text !== '') return text;
    await Bun.sleep(WATCHER_WAIT_MILLISECONDS);
  }
  throw new Error(`the spawned Watcher never wrote ${watcherLogPath}`);
}

describe('WatcherBundle', () => {
  test('a Watcher spawned after the entry source was edited runs the code bundled at the start', async () => {
    const entryPath = join(scratchDirectory, 'example-watcher.ts');
    writeFileSync(entryPath, 'console.log(\'bundled at the start\');\n');
    const overseerDirectory = join(scratchDirectory, 'overseer');
    mkdirSync(overseerDirectory);
    const bundlePath = await WatcherBundle.pinWatcherBundle({ overseerDirectory, codeVersion: 'code-example', entryPath });
    expect(bundlePath).toBe(join(overseerDirectory, 'watcher-code-example.js'));

    writeFileSync(entryPath, 'console.log(\'edited after the start\');\n');
    expect(await WatcherBundle.pinWatcherBundle({ overseerDirectory, codeVersion: 'code-example', entryPath })).toBe(bundlePath);
    const jobFolder = join(scratchDirectory, 'jobs', 'J1');
    mkdirSync(jobFolder, { recursive: true });
    WatcherFleet.spawnWatcher({ bundlePath, jobFolder, instance: 1 });
    expect(await watcherLogOnceWritten(watcherFilesOf(jobFolder, 1).watcherLogPath)).toBe('bundled at the start\n');
  });
});
