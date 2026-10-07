/**
 * The skills reach a tracked repository as copies in its `.claude/skills/`, never through a global install, so what matters is that `init`
 * writes each folder byte for byte as this checkout holds it and keeps it out of git, that a later refresh carries a changed source file
 * over, and that a file a user put in the folder survives, since the refresh owns only the files the skill ships.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join }                                    from 'node:path';

import { afterEach, expect, test }                                                   from 'bun:test';
import { workspacePathsFor }                                                         from '../../src/services/tracker/Workspace.ts';
import { createScratchGitRepository, removeScratchDirectory }                        from '../../src/testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent }                                                  from '../../src/testing/ToolGuard.ts';
import { runCommandLine }                                                            from '../Main.ts';
import { createCapturedCommandContext }                                              from '../testing/CapturedCommandContext.ts';
import { repositoryFileContentsOf }                                                  from '../testing/RepositoryFileContents.ts';
import { installedFileTextsFor, installedSkillFileTextsFor, skillSourceDirectoryOf } from './InstalledFileGeneration.ts';
import { refreshTrackedRepository }                                                  from './TrackerRefresh.ts';
import type { InstalledSkillName }                                                   from './constants/AgentHostInstalls.ts';

const SKILL_NAMES: readonly InstalledSkillName[] = ['agent-progress', 'agent-progress-orchestrate'];

const INSTALLED_FILE_TEXTS = await installedFileTextsFor({ agentHost: 'claude-code', generatesTheDispatcherScript: false });

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
    agentHost:               'claude-code',
    installedFileTexts:      INSTALLED_FILE_TEXTS,
    installedSkillFileTexts: { 'agent-progress': skillFileTexts, 'agent-progress-orchestrate': skillFileTexts },
    commandName:             'update',
    optOutFlags:             new Set(['no-claude-md', 'no-hooks', 'no-workflow', 'no-agent-definition']),
    writesTheBriefFirst:     false,
    standardError:           () => undefined,
  });
}

describeWhenGitIsPresent('the installed skill folders', () => {
  test('init writes both skill folders byte-identical to this checkout\'s skills/ and git-ignores them', async () => {
    const repositoryDirectory = scratchRepository();

    await initIn(repositoryDirectory);

    for (const skillName of SKILL_NAMES) {
      const installedFolder = join(repositoryDirectory, '.claude', 'skills', skillName);
      expect(repositoryFileContentsOf(installedFolder)).toEqual(repositoryFileContentsOf(skillSourceDirectoryOf(skillName)));
      expect(gitIgnores(repositoryDirectory, `.claude/skills/${skillName}/SKILL.md`), skillName).toBe(true);
    }
  });

  test('the files read for each skill are every file of its source folder, SKILL.md among them', () => {
    const skillFileTexts = installedSkillFileTextsFor('claude-code');
    for (const skillName of SKILL_NAMES) {
      expect([...(skillFileTexts[skillName]?.keys() ?? [])]).toEqual([...repositoryFileContentsOf(skillSourceDirectoryOf(skillName)).keys()].sort());
      expect(skillFileTexts[skillName]?.has('SKILL.md'), skillName).toBe(true);
    }
  });

  test('a refresh rewrites a changed skill file and leaves a file the user added to the folder untouched', () => {
    const repositoryDirectory = scratchRepository();
    refreshSkillsIn(repositoryDirectory, new Map([['SKILL.md', 'Example skill, first version\n'], ['notes/Reference.md', 'Example reference\n']]));
    const userFilePath = join(repositoryDirectory, '.claude', 'skills', 'agent-progress', 'Example user notes.md');
    writeFileSync(userFilePath, 'Alex Example\'s own notes\n');

    refreshSkillsIn(repositoryDirectory, new Map([['SKILL.md', 'Example skill, second version\n'], ['notes/Reference.md', 'Example reference\n']]));

    const installedFolder = join(repositoryDirectory, '.claude', 'skills', 'agent-progress');
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

    expect(readFileSync(join(repositoryDirectory, '.gitignore'), 'utf8')).toBe('.claude/skills/agent-progress/\n.claude/skills/agent-progress-orchestrate/\n');
  });
});
