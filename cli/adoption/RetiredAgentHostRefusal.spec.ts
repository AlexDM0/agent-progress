/**
 * A repository an install before version 11 adopted for the Copilot CLI host. The cases that matter: `init` and `update` both refuse it at
 * exit 1 before their first write, naming the Copilot files and the manifest key to remove, since the old worker and extension would keep
 * running beside the Claude Code ones; and a manifest naming any other host, or none, installs as before.
 */
import { writeFileSync } from 'node:fs';
import { join }          from 'node:path';

import { afterEach, expect } from 'bun:test';
import { PRODUCT_NAMES }     from '../../src/shared/constants/ProductNames.ts';

import { createScratchGitRepository, removeScratchDirectory } from '../../src/testing/ScratchWorkspace.ts';
import { testWhenGitIsPresent }                               from '../../src/testing/ToolGuard.ts';
import { runCommandLine }                                     from '../Main.ts';
import { createCapturedCommandContext }                       from '../testing/CapturedCommandContext.ts';
import { repositoryFileContentsOf }                           from '../testing/RepositoryFileContents.ts';

const COPILOT_MANIFEST_TEXT = '{\n  "installVersion": 10,\n  "agentHost": "copilot-cli"\n}\n';

const COMMANDS_THAT_INSTALL = [['update'], ['init', '--project', 'Example Agency']];

const scratchDirectories: string[] = [];

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) removeScratchDirectory(directory);
});

async function trackedRepositoryWithManifest(manifestText: string): Promise<string> {
  const repositoryDirectory = createScratchGitRepository('retired-agent-host');
  scratchDirectories.push(repositoryDirectory);
  const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
  const exitCode = await runCommandLine(['init', '--project', 'Example Agency'], context);
  if (exitCode !== 0) throw new Error(`init exited ${exitCode}: ${context.errorText()}`);
  writeFileSync(join(repositoryDirectory, PRODUCT_NAMES.DATA_FOLDER, 'version.json'), manifestText);
  return repositoryDirectory;
}

testWhenGitIsPresent('init and update refuse a manifest naming copilot-cli at exit 1, writing nothing and naming the Copilot files', async () => {
  for (const commandLine of COMMANDS_THAT_INSTALL) {
    const repositoryDirectory = await trackedRepositoryWithManifest(COPILOT_MANIFEST_TEXT);
    const filesBefore = repositoryFileContentsOf(repositoryDirectory);
    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory });

    expect(await runCommandLine(commandLine, context), commandLine.join(' ')).toBe(1);
    expect(repositoryFileContentsOf(repositoryDirectory), commandLine.join(' ')).toEqual(filesBefore);
    for (const named of ['copilot-cli', '.github/agents/agent-progress-worker.agent.md', '.github/extensions/agent-progress/', 'agentHost', 'Nothing was written']) {
      expect(context.errorText(), `${commandLine.join(' ')} names ${named}`).toContain(named);
    }
  }
}, 60_000);

testWhenGitIsPresent('a manifest naming another agent host, or none, is no refusal: update installs and drops the key', async () => {
  for (const manifestText of ['{\n  "installVersion": 10,\n  "agentHost": "example-host"\n}\n', '{\n  "installVersion": 10\n}\n']) {
    const repositoryDirectory = await trackedRepositoryWithManifest(manifestText);
    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory });

    expect(await runCommandLine(['update'], context), manifestText).toBe(0);
    expect(repositoryFileContentsOf(repositoryDirectory).get(join(PRODUCT_NAMES.DATA_FOLDER, 'version.json')), manifestText).not.toContain('agentHost');
  }
}, 60_000);
