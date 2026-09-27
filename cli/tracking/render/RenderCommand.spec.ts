/**
 * `render` on a progress file it cannot read: the failure is exit 2, and a caller reading standard error sees the reason once, not twice.
 */
import { writeFileSync } from 'node:fs';
import { join }          from 'node:path';

import {
  afterEach,
  beforeEach,
  expect,
  test
}                                                                             from 'bun:test';
import { createScratchGitRepository, removeScratchDirectory } from '../../../src/testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent }                           from '../../../src/testing/ToolGuard.ts';
import { runCommandLine }                                     from '../../Main.ts';
import { createCapturedCommandContext }                       from '../../testing/CapturedCommandContext.ts';

const UNREADABLE_PROGRESS_TEXT = '{ not json';

let repositoryDirectory = '';

beforeEach(async () => {
  repositoryDirectory = createScratchGitRepository('render-command');
  await runCommandLine(['init', '--project', 'Example Agency'], createCapturedCommandContext({ currentDirectory: repositoryDirectory }));
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
});

describeWhenGitIsPresent('an unreadable progress file', () => {
  test('is reported once, at exit 2', async () => {
    writeFileSync(join(repositoryDirectory, '.agent-progress', 'progress.json'), UNREADABLE_PROGRESS_TEXT);

    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['render'], context)).toBe(2);

    const errorLines = context.errorText().split('\n').filter((line) => line.includes('progress.json'));
    expect(errorLines, context.errorText()).toHaveLength(1);
    expect(context.outputText()).toBe('');
  });
});
