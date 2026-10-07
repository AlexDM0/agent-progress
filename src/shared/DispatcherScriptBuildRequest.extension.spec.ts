/**
 * The dispatcher's Copilot extension, built from the shared build request. What matters: it imports nothing but the Copilot SDK, which the CLI
 * resolves itself, and Node built-ins; it names no path of the checkout; and, loaded in a child process from where the install puts it beside
 * a fake SDK, it registers the workflow under the frozen meta's name and phases and runs the reconciliation from the repository root.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { isBuiltin }     from 'node:module';
import { dirname, join } from 'node:path';

import {
  afterAll,
  describe,
  expect,
  test
} from 'bun:test';

import { COPILOT_EXTENSION_SDK_SPECIFIER, bundleCopilotExtension, type ExtensionBundle }      from '../lib/copilot-cli/ExtensionBundle.ts';
import { CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS }                                            from '../testing/ChildProcessCaseTimeout.ts';
import { createCanonicalScratchDirectory, removeScratchDirectory }                            from '../testing/ScratchWorkspace.ts';
import { COPILOT_EXTENSION_BUILD, copilotExtensionBuildRequestWith, dispatcherDirectoryPath } from './DispatcherScriptBuildRequest.ts';

const INSTALLED_EXTENSION_PATH = '.github/extensions/agent-progress/extension.mjs';

const FAKE_SDK_PACKAGE = JSON.stringify({ name: '@github/copilot-sdk', type: 'module', exports: { './extension': './extension.js' } });

const FAKE_SDK_MODULE = [
  'import { appendFileSync } from \'node:fs\';',
  'const recordPath = new URL(\'../../../recorded.jsonl\', import.meta.url);',
  'export function defineWorkflow(definition) {',
  '  appendFileSync(recordPath, JSON.stringify({ defined: definition.meta }) + \'\\n\');',
  '  return { definition };',
  '}',
  'export async function joinSession(config) {',
  '  appendFileSync(recordPath, JSON.stringify({ joinedWorkflows: config.workflows.length }) + \'\\n\');',
  '  return { sessionId: \'session-example\', on: () => () => undefined };',
  '}',
  '',
].join('\n');

const FAKE_COMMAND_SCRIPT = '#!/bin/sh\necho "$PWD|$*|$(cat)" >> "$(dirname "$0")/../commands.txt"\n';

const POLL_INTERVAL_MILLISECONDS = 20;

const POLLS_BEFORE_GIVING_UP = 500;

const scratchDirectories: string[] = [];

afterAll(() => {
  for (const directory of scratchDirectories) removeScratchDirectory(directory);
});

interface FrozenMetaPhase {
  title:  string;
  detail: string;
}

/** Read by path, since the dispatcher is a feature this layer never imports. */
function frozenMeta(): { name: string; description: string; phases: FrozenMetaPhase[] } {
  return (JSON.parse(readFileSync(join(dispatcherDirectoryPath(), 'testing', 'FrozenDispatchTraces.json'), 'utf8')) as { meta: ReturnType<typeof frozenMeta> }).meta;
}

function builtTextOf(bundle: ExtensionBundle): string {
  if (bundle.verdict === 'failed') throw new Error(`${bundle.reason}: ${bundle.detail}`);
  return bundle.extensionText;
}

async function pollUntil(condition: () => boolean): Promise<void> {
  for (let i = 0; i < POLLS_BEFORE_GIVING_UP && !condition(); i++) await Bun.sleep(POLL_INTERVAL_MILLISECONDS);
}

function writeFileCreatingFolders(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

const EXTENSION_TEXT = builtTextOf(await bundleCopilotExtension(copilotExtensionBuildRequestWith([])));

describe('the dispatcher\'s Copilot extension', () => {
  test('imports the Copilot SDK and Node built-ins, nothing else', () => {
    const importedSpecifiers = new Bun.Transpiler({ loader: 'js' }).scan(EXTENSION_TEXT).imports.map((entry) => entry.path);
    expect(importedSpecifiers).toContain(COPILOT_EXTENSION_SDK_SPECIFIER);
    expect(importedSpecifiers.filter((specifier) => specifier !== COPILOT_EXTENSION_SDK_SPECIFIER && !isBuiltin(specifier))).toEqual([]);
  });

  test('names no path of the checkout, and is the same text on a second build', async () => {
    expect(EXTENSION_TEXT).not.toContain(join(dispatcherDirectoryPath(), '..'));
    expect(EXTENSION_TEXT).not.toContain('/Users/');
    expect(builtTextOf(await bundleCopilotExtension(copilotExtensionBuildRequestWith([])))).toBe(EXTENSION_TEXT);
  });

  test('installed in a repository, registers the workflow under the dispatcher\'s name and reconciles the session from the root', async () => {
    const repositoryRoot = createCanonicalScratchDirectory('copilot-extension-');
    scratchDirectories.push(repositoryRoot);
    const extensionPath = join(repositoryRoot, INSTALLED_EXTENSION_PATH);
    writeFileCreatingFolders(extensionPath, EXTENSION_TEXT);
    writeFileCreatingFolders(join(repositoryRoot, 'node_modules/@github/copilot-sdk/package.json'), FAKE_SDK_PACKAGE);
    writeFileCreatingFolders(join(repositoryRoot, 'node_modules/@github/copilot-sdk/extension.js'), FAKE_SDK_MODULE);
    const fakeCommandPath = join(repositoryRoot, 'bin', COPILOT_EXTENSION_BUILD.SETTLE_COMMAND[0]);
    writeFileCreatingFolders(fakeCommandPath, FAKE_COMMAND_SCRIPT);
    chmodSync(fakeCommandPath, 0o755);
    const childProcess = Bun.spawnSync([process.execPath, extensionPath], {
      cwd:    dirname(extensionPath),
      env:    { PATH: `${join(repositoryRoot, 'bin')}:/usr/bin:/bin` },
      stderr: 'pipe',
    });
    expect(childProcess.stderr.toString()).toBe('');
    const recorded = readFileSync(join(repositoryRoot, 'recorded.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as unknown);
    const meta = frozenMeta();
    expect(meta.name).toBe('agent-progress-dispatch');
    expect(recorded).toEqual([
      { defined: { name: meta.name, description: meta.description, phases: meta.phases.map(({ title, detail }) => ({ title, detail })) } },
      { joinedWorkflows: 1 },
    ]);
    const commandsPath = join(repositoryRoot, 'commands.txt');
    await pollUntil(() => existsSync(commandsPath));
    const reconciliationArguments = `${COPILOT_EXTENSION_BUILD.SETTLE_COMMAND.slice(1).join(' ')} --session session-example`;
    expect(readFileSync(commandsPath, 'utf8')).toBe(`${repositoryRoot}|${reconciliationArguments}|${JSON.stringify({ repositoryRoot })}\n`);
  }, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);
});
