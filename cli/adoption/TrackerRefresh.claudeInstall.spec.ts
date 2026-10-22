/**
 * A Claude `init` and the `update` after it write exactly the files `cli/adoption/FrozenClaudeInstall.json` holds, taken from the
 * implementation before the install became a per-host table: every opt-out flag is its own scenario, since each one decides which files
 * exist, and the report lines are compared too, because the table walk now produces them. The dispatcher script is compared against a fresh
 * bundle instead, since `dispatcher/` changes it on its own, and each skill file against its source in `skills/` for the same reason. To
 * retake, only in a commit meant to change an installed text: write the table this spec gathers (`frozenTableFromTheCurrentImplementation`)
 * to the JSON file, and check its diff shows only that change.
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join }                                   from 'node:path';

import { afterAll, expect, test }                             from 'bun:test';
import { createScratchGitRepository, removeScratchDirectory } from '../../src/testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent }                           from '../../src/testing/ToolGuard.ts';
import { runCommandLine }                                     from '../Main.ts';
import { createCapturedCommandContext }                       from '../testing/CapturedCommandContext.ts';
import { repositoryFileContentsOf }                           from '../testing/RepositoryFileContents.ts';
import { installedFileTextsFor }                              from './InstalledFileGeneration.ts';

interface InstallScenario {
  installedPaths: string[];
  initOutput:     string;
  updateOutput:   string;
}

interface FrozenInstallTable {
  texts:     Record<string, string>;
  scenarios: Record<string, InstallScenario>;
}

const FROZEN_TABLE_PATH = join(import.meta.dir, 'FrozenClaudeInstall.json');

const OPT_OUT_SCENARIOS: Readonly<Record<string, readonly string[]>> = {
  'every file':                          [],
  '--no-claude-md':                      ['--no-claude-md'],
  '--no-hooks':                          ['--no-hooks'],
  '--no-workflow':                       ['--no-workflow'],
  '--no-workflow --no-agent-definition': ['--no-workflow', '--no-agent-definition'],
};

/** The tracker's own store is not installed: `progress.json` carries a fresh tracker id, and the page carries the page bundle. */
const TRACKER_STORE_PATHS = new Set([
  '.agent-progress/progress.json',
  '.agent-progress/progress.html',
  '.agent-progress/progress.stamp.js',
  '.agent-progress/log.jsonl',
]);

const TRACKER_LOCK_FOLDER = '.agent-progress/.lock/';

const DISPATCHER_SCRIPT_PATH = '.agent-progress/agent-progress-dispatch.js';

const DISPATCHER_SCRIPT_STAND_IN = '<the dispatcher script bundled from dispatcher/>';

const ROOT_STAND_IN = '<root>';

const INSTALLED_SKILLS_FOLDER = '.claude/skills/';

const CHECKOUT_SKILLS_DIRECTORY = join(import.meta.dir, '..', '..', 'skills');

const GENERATED_DISPATCHER_SCRIPT = (await installedFileTextsFor({ generatesTheDispatcherScript: true })).dispatcherScript ?? '';

const scratchDirectories: string[] = [];

afterAll(() => {
  for (const directory of scratchDirectories.splice(0)) removeScratchDirectory(directory);
});

/** A skill file copied byte for byte from this checkout's `skills/`, which change on their own, stands in as the source it was copied from. */
function skillCopyStandInOf(relativePath: string, text: string): string | null {
  if (!relativePath.startsWith(INSTALLED_SKILLS_FOLDER)) return null;
  const sourcePath = join(CHECKOUT_SKILLS_DIRECTORY, relativePath.slice(INSTALLED_SKILLS_FOLDER.length));
  return existsSync(sourcePath) && readFileSync(sourcePath, 'utf8') === text ? `<copied from skills/${relativePath.slice(INSTALLED_SKILLS_FOLDER.length)}>` : null;
}

function installedFilesIn(repositoryDirectory: string): Map<string, string> {
  const installedFiles = new Map<string, string>();
  for (const [relativePath, text] of repositoryFileContentsOf(repositoryDirectory)) {
    if (TRACKER_STORE_PATHS.has(relativePath) || relativePath.startsWith(TRACKER_LOCK_FOLDER)) continue;
    const dispatcherStandIn = relativePath === DISPATCHER_SCRIPT_PATH && text === GENERATED_DISPATCHER_SCRIPT ? DISPATCHER_SCRIPT_STAND_IN : null;
    installedFiles.set(relativePath, dispatcherStandIn ?? skillCopyStandInOf(relativePath, text) ?? text);
  }
  return installedFiles;
}

function rootNamedAsStandIn(text: string, repositoryDirectory: string): string {
  return text.split(realpathSync(repositoryDirectory)).join(ROOT_STAND_IN).split(repositoryDirectory).join(ROOT_STAND_IN);
}

async function outputOfRunning(commandWords: readonly string[], repositoryDirectory: string): Promise<string> {
  const context  = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
  const exitCode = await runCommandLine([...commandWords], context);
  if (exitCode !== 0 || context.errorText() !== '') throw new Error(`\`agent-progress ${commandWords.join(' ')}\` exited ${exitCode}: ${context.errorText()}`);
  return rootNamedAsStandIn(context.outputText(), repositoryDirectory);
}

function recordTexts(texts: Record<string, string>, installedFiles: Map<string, string>): void {
  for (const [relativePath, text] of installedFiles) {
    if (Object.hasOwn(texts, relativePath) && texts[relativePath] !== text) throw new Error(`${relativePath} differs between two scenarios.`);
    texts[relativePath] = text;
  }
}

async function frozenTableFromTheCurrentImplementation(): Promise<FrozenInstallTable> {
  const table: FrozenInstallTable = { texts: {}, scenarios: {} };
  for (const [scenarioName, optOutFlags] of Object.entries(OPT_OUT_SCENARIOS)) {
    const repositoryDirectory = createScratchGitRepository('claude-install');
    scratchDirectories.push(repositoryDirectory);
    const initOutput        = await outputOfRunning(['init', '--project', 'Example Agency', ...optOutFlags], repositoryDirectory);
    const filesAfterInit    = installedFilesIn(repositoryDirectory);
    const updateOutput      = await outputOfRunning(['update', ...optOutFlags], repositoryDirectory);
    const filesAfterUpdate  = installedFilesIn(repositoryDirectory);
    recordTexts(table.texts, filesAfterInit);
    recordTexts(table.texts, filesAfterUpdate);
    if ([...filesAfterInit.keys()].join('\n') !== [...filesAfterUpdate.keys()].join('\n')) throw new Error(`${scenarioName}: update wrote other files than init.`);
    table.scenarios[scenarioName] = { installedPaths: [...filesAfterInit.keys()].sort(), initOutput, updateOutput };
  }
  return table;
}

describeWhenGitIsPresent('a Claude install', () => {
  test('init and update write byte-identical files and report lines to the implementation the frozen table was taken from, for every opt-out', async () => {
    const frozenTable = JSON.parse(readFileSync(FROZEN_TABLE_PATH, 'utf8')) as FrozenInstallTable;

    const currentTable = await frozenTableFromTheCurrentImplementation();

    expect(Object.keys(currentTable.scenarios)).toEqual(Object.keys(OPT_OUT_SCENARIOS));
    expect(currentTable).toEqual(frozenTable);
  });
});
