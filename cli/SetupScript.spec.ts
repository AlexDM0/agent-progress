/**
 * `setup.sh --instruct-only` promises to change nothing, and its `bun link` would repoint the machine-wide command at whichever checkout ran it.
 * The script runs with a scratch `HOME` and a fake `bun` first on a minimal `PATH` that records every call, so neither the real `bun` nor the
 * real home is ever reached; the cases hold that no install or link call happens, that each is announced instead, and that the home is unchanged.
 */
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  writeFileSync,
} from 'node:fs';
import { join }                          from 'node:path';
import { afterEach, beforeEach, expect } from 'bun:test';

import { CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS }                 from '../src/testing/ChildProcessCaseTimeout.ts';
import { createCanonicalScratchDirectory, removeScratchDirectory } from '../src/testing/ScratchWorkspace.ts';
import { testWhenBashIsPresent }                                   from '../src/testing/ToolGuard.ts';

const SETUP_SCRIPT_PATH  = join(import.meta.dir, '..', 'setup.sh');
const CHECKOUT_DIRECTORY = join(import.meta.dir, '..');
const SYSTEM_TOOL_PATH   = '/usr/bin:/bin';
const EXAMPLE_RC_CONTENT = '# Alex Example\'s shell configuration\n';

let scratchDirectory = '';
let scratchHomeDirectory = '';
let fakeBunDirectory = '';
let bunCallLogPath = '';

interface FinishedSetupRun {
  readonly exitCode: number;
  readonly output:   string;
}

beforeEach(() => {
  scratchDirectory = createCanonicalScratchDirectory('setup-script');
  scratchHomeDirectory = join(scratchDirectory, 'home');
  fakeBunDirectory = join(scratchDirectory, 'fake-bin');
  bunCallLogPath = join(scratchDirectory, 'bun-calls.log');
  mkdirSync(scratchHomeDirectory);
  mkdirSync(fakeBunDirectory);
  writeFileSync(join(scratchHomeDirectory, '.zshrc'), EXAMPLE_RC_CONTENT);
  writeFileSync(bunCallLogPath, '');
  const fakeBunPath = join(fakeBunDirectory, 'bun');
  writeFileSync(fakeBunPath, [
    '#!/bin/sh',
    `printf '%s\\n' "$*" >> ${JSON.stringify(bunCallLogPath)}`,
    'if [ "$1" = "--version" ]; then echo 1.3.0; fi',
    'exit 0',
    '',
  ].join('\n'));
  chmodSync(fakeBunPath, 0o755);
});

afterEach(() => {
  removeScratchDirectory(scratchDirectory);
});

function runSetupScriptInstructOnly(): FinishedSetupRun {
  const finished = Bun.spawnSync(['bash', SETUP_SCRIPT_PATH, '--instruct-only'], {
    cwd:    scratchHomeDirectory,
    env:    { HOME: scratchHomeDirectory, PATH: `${fakeBunDirectory}:${SYSTEM_TOOL_PATH}`, SHELL: '/bin/zsh' },
    stdin:  'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return { exitCode: finished.exitCode, output: `${finished.stdout.toString()}\n${finished.stderr.toString()}` };
}

/** Every entry under the home with its kind and, for a file or symlink, what it holds, so any write the run made shows as a difference. */
function snapshotOf(directory: string): readonly string[] {
  return readdirSync(directory, { recursive: true, encoding: 'utf8' }).sort().map((relativePath) => {
    const entryPath = join(directory, relativePath);
    const entryStatus = lstatSync(entryPath);
    if (entryStatus.isSymbolicLink()) return `${relativePath} -> ${readlinkSync(entryPath)}`;
    if (entryStatus.isDirectory()) return `${relativePath}/`;
    return `${relativePath}: ${readFileSync(entryPath, 'utf8')}`;
  });
}

function recordedBunCalls(): readonly string[] {
  return readFileSync(bunCallLogPath, 'utf8').split('\n').filter((line) => line !== '');
}

testWhenBashIsPresent('setup.sh --instruct-only runs neither bun install nor bun link', () => {
  const { exitCode, output } = runSetupScriptInstructOnly();
  expect(exitCode, output).toBe(0);
  const calls = recordedBunCalls();
  expect(calls.filter((call) => call.split(' ')[0] === 'install'), output).toEqual([]);
  expect(calls.filter((call) => call.split(' ')[0] === 'link'), output).toEqual([]);
}, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);

testWhenBashIsPresent('setup.sh --instruct-only announces each bun step it skips, naming the checkout', () => {
  const { output } = runSetupScriptInstructOnly();
  expect(output).toContain(`Would run bun install in ${CHECKOUT_DIRECTORY}`);
  expect(output).toContain(`Would run bun link in ${CHECKOUT_DIRECTORY}`);
}, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);

testWhenBashIsPresent('setup.sh --instruct-only leaves the home unchanged: no skill symlink, no rc edit', () => {
  const homeBefore = snapshotOf(scratchHomeDirectory);
  const { exitCode, output } = runSetupScriptInstructOnly();
  expect(exitCode, output).toBe(0);
  expect(snapshotOf(scratchHomeDirectory)).toEqual(homeBefore);
  expect(readFileSync(join(scratchHomeDirectory, '.zshrc'), 'utf8')).toBe(EXAMPLE_RC_CONTENT);
}, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);
