/**
 * A build named beside the released program reaches none of the released program's files, and the released program none of the side-by-side
 * build's. The cases that matter: the other program's root variable is ignored by the binary; `init` and `update` refuse a repository the
 * released program tracks while the names differ, and never otherwise; an `update` leaves the other program's installed files byte for byte
 * and installs its own skills under its own names; and the managed-block markers of the two never contain each other. Every expected name
 * derives from the constant, and each case runs under both sets of names, the refusal through its names parameter and the binary once as
 * built and once preloaded to be the other program, so flipping the constant edits no case here.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';

import { afterEach, expect, test } from 'bun:test';
import { rootOverrideVariableOf }  from '../src/shared/Environment.ts';
import { OperationRefusal }        from '../src/shared/OperationRefusal.ts';
import {
  ORIGINAL_PRODUCT_NAMES,
  PRODUCT_NAMES,
  type ProductNames,
  SIDE_BY_SIDE_PRODUCT_NAMES
} from '../src/shared/constants/ProductNames.ts';
import { createScratchGitRepository, removeScratchDirectory } from '../src/testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent }                           from '../src/testing/ToolGuard.ts';
import { refuseBesideAnOlderProgram }                         from './adoption/OlderProgramRefusal.ts';
import { INSTALLED_SKILL_NAMES, installedSkillNamesFor }      from './adoption/constants/ClaudeCodeInstall.ts';
import { claudeManagedBlockMarkersFor }                       from './adoption/constants/ClaudeManagedBlockMarkers.ts';
import { type AgentProgressResult, runAgentProgress }         from './testing/CliProcess.ts';

const OTHER_PRODUCT_NAMES = PRODUCT_NAMES === ORIGINAL_PRODUCT_NAMES ? SIDE_BY_SIDE_PRODUCT_NAMES : ORIGINAL_PRODUCT_NAMES;

/** Each program in turn: the binary as built, and the binary preloaded to be the other program. */
const BOTH_PROGRAMS = [
  { names: PRODUCT_NAMES, otherNames: OTHER_PRODUCT_NAMES, runsAsTheOtherProgram: false },
  { names: OTHER_PRODUCT_NAMES, otherNames: PRODUCT_NAMES, runsAsTheOtherProgram: true },
] as const;

type ProgramSide = (typeof BOTH_PROGRAMS)[number];

const BINARY_CASE_TIMEOUT_MILLISECONDS = 60_000;

const scratchDirectories: string[] = [];

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) removeScratchDirectory(directory);
});

function scratchRepository(): string {
  const repositoryDirectory = createScratchGitRepository('product-name-isolation');
  scratchDirectories.push(repositoryDirectory);
  return repositoryDirectory;
}

function binaryRunAs(side: ProgramSide, repositoryDirectory: string) {
  return (commandLineArguments: readonly string[], environment?: Record<string, string>): Promise<AgentProgressResult> => runAgentProgress(
    commandLineArguments,
    { currentDirectory: repositoryDirectory, runsAsTheOtherProgram: side.runsAsTheOtherProgram, ...(environment === undefined ? {} : { environment }) },
  );
}

