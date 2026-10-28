/**
 * A `claude` that only records. `src/testing/ClaudeLaunchGuard.ts` puts its folder first on the test run's `PATH` and
 * `cli/testing/CliProcess.ts` on every spawned binary's, so any process under the run that executes `claude` reaches this stub, which notes
 * where it ran and exits non-zero, rather than starting a real agent session.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';

import { createCanonicalScratchDirectory } from './ScratchWorkspace.ts';

const TRAPPED_EXIT_CODE   = 97;
const EXECUTABLE_FILE_MODE = 0o755;

let trapFolder: string | null = null;

function attemptsFileOf(folder: string): string {
  return join(folder, 'attempts.log');
}

function stubSourceOf(attemptsFile: string): string {
  return [
    '#!/bin/sh',
    `printf 'claude executed in %s\\n' "$PWD" >> '${attemptsFile}'`,
    'echo "claude is trapped under the test run: no spec may start a real agent session (src/testing/ClaudeLaunchTrap.ts)" >&2',
    `exit ${TRAPPED_EXIT_CODE}`,
    '',
  ].join('\n');
}

/** The folder holding the stub, made once per run; it stays after the run, so a process outliving it still finds the stub. */
export function claudeLaunchTrapFolder(): string {
  if (trapFolder !== null) return trapFolder;
  const folder = createCanonicalScratchDirectory('claude-launch-trap');
  const binaryFolder = join(folder, 'bin');
  mkdirSync(binaryFolder);
  const stubPath = join(binaryFolder, 'claude');
  writeFileSync(stubPath, stubSourceOf(attemptsFileOf(folder)));
  chmodSync(stubPath, EXECUTABLE_FILE_MODE);
  trapFolder = binaryFolder;
  return binaryFolder;
}

/** Every attempt recorded since the last take, one line each, cleared as it is read. */
export function takeClaudeLaunchAttempts(): string[] {
  if (trapFolder === null) return [];
  const attemptsFile = attemptsFileOf(join(trapFolder, '..'));
  if (!existsSync(attemptsFile)) return [];
  const attempts = readFileSync(attemptsFile, 'utf8').split('\n').filter((line) => line !== '');
  rmSync(attemptsFile, { force: true });
  return attempts;
}
