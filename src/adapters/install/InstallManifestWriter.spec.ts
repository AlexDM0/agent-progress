/** What the manifest writer puts on disk: the exact indented, newline-terminated bytes, and a version the reader reads back as written. */
import { readFileSync }           from 'node:fs';
import { join }                   from 'node:path';
import { afterAll, expect, test } from 'bun:test';

import { createScratchDirectory, removeScratchDirectory } from '../../testing/ScratchWorkspace.ts';
import { InstallManifestIngestion }                       from './InstallManifestIngestion.ts';
import { createInstallManifestWriter }                    from './InstallManifestWriter.ts';

const scratchDirectories: string[] = [];

afterAll(() => {
  for (const directory of scratchDirectories) removeScratchDirectory(directory);
});

function scratchManifestFilePath(prefix: string): string {
  const directory = createScratchDirectory(prefix);
  scratchDirectories.push(directory);
  return join(directory, 'version.json');
}

test('a Claude Code manifest on disk is the install version alone, indented and ending with a newline', () => {
  const manifestFilePath = scratchManifestFilePath('manifest-bytes');
  createInstallManifestWriter(manifestFilePath).write({ installVersion: 1, agentHost: 'claude-code' });
  expect(readFileSync(manifestFilePath, 'utf8')).toBe('{\n  "installVersion": 1\n}\n');
});

test('a Copilot CLI manifest adds the agent host after the version', () => {
  const manifestFilePath = scratchManifestFilePath('manifest-host-bytes');
  createInstallManifestWriter(manifestFilePath).write({ installVersion: 8, agentHost: 'copilot-cli' });
  expect(readFileSync(manifestFilePath, 'utf8')).toBe('{\n  "installVersion": 8,\n  "agentHost": "copilot-cli"\n}\n');
});

test('a written manifest reads back as the version and host it was written with', () => {
  for (const agentHost of ['claude-code', 'copilot-cli'] as const) {
    const manifestFilePath = scratchManifestFilePath('manifest-round-trip');
    createInstallManifestWriter(manifestFilePath).write({ installVersion: 7, agentHost });
    expect(new InstallManifestIngestion(manifestFilePath).read()).toEqual({ verdict: 'readable', installVersion: 7, agentHost });
  }
});