function hookSettingsOf(productNames: Readonly<ProductNames>): string {
  const hookCommand = { type: 'command', command: `${productNames.PROGRAM} hook subagent-stop`, timeout: 20 };
  return `${JSON.stringify({ hooks: { SubagentStop: [{ matcher: '', hooks: [hookCommand] }] } }, null, 2)}\n`;
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

describeWhenGitIsPresent('two programs side by side, each run as a binary', () => {
  test('the preloaded binary is the other program, so every case below runs both branches', async () => {
    for (const side of BOTH_PROGRAMS) {
      const repositoryDirectory = scratchRepository();
      const initialised         = await binaryRunAs(side, repositoryDirectory)(['init', '--project', 'Example Agency']);
      expect(initialised.exitCode, initialised.standardError).toBe(0);
      expect(existsSync(join(repositoryDirectory, side.names.DATA_FOLDER, 'progress.json')), side.names.PROGRAM).toBe(true);
      expect(existsSync(join(repositoryDirectory, side.otherNames.DATA_FOLDER)), side.names.PROGRAM).toBe(false);
    }
  }, BINARY_CASE_TIMEOUT_MILLISECONDS);

  test('init and update refuse older-program-present at exit 1 beside the released program\'s data folder, and the released program never does', async () => {
    for (const side of BOTH_PROGRAMS) {
      const repositoryDirectory = scratchRepository();
      const run                 = binaryRunAs(side, repositoryDirectory);
      expect((await run(['init', '--project', 'Example Agency'])).exitCode).toBe(0);
      mkdirSync(join(repositoryDirectory, ORIGINAL_PRODUCT_NAMES.DATA_FOLDER), { recursive: true });

      for (const outcome of [await run(['init']), await run(['update'])]) {
        if (side.names.PROGRAM === ORIGINAL_PRODUCT_NAMES.PROGRAM) {
          expect(outcome.exitCode, outcome.standardError).toBe(0);
        } else {
          expect(outcome.exitCode, side.names.PROGRAM).toBe(1);
          expect(outcome.standardError).toContain(`${join(repositoryDirectory, ORIGINAL_PRODUCT_NAMES.DATA_FOLDER)} holds what ${ORIGINAL_PRODUCT_NAMES.PROGRAM} keeps`);
        }
      }
    }
  }, BINARY_CASE_TIMEOUT_MILLISECONDS);

  test('the binary ignores the other program\'s root variable pointing at the other program\'s tracker', async () => {
    for (const side of BOTH_PROGRAMS) {
      const otherRepository = scratchRepository();
      const ownRepository   = scratchRepository();
      mkdirSync(join(otherRepository, side.otherNames.DATA_FOLDER), { recursive: true });
      writeFileSync(join(otherRepository, side.otherNames.DATA_FOLDER, 'progress.json'), '{ "example": "the other program\'s tracker" }\n');

      const result = await binaryRunAs(side, ownRepository)(['status', '--json'], { [rootOverrideVariableOf(side.otherNames)]: otherRepository });

      expect(result.exitCode, side.names.PROGRAM).toBe(1);
      expect(result.standardError).toContain(ownRepository);
      expect(result.standardError).not.toContain(otherRepository);
    }
  }, BINARY_CASE_TIMEOUT_MILLISECONDS);

  test('update leaves the other program\'s managed block, hooks, agent definition and skill folders byte for byte, and keeps its own skills', async () => {
    for (const side of BOTH_PROGRAMS) {
      const repositoryDirectory = scratchRepository();
      const run                 = binaryRunAs(side, repositoryDirectory);
      const otherMarkers        = claudeManagedBlockMarkersFor(side.otherNames);
      const otherFiles: Readonly<Record<string, string>> = {
        'CLAUDE.md':                                                        `${otherMarkers.start}\nThe other program's block.\n${otherMarkers.end}\n`,
        '.claude/settings.local.json':                                      hookSettingsOf(side.otherNames),
        [`.claude/agents/${side.otherNames.PROGRAM}-worker.md`]:            '---\nname: the other program\'s worker\n---\n',
        [`.claude/skills/${side.otherNames.PRODUCT_OWNER_SKILL}/SKILL.md`]: '---\nname: the other program\'s skill\n---\n',
        [`.claude/skills/${side.otherNames.ORCHESTRATE_SKILL}/SKILL.md`]:   '---\nname: the other program\'s skill\n---\n',
      };
      expect((await run(['init', '--project', 'Example Agency'])).exitCode).toBe(0);
      for (const [relativePath, text] of Object.entries(otherFiles)) {
        mkdirSync(join(repositoryDirectory, relativePath, '..'), { recursive: true });
        const existingText = existsSync(join(repositoryDirectory, relativePath)) ? readFileSync(join(repositoryDirectory, relativePath), 'utf8') : '';
        writeFileSync(join(repositoryDirectory, relativePath), relativePath === 'CLAUDE.md' ? `${existingText}\n${text}` : text);
      }
      const before = Object.fromEntries(Object.keys(otherFiles).map((relativePath) => [relativePath, readFileSync(join(repositoryDirectory, relativePath), 'utf8')]));

      const updated = await run(['update']);
      expect(updated.exitCode, updated.standardError).toBe(0);

      const settingsText = readFileSync(join(repositoryDirectory, '.claude/settings.local.json'), 'utf8');
      expect(settingsText).toContain(`"${side.otherNames.PROGRAM} hook subagent-stop"`);
      expect(settingsText).toContain(`"${side.names.PROGRAM} hook session-start"`);
      for (const relativePath of Object.keys(otherFiles).filter((path) => path !== '.claude/settings.local.json')) {
        expect(readFileSync(join(repositoryDirectory, relativePath), 'utf8'), `${side.names.PROGRAM}: ${relativePath}`).toBe(before[relativePath] ?? '');
      }
      for (const skillName of [side.names.PRODUCT_OWNER_SKILL, side.names.ORCHESTRATE_SKILL]) {
        expect(readFileSync(join(repositoryDirectory, '.claude', 'skills', skillName, 'SKILL.md'), 'utf8')).toStartWith(`---\nname: ${skillName}\n`);
      }
    }
  }, BINARY_CASE_TIMEOUT_MILLISECONDS);
});
