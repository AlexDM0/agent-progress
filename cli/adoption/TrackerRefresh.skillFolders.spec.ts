/**
 * The skills reach a tracked repository as copies in its `.claude/skills/`, never through a global install, so what matters is that `init`
 * writes each folder byte for byte as this checkout holds it and keeps it out of git, that a later refresh carries a changed source file
 * over, and that a file a user put in the folder survives, since the refresh owns only the files the skill ships. The skill folder retired at
 * install version 10 goes the same way: its shipped files and its `.gitignore` entry are removed, a user's file in it stays.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';

import { afterEach, expect, test }                                                from 'bun:test';
import { workspacePathsFor }                                                      from '../../src/services/tracker/Workspace.ts';
import { PRODUCT_NAMES }                                                          from '../../src/shared/constants/ProductNames.ts';
import { createScratchGitRepository, removeScratchDirectory }                     from '../../src/testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent }                                               from '../../src/testing/ToolGuard.ts';
import { filledTemplateOf }                                                       from '../FilledTemplate.ts';
import { runCommandLine }                                                         from '../Main.ts';
import { createCapturedCommandContext }                                           from '../testing/CapturedCommandContext.ts';
import { repositoryFileContentsOf }                                               from '../testing/RepositoryFileContents.ts';
import { installedFileTextsFor, installedSkillFileTexts, skillSourceDirectoryOf } from './InstalledFileGeneration.ts';
import { refreshTrackedRepository }                                               from './TrackerRefresh.ts';
import { INSTALLED_SKILL_NAMES, type SkillSourceFolderName }                      from './constants/ClaudeCodeInstall.ts';

const SKILLS = Object.entries(INSTALLED_SKILL_NAMES) as [SkillSourceFolderName, string][];

const RETIRED_SKILL_FOLDER = join('.claude', 'skills', PRODUCT_NAMES.PROGRAM);

const PRODUCT_OWNER_SKILL_FOLDER = join('.claude', 'skills', PRODUCT_NAMES.PRODUCT_OWNER_SKILL);

const INSTALLED_FILE_TEXTS = await installedFileTextsFor({ generatesTheDispatcherScript: false });

const scratchDirectories: string[] = [];

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) removeScratchDirectory(directory);
});

function scratchRepository(): string {
  const repositoryDirectory = createScratchGitRepository('skill-folders');
  scratchDirectories.push(repositoryDirectory);
  return repositoryDirectory;
}

function gitIgnores(repositoryDirectory: string, pathInRepository: string): boolean {
  return Bun.spawnSync(['git', '-C', repositoryDirectory, 'check-ignore', '-q', pathInRepository]).exitCode === 0;
}

async function initIn(repositoryDirectory: string): Promise<void> {
  const context  = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
  const exitCode = await runCommandLine(['init', '--project', 'Example Agency', '--no-workflow'], context);
  if (exitCode !== 0) throw new Error(`init exited ${exitCode}: ${context.errorText()}`);
}

function refreshSkillsIn(repositoryDirectory: string, skillFileTexts: ReadonlyMap<string, string>): void {
  refreshTrackedRepository({
    workspace:               workspacePathsFor(repositoryDirectory),
    installedFileTexts:      INSTALLED_FILE_TEXTS,
    installedSkillFileTexts: Object.fromEntries(Object.values(INSTALLED_SKILL_NAMES).map((installedName) => [installedName, skillFileTexts])),
    commandName:             'update',
    optOutFlags:             new Set(['no-claude-md', 'no-hooks', 'no-workflow', 'no-agent-definition']),
    writesTheBriefFirst:     false,
    standardError:           () => undefined,
  });
}

describeWhenGitIsPresent('the installed skill folders', () => {
  test('init writes each skill folder under the product\'s name for it, this checkout\'s files filled with that name, and git-ignores it', async () => {
    const repositoryDirectory = scratchRepository();

    await initIn(repositoryDirectory);

    for (const [sourceFolderName, installedName] of SKILLS) {
      const installedFolder = join(repositoryDirectory, '.claude', 'skills', installedName);
      const sourceFiles     = repositoryFileContentsOf(skillSourceDirectoryOf(sourceFolderName));
      expect(repositoryFileContentsOf(installedFolder)).toEqual(new Map([...sourceFiles].map(([path, text]) => [path, filledTemplateOf(text, { skillName: installedName })])));
      expect(readFileSync(join(installedFolder, 'SKILL.md'), 'utf8')).toContain(`\nname: ${installedName}\n`);
      expect(gitIgnores(repositoryDirectory, `.claude/skills/${installedName}/SKILL.md`), installedName).toBe(true);
    }
  });

  test('every source SKILL.md takes its name from the install, so the folder and the name Claude Code reads cannot disagree', () => {
    for (const [sourceFolderName] of SKILLS) {
      expect(readFileSync(join(skillSourceDirectoryOf(sourceFolderName), 'SKILL.md'), 'utf8'), sourceFolderName).toStartWith('---\nname: {{skillName}}\n');
    }
  });

  test('the files read for each skill are every file of its source folder, SKILL.md among them', () => {
    const skillFileTexts = installedSkillFileTexts();
    for (const [sourceFolderName, installedName] of SKILLS) {
      expect([...(skillFileTexts[installedName]?.keys() ?? [])]).toEqual([...repositoryFileContentsOf(skillSourceDirectoryOf(sourceFolderName)).keys()].sort());
      expect(skillFileTexts[installedName]?.has('SKILL.md'), installedName).toBe(true);
    }
  });

  test('a refresh rewrites a changed skill file and leaves a file the user added to the folder untouched', () => {
    const repositoryDirectory = scratchRepository();
    refreshSkillsIn(repositoryDirectory, new Map([['SKILL.md', 'Example skill, first version\n'], ['notes/Reference.md', 'Example reference\n']]));
    const userFilePath = join(repositoryDirectory, PRODUCT_OWNER_SKILL_FOLDER, 'Example user notes.md');
    writeFileSync(userFilePath, 'Alex Example\'s own notes\n');

    refreshSkillsIn(repositoryDirectory, new Map([['SKILL.md', 'Example skill, second version\n'], ['notes/Reference.md', 'Example reference\n']]));

    const installedFolder = join(repositoryDirectory, PRODUCT_OWNER_SKILL_FOLDER);
    expect(readFileSync(join(installedFolder, 'SKILL.md'), 'utf8')).toBe('Example skill, second version\n');
    expect(readFileSync(join(installedFolder, 'notes', 'Reference.md'), 'utf8')).toBe('Example reference\n');
    expect(existsSync(userFilePath)).toBe(true);
    expect(readFileSync(userFilePath, 'utf8')).toBe('Alex Example\'s own notes\n');
  });

  test('a second refresh adds no second .gitignore entry', () => {
    const repositoryDirectory = scratchRepository();
    const skillFileTexts = new Map([['SKILL.md', 'Example skill\n']]);
    refreshSkillsIn(repositoryDirectory, skillFileTexts);
    refreshSkillsIn(repositoryDirectory, skillFileTexts);

    expect(readFileSync(join(repositoryDirectory, '.gitignore'), 'utf8'))
      .toBe(`.claude/skills/${PRODUCT_NAMES.PRODUCT_OWNER_SKILL}/\n.claude/skills/${PRODUCT_NAMES.ORCHESTRATE_SKILL}/\n`);
  });
});

/** Plants what an install at version 9 left: the retired skill's two files, its `.gitignore` entry and the manifest naming 9. */
function plantVersionNineSkillFolder(repositoryDirectory: string): void {
  const retiredFolder = join(repositoryDirectory, RETIRED_SKILL_FOLDER);
  mkdirSync(retiredFolder, { recursive: true });
  writeFileSync(join(retiredFolder, 'SKILL.md'), 'Example retired skill\n');
  writeFileSync(join(retiredFolder, 'Reference.md'), 'Example retired reference\n');
  appendFileSync(join(repositoryDirectory, '.gitignore'), `.claude/skills/${PRODUCT_NAMES.PROGRAM}/\n`);
  writeFileSync(join(repositoryDirectory, PRODUCT_NAMES.DATA_FOLDER, 'version.json'), '{\n  "installVersion": 9,\n  "agentHost": "claude-code"\n}\n');
}

