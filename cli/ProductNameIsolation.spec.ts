/**
 * A build named beside the released program reaches none of the released program's files, and the released program none of the side-by-side
 * build's. The cases that matter: the other program's root variable is ignored by the binary; `init` and `update` refuse a repository the
 * released program tracks while the names differ, and never otherwise; an `update` leaves the other program's installed files byte for byte;
 * and the managed-block markers of the two never contain each other. Every expected name derives from the constant, and the refusal is
 * driven under both sets of names through its names parameter, so flipping the constant edits no case here.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';

import { afterEach, expect, test }                                           from 'bun:test';
import { rootOverrideVariableOf }                                            from '../src/shared/Environment.ts';
import { OperationRefusal }                                                  from '../src/shared/OperationRefusal.ts';
import { ORIGINAL_PRODUCT_NAMES, PRODUCT_NAMES, SIDE_BY_SIDE_PRODUCT_NAMES } from '../src/shared/constants/ProductNames.ts';
import { createScratchGitRepository, removeScratchDirectory }                from '../src/testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent }                                          from '../src/testing/ToolGuard.ts';
import { runCommandLine }                                                    from './Main.ts';
import { refuseBesideAnOlderProgram }                                        from './adoption/OlderProgramRefusal.ts';
import { INSTALLED_SKILL_NAMES, installedSkillNamesFor }                     from './adoption/constants/ClaudeCodeInstall.ts';
import { claudeManagedBlockMarkersFor }                                      from './adoption/constants/ClaudeManagedBlockMarkers.ts';
import { createCapturedCommandContext }                                      from './testing/CapturedCommandContext.ts';
import { runAgentProgress }                                                  from './testing/CliProcess.ts';

const OTHER_PRODUCT_NAMES = PRODUCT_NAMES === ORIGINAL_PRODUCT_NAMES ? SIDE_BY_SIDE_PRODUCT_NAMES : ORIGINAL_PRODUCT_NAMES;

const OTHER_PROGRAMS_HOOK_COMMAND = { type: 'command', command: `${OTHER_PRODUCT_NAMES.PROGRAM} hook subagent-stop`, timeout: 20 };

const OTHER_PROGRAMS_HOOK_SETTINGS = { hooks: { SubagentStop: [{ matcher: '', hooks: [OTHER_PROGRAMS_HOOK_COMMAND] }] } };

const BUILT_BESIDE_THE_RELEASED_PROGRAM = PRODUCT_NAMES.PROGRAM !== ORIGINAL_PRODUCT_NAMES.PROGRAM;

const scratchDirectories: string[] = [];

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) removeScratchDirectory(directory);
});

function scratchRepository(): string {
  const repositoryDirectory = createScratchGitRepository('product-name-isolation');
  scratchDirectories.push(repositoryDirectory);
  return repositoryDirectory;
}

/** What the other program would keep at a root: its data folder holding a progress file, recognisably its own. */
function plantOtherProgramsTracker(repositoryDirectory: string): string {
  const progressFilePath = join(repositoryDirectory, OTHER_PRODUCT_NAMES.DATA_FOLDER, 'progress.json');
  mkdirSync(join(repositoryDirectory, OTHER_PRODUCT_NAMES.DATA_FOLDER), { recursive: true });
  writeFileSync(progressFilePath, '{ "example": "the other program\'s tracker" }\n');
  return progressFilePath;
}

async function exitCodeOf(commandLineArguments: readonly string[], repositoryDirectory: string): Promise<{ exitCode: number; errorText: string }> {
  const context  = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
  const exitCode = await runCommandLine([...commandLineArguments], context);
  return { exitCode, errorText: context.errorText() };
}

test('the refusal beside an older program holds under both sets of names: the side-by-side build refuses, the released program never does', () => {
  const repositoryDirectory = scratchRepository();
  mkdirSync(join(repositoryDirectory, ORIGINAL_PRODUCT_NAMES.DATA_FOLDER));

  expect(() => refuseBesideAnOlderProgram(repositoryDirectory, SIDE_BY_SIDE_PRODUCT_NAMES)).toThrow(OperationRefusal);
  expect(() => refuseBesideAnOlderProgram(repositoryDirectory, ORIGINAL_PRODUCT_NAMES)).not.toThrow();
  try {
    refuseBesideAnOlderProgram(repositoryDirectory, SIDE_BY_SIDE_PRODUCT_NAMES);
  } catch (error) {
    expect(error instanceof OperationRefusal ? error.detail : null).toEqual({
      kind:                'older-program-present',
      rootDirectory:       repositoryDirectory,
      olderDataFolderPath: join(repositoryDirectory, ORIGINAL_PRODUCT_NAMES.DATA_FOLDER),
      program:             SIDE_BY_SIDE_PRODUCT_NAMES.PROGRAM,
      olderProgram:        ORIGINAL_PRODUCT_NAMES.PROGRAM,
    });
  }
});

test('no refusal without the released program\'s data folder, under either set of names', () => {
  const repositoryDirectory = scratchRepository();
  expect(() => refuseBesideAnOlderProgram(repositoryDirectory, SIDE_BY_SIDE_PRODUCT_NAMES)).not.toThrow();
  expect(() => refuseBesideAnOlderProgram(repositoryDirectory, ORIGINAL_PRODUCT_NAMES)).not.toThrow();
});

