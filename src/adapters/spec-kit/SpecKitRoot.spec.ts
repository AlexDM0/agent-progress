/**
 * Finding a spec-kit repository's root on disk. The cases that matter: the walk finds `.specify/` above the start; with none above, the
 * verdict names the start directory; an override root wins over the walk, and one without `.specify/` is not-found naming the override.
 * Every case runs under a scratch directory, which holds no `.specify/` above it.
 */
import { mkdirSync } from 'node:fs';
import { join }      from 'node:path';
import {
  afterEach,
  describe,
  expect,
  test
} from 'bun:test';

import { createCanonicalScratchDirectory, removeScratchDirectory } from '../../testing/ScratchWorkspace.ts';
import { findSpecKitRoot }                                         from './SpecKitRoot.ts';

const scratchDirectories: string[] = [];

function scratchDirectory(): string {
  const directory = createCanonicalScratchDirectory('spec-kit-root');
  scratchDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) removeScratchDirectory(directory);
});

describe('finding the spec-kit root', () => {
  test('from a directory two levels below a `.specify/` folder, the folder holding it is the root', () => {
    const root = scratchDirectory();
    mkdirSync(join(root, '.specify'));
    const startDirectory = join(root, 'specs', '001-example');
    mkdirSync(startDirectory, { recursive: true });

    expect(findSpecKitRoot(startDirectory, undefined)).toEqual({ verdict: 'found', rootDirectory: root });
  });

  test('from a directory with no `.specify/` above it, the verdict is not-found naming the start directory', () => {
    const startDirectory = join(scratchDirectory(), 'nested');
    mkdirSync(startDirectory);

    expect(findSpecKitRoot(startDirectory, undefined)).toEqual({ verdict: 'not-found', searchedDirectory: startDirectory });
  });

  test('an override root holding `.specify/` wins over a walk that would find another root', () => {
    const walkedRoot = scratchDirectory();
    mkdirSync(join(walkedRoot, '.specify'));
    const overrideRoot = scratchDirectory();
    mkdirSync(join(overrideRoot, '.specify'));

    expect(findSpecKitRoot(walkedRoot, overrideRoot)).toEqual({ verdict: 'found', rootDirectory: overrideRoot });
  });

  test('an override root without `.specify/` is not-found naming it, even below a root the walk would find', () => {
    const walkedRoot = scratchDirectory();
    mkdirSync(join(walkedRoot, '.specify'));
    const overrideRoot = join(walkedRoot, 'specs');
    mkdirSync(overrideRoot);

    expect(findSpecKitRoot(walkedRoot, overrideRoot)).toEqual({ verdict: 'not-found', searchedDirectory: overrideRoot });
  });
});
