/**
 * `open` with no page and a progress file it cannot render from: it fails at exit 2 like `render` does, rather than handing the desktop a path that
 * does not exist and exiting 0. The happy path is not driven here, since it launches a browser.
 */
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join }                              from 'node:path';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test
}                                                                             from 'bun:test';
import { createCapturedCommandContext }                                       from '../../lib/tooling/dev/CapturedCommandContext';
import { createScratchGitRepository, gitIsAvailable, removeScratchDirectory } from '../../lib/tooling/dev/ScratchWorkspace';
import { runCommandLine }                                                     from '../Main';

const UNREADABLE_PROGRESS_TEXT = '{ not json';

let repositoryDirectory = '';

beforeEach(async () => {
  repositoryDirectory = createScratchGitRepository('open-command');
  await runCommandLine(['init', '--project', 'Example Agency'], createCapturedCommandContext({ currentDirectory: repositoryDirectory }));
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
});

describe.skipIf(!gitIsAvailable())('no page and an unreadable progress file', () => {
  test('is refused at exit 2, reported once, and no path is printed', async () => {
    const pagePath = join(repositoryDirectory, '.agent-progress', 'progress.html');
    rmSync(pagePath);
    writeFileSync(join(repositoryDirectory, '.agent-progress', 'progress.json'), UNREADABLE_PROGRESS_TEXT);

    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['open'], context)).toBe(2);

    const errorLines = context.errorText().split('\n').filter((line) => line.includes('progress.json'));
    expect(errorLines, context.errorText()).toHaveLength(1);
    expect(context.outputText()).toBe('');
    expect(existsSync(pagePath)).toBe(false);
  });
});
