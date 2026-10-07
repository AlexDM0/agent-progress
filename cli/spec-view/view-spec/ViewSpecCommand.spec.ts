/**
 * `view-spec` in process: its argument refusals come before any work, so a refused line in a spec-kit repository leaves no tracker folder
 * behind, and an accepted one prints only the page path. `--open` is never passed where a page would be found, so no browser is launched;
 * the binary's cases are `cli/ViewSpecEndToEnd.spec.ts`.
 */
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { join }                                  from 'node:path';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test
}                                                         from 'bun:test';
import { createScratchDirectory, removeScratchDirectory } from '../../../src/testing/ScratchWorkspace.ts';
import { writeExampleSpecKitRepository }                  from '../../../src/testing/SpecKitRepositoryFixtures.ts';
import { runCommandLine }                                 from '../../Main.ts';
import { createCapturedCommandContext }                   from '../../testing/CapturedCommandContext.ts';

const TRACKER_DIRECTORY_NAME = '.agent-progress';

const EXAMPLE_NOW = new Date('2026-10-07T09:00:00Z');

let repositoryDirectory = '';

beforeEach(() => {
  repositoryDirectory = realpathSync(createScratchDirectory('view-spec-command'));
  writeExampleSpecKitRepository(repositoryDirectory, { datesFilesInThePast: true, now: EXAMPLE_NOW });
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
});

function repositoryContext(): ReturnType<typeof createCapturedCommandContext> {
  return createCapturedCommandContext({ currentDirectory: repositoryDirectory, now: () => EXAMPLE_NOW });
}

describe('view-spec refuses its arguments before any work', () => {
  for (const commandLine of [['view-spec', '--json'], ['view-spec', '--force'], ['view-spec', 'specs'], ['view-spec', '--open', 'specs']]) {
    test(`\`${commandLine.join(' ')}\` exits 1, prints nothing on standard output and creates no tracker folder`, async () => {
      const context = repositoryContext();
      expect(await runCommandLine(commandLine, context)).toBe(1);
      expect(context.errorText()).toContain('agent-progress view-spec [--open]');
      expect(context.outputText()).toBe('');
      expect(existsSync(join(repositoryDirectory, TRACKER_DIRECTORY_NAME))).toBe(false);
    });
  }
});

describe('view-spec in a spec-kit repository', () => {
  test('from a folder below the root, writes both files at the root and prints only the page path', async () => {
    const context = createCapturedCommandContext({ currentDirectory: join(repositoryDirectory, 'specs'), now: () => EXAMPLE_NOW });
    expect(await runCommandLine(['view-spec'], context), context.errorText()).toBe(0);
    expect(context.outputText().trim()).toBe(join(repositoryDirectory, TRACKER_DIRECTORY_NAME, 'progress-spec.html'));
    expect(readdirSync(join(repositoryDirectory, TRACKER_DIRECTORY_NAME)).sort()).toEqual(['progress-spec.html', 'progress-spec.json']);
  });
});
