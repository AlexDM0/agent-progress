/**
 * The host code a runner pins at its start. What matters: a host spawned after the entry's source was edited still runs the code bundled
 * at the start, since a landing or a pull must never change what a later host runs; and pinning again for the same code version keeps
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

import { hostFilesOf }                                    from '../../lib/agent-host/HostFiles.ts';
import { createScratchDirectory, removeScratchDirectory } from '../../testing/ScratchWorkspace.ts';
import { HostBundle }                                     from './HostBundle.ts';
import { HostFleet }                                      from './HostFleet.ts';

const HOST_WAIT_TRIES = 200;
const HOST_WAIT_MILLISECONDS = 25;

let scratchDirectory = '';

beforeEach(() => {
  scratchDirectory = createScratchDirectory('host-bundle');
});

afterEach(() => {
  removeScratchDirectory(scratchDirectory);
});

async function hostLogOnceWritten(hostLogPath: string): Promise<string> {
  for (let attempt = 0; attempt < HOST_WAIT_TRIES; attempt += 1) {
    const text = readFileSync(hostLogPath, 'utf8');
    if (text !== '') return text;
    await Bun.sleep(HOST_WAIT_MILLISECONDS);
  }
  throw new Error(`the spawned host never wrote ${hostLogPath}`);
}

describe('HostBundle', () => {
  test('a host spawned after the entry source was edited runs the code bundled at the start', async () => {
    const entryPath = join(scratchDirectory, 'example-host.ts');
    writeFileSync(entryPath, 'console.log(\'bundled at the start\');\n');
    const runnerDirectory = join(scratchDirectory, 'runner');
    mkdirSync(runnerDirectory);
    const bundlePath = await HostBundle.pinHostBundle({ runnerDirectory, codeVersion: 'code-example', entryPath });
    expect(bundlePath).toBe(join(runnerDirectory, 'host-code-example.js'));

    writeFileSync(entryPath, 'console.log(\'edited after the start\');\n');
    expect(await HostBundle.pinHostBundle({ runnerDirectory, codeVersion: 'code-example', entryPath })).toBe(bundlePath);
    const jobFolder = join(scratchDirectory, 'jobs', 'J1');
    mkdirSync(jobFolder, { recursive: true });
    HostFleet.spawnHost({ bundlePath, jobFolder, instance: 1 });
    expect(await hostLogOnceWritten(hostFilesOf(jobFolder, 1).hostLogPath)).toBe('bundled at the start\n');
  });
});
