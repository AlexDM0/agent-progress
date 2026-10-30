/**
 * The code version over a planted program root. What matters: an edit to any shipping file moves the version, `bridge/` and
 * `watcher.ts` included, since the new-code check hands a live Overseer to the code on disk only when it moves; a spec edit
 * leaves it unchanged, so a test-only change never reads as new code.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join }            from 'node:path';

import {
  afterEach,
  describe,
  expect,
  test
} from 'bun:test';

import { createScratchDirectory, removeScratchDirectory } from '../../testing/ScratchWorkspace.ts';
import { CodeVersion }                                    from './CodeVersion.ts';

const scratchDirectories: string[] = [];

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) removeScratchDirectory(directory);
});

const PLANTED_FILES = [
  'agent-progress.ts',
  'watcher.ts',
  'package.json',
  'bridge/Main.tsx',
  'bridge/shell/Header.tsx',
  'bridge/shell/HeaderModel.spec.ts',
  'cli/Main.ts',
  'src/services/overseer/CodeVersion.ts',
];

function plantFile(programRoot: string, relativePath: string, contents: string): void {
  const filePath = join(programRoot, relativePath);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

function plantedProgramRoot(): string {
  const programRoot = createScratchDirectory('code-version');
  scratchDirectories.push(programRoot);
  for (const relativePath of PLANTED_FILES) plantFile(programRoot, relativePath, `original ${relativePath}\n`);
  return programRoot;
}

describe('CodeVersion.codeVersionOf', () => {
  test('an unchanged program root reads the same version twice', () => {
    const programRoot = plantedProgramRoot();
    expect(CodeVersion.codeVersionOf(programRoot)).toBe(CodeVersion.codeVersionOf(programRoot));
  });

  test.each([
    ['a bridge/ edit', 'bridge/shell/Header.tsx'],
    ['a new bridge/ file', 'bridge/views/NewView.tsx'],
    ['a watcher.ts edit', 'watcher.ts'],
    ['an agent-progress.ts edit', 'agent-progress.ts'],
    ['a cli/ edit', 'cli/Main.ts'],
  ])('%s moves the version', (_editName, relativePath) => {
    const programRoot   = plantedProgramRoot();
    const versionBefore = CodeVersion.codeVersionOf(programRoot);
    plantFile(programRoot, relativePath, 'edited\n');
    expect(CodeVersion.codeVersionOf(programRoot)).not.toBe(versionBefore);
  });

  test('a spec edit under bridge/ leaves the version unchanged', () => {
    const programRoot   = plantedProgramRoot();
    const versionBefore = CodeVersion.codeVersionOf(programRoot);
    plantFile(programRoot, 'bridge/shell/HeaderModel.spec.ts', 'edited\n');
    expect(CodeVersion.codeVersionOf(programRoot)).toBe(versionBefore);
  });
});
