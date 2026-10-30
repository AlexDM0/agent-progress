/**
 * `open` on a board no Overseer serves: refused `overseer-down` at exit 1 with the advice to start one, rather than opening the stub
 * `progress.html`, which only says the Overseer is down. The live path is not driven here, since it launches a browser.
 */
import { afterEach, beforeEach, expect } from 'bun:test';

import { PRODUCT_NAMES }                                      from '../../../src/shared/constants/ProductNames.ts';
import { createScratchGitRepository, removeScratchDirectory } from '../../../src/testing/ScratchWorkspace.ts';
import { testWhenGitIsPresent }                               from '../../../src/testing/ToolGuard.ts';
import { runCommandLine }                                     from '../../Main.ts';
import { createCapturedCommandContext }                       from '../../testing/CapturedCommandContext.ts';

let repositoryDirectory = '';

beforeEach(async () => {
  repositoryDirectory = createScratchGitRepository('open-command');
  await runCommandLine(['init', '--project', 'Example Agency'], createCapturedCommandContext({ currentDirectory: repositoryDirectory }));
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
});

testWhenGitIsPresent('A3: with no live lease, open is refused overseer-down at exit 1, advising run --detach, and prints no path', async () => {
  const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
  expect(await runCommandLine(['open'], context)).toBe(1);

  expect(context.errorText()).toContain('No Overseer serves this board');
  expect(context.errorText()).toContain(`\`${PRODUCT_NAMES.PROGRAM} run --detach\``);
  expect(context.outputText()).toBe('');
});
