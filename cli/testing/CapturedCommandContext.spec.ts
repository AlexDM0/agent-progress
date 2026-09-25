/**
 * The captured context must refuse before a command runs, both on the directory it is given and on the `cwd` of a piped hook input, or a
 * refusal would be swallowed into an exit code.
 */
import { realpathSync } from 'node:fs';
import { join }         from 'node:path';
import {
  afterAll,
  describe,
  expect,
  test
}                       from 'bun:test';

import { createScratchDirectory, removeScratchDirectory } from '../../src/testing/ScratchWorkspace';
import { createCapturedCommandContext }                   from './CapturedCommandContext';

const REPOSITORY_DIRECTORY = join(import.meta.dir, '..', '..');
const scratchDirectories: string[] = [];

afterAll(() => {
  for (const directory of scratchDirectories) removeScratchDirectory(directory);
});

function scratchDirectory(prefix: string): string {
  const directory = realpathSync(createScratchDirectory(prefix));
  scratchDirectories.push(directory);
  return directory;
}

describe('the refusal before a command runs', () => {
  test('refuses the repository under test before any command can run', () => {
    expect(() => createCapturedCommandContext({ currentDirectory: REPOSITORY_DIRECTORY })).toThrow('which is not isolated');
  });

  // The hook resolves its tracker from the `cwd` in the JSON piped to it, not from the context, so that directory is a second way out.
  test('refuse a piped hook input whose cwd is the repository under test', () => {
    const scratchWorkingDirectory = scratchDirectory('isolation-hook');
    const standardInputText = JSON.stringify({ agent_id: 'agent_example', cwd: REPOSITORY_DIRECTORY });
    expect(() => createCapturedCommandContext({ currentDirectory: scratchWorkingDirectory, standardInputText })).toThrow('which is not isolated');
    expect(() => createCapturedCommandContext({ currentDirectory: scratchWorkingDirectory, standardInputText: 'not json' })).not.toThrow();
  });
});
