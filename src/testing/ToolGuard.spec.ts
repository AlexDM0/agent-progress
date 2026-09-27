/**
 * What a run on a machine without git does with a guarded spec: skips it by name, counts it in the preloaded report, and fails it instead
 * when `AGENT_PROGRESS_REQUIRE_EVERY_TOOL` is set. Each case runs `bun test` in a child whose PATH holds only `bun` (and, for the control,
 * `git`), since hiding git from this process would change every other spec in the run.
 */
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join }                                  from 'node:path';
import {
  afterEach,
  beforeEach,
  expect,
  test,
} from 'bun:test';

import { CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS }        from './ChildProcessCaseTimeout.ts';
import { createScratchDirectory, removeScratchDirectory } from './ScratchWorkspace.ts';
import { testWhenGitIsPresent }                           from './ToolGuard.ts';

const TOOL_GUARD_MODULE_PATH      = join(import.meta.dir, 'ToolGuard.ts');
const TEST_RUN_REPORT_MODULE_PATH = join(import.meta.dir, 'TestRunReport.ts');

const GUARDED_SUITE_TITLE = 'an example suite that needs git';
const GUARDED_TEST_CLAIM  = 'an example claim that needs git';

const FIXTURE_SPEC_SOURCE = [
  'import { expect, test } from \'bun:test\';',
  `import { describeWhenGitIsPresent, testWhenGitIsPresent } from ${JSON.stringify(TOOL_GUARD_MODULE_PATH)};`,
  `describeWhenGitIsPresent(${JSON.stringify(GUARDED_SUITE_TITLE)}, () => {`,
  '  test(\'holds\', () => expect(1).toBe(1));',
  '});',
  `testWhenGitIsPresent(${JSON.stringify(GUARDED_TEST_CLAIM)}, () => expect(1).toBe(1));`,
].join('\n');

let scratchDirectory = '';

interface FinishedTestRun {
  readonly exitCode: number;
  readonly output:   string;
}

beforeEach(() => {
  scratchDirectory = createScratchDirectory('tool-guard');
  writeFileSync(join(scratchDirectory, 'Fixture.spec.ts'), FIXTURE_SPEC_SOURCE);
});

afterEach(() => {
  removeScratchDirectory(scratchDirectory);
});

function testRunWithOnlyTheseTools(toolPaths: readonly string[], extraEnvironment: Record<string, string> = {}): FinishedTestRun {
  const binaryDirectory = join(scratchDirectory, 'bin');
  mkdirSync(binaryDirectory);
  symlinkSync(process.execPath, join(binaryDirectory, 'bun'));
  for (const toolPath of toolPaths) {
    symlinkSync(toolPath, join(binaryDirectory, toolPath.split('/').at(-1) ?? toolPath));
  }
  const finished = Bun.spawnSync([process.execPath, 'test', '--preload', TEST_RUN_REPORT_MODULE_PATH, './Fixture.spec.ts'], {
    cwd:    scratchDirectory,
    env:    { PATH: binaryDirectory, HOME: scratchDirectory, ...extraEnvironment },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return { exitCode: finished.exitCode, output: `${finished.stdout.toString()}\n${finished.stderr.toString()}` };
}

test('without git the run passes, and the report names both skipped specs with their count', () => {
  const { exitCode, output } = testRunWithOnlyTheseTools([]);
  expect(exitCode, output).toBe(0);
  expect(output).toContain('2 spec(s) skipped for a missing tool');
  expect(output).toContain(`${GUARDED_SUITE_TITLE} [git is missing]`);
  expect(output).toContain(`${GUARDED_TEST_CLAIM} [git is missing]`);
}, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);

test('without git and with AGENT_PROGRESS_REQUIRE_EVERY_TOOL set, the same run fails and names the missing tool', () => {
  const { exitCode, output } = testRunWithOnlyTheseTools([], { AGENT_PROGRESS_REQUIRE_EVERY_TOOL: '1' });
  expect(exitCode, output).not.toBe(0);
  expect(output).toContain('"git" is not on this machine');
  expect(output).not.toContain('skipped for a missing tool');
}, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);

testWhenGitIsPresent('with git on the PATH the guarded specs run and nothing is reported skipped', () => {
  const { exitCode, output } = testRunWithOnlyTheseTools([Bun.which('git') ?? 'git'], { AGENT_PROGRESS_REQUIRE_EVERY_TOOL: '1' });
  expect(exitCode, output).toBe(0);
  expect(output).toContain('2 pass');
  expect(output).not.toContain('skipped for a missing tool');
}, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);