async function updateIn(repositoryDirectory: string): Promise<string> {
  const context  = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
  const exitCode = await runCommandLine(['update', '--no-workflow'], context);
  if (exitCode !== 0) throw new Error(`update exited ${exitCode}: ${context.errorText()}`);
  return context.outputText();
}

describeWhenGitIsPresent('the retired agent-progress skill folder', () => {
  test('update over a version 9 install removes the files it installed there, the folder and its .gitignore entry', async () => {
    const repositoryDirectory = scratchRepository();
    await initIn(repositoryDirectory);
    plantVersionNineSkillFolder(repositoryDirectory);

    const output = await updateIn(repositoryDirectory);

    expect(existsSync(join(repositoryDirectory, RETIRED_SKILL_FOLDER))).toBe(false);
    expect(readFileSync(join(repositoryDirectory, '.gitignore'), 'utf8')).not.toContain(`.claude/skills/${PRODUCT_NAMES.PROGRAM}/\n`);
    expect(readFileSync(join(repositoryDirectory, '.gitignore'), 'utf8')).toContain(`.claude/skills/${PRODUCT_NAMES.PRODUCT_OWNER_SKILL}/\n`);
    expect(output).toContain(`${RETIRED_SKILL_FOLDER}, .gitignore entry removed)`);
    expect(output).toContain('retired (');
  });

  test('a file the user put in the retired folder stays, with the folder, while the installed files go', async () => {
    const repositoryDirectory = scratchRepository();
    await initIn(repositoryDirectory);
    plantVersionNineSkillFolder(repositoryDirectory);
    const userFilePath = join(repositoryDirectory, RETIRED_SKILL_FOLDER, 'Example user notes.md');
    writeFileSync(userFilePath, 'Alex Example\'s own notes\n');

    await updateIn(repositoryDirectory);

    expect(readdirSync(join(repositoryDirectory, RETIRED_SKILL_FOLDER))).toEqual(['Example user notes.md']);
    expect(readFileSync(userFilePath, 'utf8')).toBe('Alex Example\'s own notes\n');
  });

  test('a repository that never had the retired folder hears nothing about it', async () => {
    const repositoryDirectory = scratchRepository();
    await initIn(repositoryDirectory);

    expect(await updateIn(repositoryDirectory)).not.toContain('retired');
  });
});
