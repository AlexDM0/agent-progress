/**
 * The process runner must refuse a directory outside the scratch root before it spawns the binary, or a refusal would be swallowed into an exit
 * code.
 */
import { join }                   from 'node:path';
import { describe, expect, test } from 'bun:test';

import { runAgentProgress } from './CliProcess';

const REPOSITORY_DIRECTORY = join(import.meta.dir, '..', '..');

describe('the refusal before a command runs', () => {
  test('refuses the repository under test before any command can run', async () => {
    await expect(runAgentProgress(['ticket', 'add', 'Isolation probe'], { currentDirectory: REPOSITORY_DIRECTORY })).rejects.toThrow('which is not isolated');
  });
});
