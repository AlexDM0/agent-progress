/**
 * A Claude `init` and the `update` after it write exactly the files `cli/adoption/FrozenClaudeInstall.json` holds, taken from the
 * install version 19 implementation: every opt-out flag is its own scenario, since each one decides which files exist, and the report
 * lines are compared too, because the table walk produces them. Each skill file is compared against its source in `skills/`, since those
 * change on their own. To
 * retake, only in a commit meant to change an installed text: write the table this spec gathers (`frozenTableFromTheCurrentImplementation`)
 * to the JSON file, and check its diff shows only that change.
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join }                                   from 'node:path';

import { afterAll, expect, test }                             from 'bun:test';
import { filledTemplateOf }                                   from '../../src/shared/FilledTemplate.ts';
import { PRODUCT_NAMES }                                      from '../../src/shared/constants/ProductNames.ts';
import { createScratchGitRepository, removeScratchDirectory } from '../../src/testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent }                           from '../../src/testing/ToolGuard.ts';
import { runCommandLine }                                     from '../Main.ts';
import { createCapturedCommandContext }                       from '../testing/CapturedCommandContext.ts';
import { repositoryFileContentsOf }                           from '../testing/RepositoryFileContents.ts';

interface InstallScenario {
  installedPaths: string[];
  initOutput:     string;
  updateOutput:   string;
}

interface FrozenInstallTable {
  texts:     Record<string, string>;
  scenarios: Record<string, InstallScenario>;
}

import { INSTALLED_SKILL_NAMES } from './constants/ClaudeCodeInstall.ts';

const FROZEN_TABLE_PATH = join(import.meta.dir, 'FrozenClaudeInstall.json');

const OPT_OUT_SCENARIOS: Readonly<Record<string, readonly string[]>> = {
  'every file': [],
  '--no-hooks': ['--no-hooks'],
};

/** The tracker's own store is not installed: `progress.json` carries a fresh tracker id, and the `progress.html` stub its Overseer's URL. */
const TRACKER_STORE_PATHS = new Set(['progress.json', 'progress.html', 'log.jsonl'].map((fileName) => `${PRODUCT_NAMES.DATA_FOLDER}/${fileName}`));

const TRACKER_LOCK_FOLDER = `${PRODUCT_NAMES.DATA_FOLDER}/.lock/`;

const ROOT_STAND_IN = '<root>';

const INSTALLED_SKILLS_FOLDER = '.claude/skills/';

const CHECKOUT_SKILLS_DIRECTORY = join(import.meta.dir, '..', '..', 'skills');

const scratchDirectories: string[] = [];

afterAll(() => {
  for (const directory of scratchDirectories.splice(0)) removeScratchDirectory(directory);
});

/**
 * A skill file copied from this checkout's `skills/`, which change on their own, and filled with its installed name, stands in as the source
 * it was copied from.
 */
function skillCopyStandInOf(relativePath: string, text: string): string | null {
  for (const [sourceFolderName, installedName] of Object.entries(INSTALLED_SKILL_NAMES)) {
    const installedFolder = `${INSTALLED_SKILLS_FOLDER}${installedName}/`;
    if (!relativePath.startsWith(installedFolder)) continue;
    const pathInSkills = `${sourceFolderName}/${relativePath.slice(installedFolder.length)}`;
    const sourcePath   = join(CHECKOUT_SKILLS_DIRECTORY, pathInSkills);
    const copiedText   = existsSync(sourcePath) ? filledTemplateOf(readFileSync(sourcePath, 'utf8'), { skillName: installedName }) : null;
    return copiedText === text ? `<copied from skills/${pathInSkills}>` : null;
  }
  return null;
}

function installedFilesIn(repositoryDirectory: string): Map<string, string> {
  const installedFiles = new Map<string, string>();
  for (const [relativePath, text] of repositoryFileContentsOf(repositoryDirectory)) {
    if (TRACKER_STORE_PATHS.has(relativePath) || relativePath.startsWith(TRACKER_LOCK_FOLDER)) continue;
    installedFiles.set(relativePath, skillCopyStandInOf(relativePath, text) ?? text);
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