test('each program\'s managed-block markers and skill folders are its own, and neither marker contains the other program\'s', () => {
  const originalMarkers   = claudeManagedBlockMarkersFor(ORIGINAL_PRODUCT_NAMES);
  const sideBySideMarkers = claudeManagedBlockMarkersFor(SIDE_BY_SIDE_PRODUCT_NAMES);
  for (const markerName of ['start', 'end'] as const) {
    expect(sideBySideMarkers[markerName].includes(originalMarkers[markerName])).toBe(false);
    expect(originalMarkers[markerName].includes(sideBySideMarkers[markerName])).toBe(false);
  }
  expect(claudeManagedBlockMarkersFor(PRODUCT_NAMES).start).toBe(`<!-- ${PRODUCT_NAMES.PROGRAM}:managed:start -->`);
  expect(INSTALLED_SKILL_NAMES).toEqual(installedSkillNamesFor(PRODUCT_NAMES));
  expect(Object.values(installedSkillNamesFor(SIDE_BY_SIDE_PRODUCT_NAMES))).toEqual(['agent-po-v2', 'agent-progress-orchestrate-v2']);
});

describeWhenGitIsPresent('two programs side by side', () => {
  test('init and update refuse older-program-present at exit 1 beside the released program\'s data folder, while the names differ', async () => {
    const repositoryDirectory = scratchRepository();
    const initialised = await exitCodeOf(['init', '--project', 'Example Agency', '--no-workflow'], repositoryDirectory);
    expect(initialised.exitCode).toBe(0);
    mkdirSync(join(repositoryDirectory, ORIGINAL_PRODUCT_NAMES.DATA_FOLDER), { recursive: true });

    const initAgain = await exitCodeOf(['init', '--no-workflow'], repositoryDirectory);
    const update    = await exitCodeOf(['update', '--no-workflow'], repositoryDirectory);

    for (const outcome of [initAgain, update]) {
      if (BUILT_BESIDE_THE_RELEASED_PROGRAM) {
        expect(outcome.exitCode).toBe(1);
        expect(outcome.errorText).toContain(`${join(repositoryDirectory, ORIGINAL_PRODUCT_NAMES.DATA_FOLDER)} holds what ${ORIGINAL_PRODUCT_NAMES.PROGRAM} keeps`);
      } else {
        expect(outcome.exitCode).toBe(0);
      }
    }
  });

  test('the binary ignores the other program\'s root variable pointing at the other program\'s tracker', async () => {
    const otherRepository = scratchRepository();
    const ownRepository   = scratchRepository();
    plantOtherProgramsTracker(otherRepository);

    const result = await runAgentProgress(['status', '--json'], {
      currentDirectory: ownRepository,
      environment:      { [rootOverrideVariableOf(OTHER_PRODUCT_NAMES)]: otherRepository },
    });

    expect(result.exitCode).toBe(1);
    expect(result.standardError).toContain(ownRepository);
    expect(result.standardError).not.toContain(otherRepository);
  });

  test('update leaves the other program\'s managed block, hooks, agent definition and skill folders byte for byte', async () => {
    const repositoryDirectory = scratchRepository();
    const otherMarkers        = claudeManagedBlockMarkersFor(OTHER_PRODUCT_NAMES);
    const otherFiles: Readonly<Record<string, string>> = {
      'CLAUDE.md':                                                            `# Example Agency\n\n${otherMarkers.start}\nThe other program's block.\n${otherMarkers.end}\n`,
      '.claude/settings.local.json':                                          `${JSON.stringify(OTHER_PROGRAMS_HOOK_SETTINGS, null, 2)}\n`,
      [`.claude/agents/${OTHER_PRODUCT_NAMES.PROGRAM}-worker.md`]:            '---\nname: the other program\'s worker\n---\n',
      [`.claude/skills/${OTHER_PRODUCT_NAMES.PRODUCT_OWNER_SKILL}/SKILL.md`]: '---\nname: the other program\'s skill\n---\n',
      [`.claude/skills/${OTHER_PRODUCT_NAMES.ORCHESTRATE_SKILL}/SKILL.md`]:   '---\nname: the other program\'s skill\n---\n',
    };
    expect((await exitCodeOf(['init', '--project', 'Example Agency', '--no-workflow'], repositoryDirectory)).exitCode).toBe(0);
    for (const [relativePath, text] of Object.entries(otherFiles)) {
      mkdirSync(join(repositoryDirectory, relativePath, '..'), { recursive: true });
      const existingText = existsSync(join(repositoryDirectory, relativePath)) ? readFileSync(join(repositoryDirectory, relativePath), 'utf8') : '';
      writeFileSync(join(repositoryDirectory, relativePath), relativePath === 'CLAUDE.md' ? `${existingText}\n${text}` : text);
    }
    const before = Object.fromEntries(Object.keys(otherFiles).map((relativePath) => [relativePath, readFileSync(join(repositoryDirectory, relativePath), 'utf8')]));

    expect((await exitCodeOf(['update', '--no-workflow'], repositoryDirectory)).exitCode).toBe(0);

    const settingsText = readFileSync(join(repositoryDirectory, '.claude/settings.local.json'), 'utf8');
    expect(settingsText).toContain(`"${OTHER_PRODUCT_NAMES.PROGRAM} hook subagent-stop"`);
    for (const relativePath of Object.keys(otherFiles).filter((path) => path !== '.claude/settings.local.json')) {
      expect(readFileSync(join(repositoryDirectory, relativePath), 'utf8'), relativePath).toBe(before[relativePath] ?? '');
    }
  });
});
