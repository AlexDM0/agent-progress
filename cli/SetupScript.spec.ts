/**
 * `setup.sh --instruct-only` promises to change nothing, and its `bun link` would repoint the machine-wide command at whichever checkout ran it.
 * The script runs with a scratch `HOME` and a fake `bun` first on a minimal `PATH` that records every call, so neither the real `bun` nor the
 * real home is ever reached; the cases hold that no install or link call happens, that each is announced instead, and that the home is unchanged.
 * Setting `core.hooksPath` is what makes the tracked pre-commit hook gate every worktree, so it is held on a copy of the script in a scratch
 * repository: set on the first run, recognised and left on the second, only announced under --instruct-only.
 */
import {
  chmodSync,
  copyFileSync,
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

/** A git repository holding a copy of `setup.sh`, so a run that writes `core.hooksPath` writes it there and never in this checkout. */
function scratchRepositoryWithSetupScript(): string {
  const repositoryDirectory = join(scratchDirectory, 'repository');
  mkdirSync(repositoryDirectory);
  copyFileSync(SETUP_SCRIPT_PATH, join(repositoryDirectory, 'setup.sh'));
  Bun.spawnSync(['git', 'init', '--quiet', repositoryDirectory], { env: setupScriptEnvironment(), stdout: 'ignore', stderr: 'ignore' });
  return repositoryDirectory;
}

function setupScriptEnvironment(): Record<string, string> {
  return { HOME: scratchHomeDirectory, PATH: `${fakeBunDirectory}:${SYSTEM_TOOL_PATH}`, SHELL: '/bin/zsh' };
}

function runSetupScriptIn(repositoryDirectory: string, setupArguments: readonly string[]): FinishedSetupRun {
  const finished = Bun.spawnSync(['bash', join(repositoryDirectory, 'setup.sh'), ...setupArguments], {
    cwd:    scratchHomeDirectory,
    env:    setupScriptEnvironment(),
    stdin:  'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return { exitCode: finished.exitCode, output: `${finished.stdout.toString()}\n${finished.stderr.toString()}` };
}

function hooksPathOf(repositoryDirectory: string): string {
  const finished = Bun.spawnSync(['git', '-C', repositoryDirectory, 'config', '--get', 'core.hooksPath'], {
    env:    setupScriptEnvironment(),
    stdout: 'pipe',
    stderr: 'ignore',
  });
  return finished.stdout.toString().trim();
}

testWhenBashIsPresent('setup.sh points core.hooksPath at .githooks, and a second run finds it set and leaves it', () => {
  const repositoryDirectory = scratchRepositoryWithSetupScript();
  const firstRun = runSetupScriptIn(repositoryDirectory, []);
  expect(firstRun.exitCode, firstRun.output).toBe(0);
  expect(firstRun.output).toContain('core.hooksPath set to .githooks (it was unset)');
  expect(hooksPathOf(repositoryDirectory)).toBe('.githooks');
  const secondRun = runSetupScriptIn(repositoryDirectory, []);
  expect(secondRun.exitCode, secondRun.output).toBe(0);
  expect(secondRun.output).toContain('core.hooksPath already points at .githooks');
  expect(hooksPathOf(repositoryDirectory)).toBe('.githooks');
}, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);

testWhenBashIsPresent('setup.sh --instruct-only announces the core.hooksPath change and leaves it unset', () => {
  const repositoryDirectory = scratchRepositoryWithSetupScript();
  const { exitCode, output } = runSetupScriptIn(repositoryDirectory, ['--instruct-only']);
  expect(exitCode, output).toBe(0);
  expect(output).toContain(`Would set core.hooksPath to .githooks in ${repositoryDirectory} (it is currently unset)`);
  expect(hooksPathOf(repositoryDirectory)).toBe('');
}, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);

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
