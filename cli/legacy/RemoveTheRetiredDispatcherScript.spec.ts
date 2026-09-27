/**
 * The dispatcher copy an older agent-progress installed under `.claude/workflows/`, end to end through `init` and `update`. The cases that
 * matter: both commands remove it and name it on the workflow line, so only one dispatcher is left to launch; a second run has nothing to
 * remove and says nothing of it; the folder goes with the copy only when nothing else is in it; `--no-workflow` leaves `.claude/workflows/`
 * alone, since a copy there may be the project's own; and a refresh cut short leaves the copy for the rerun to remove and report. It is
 * deleted with `cli/legacy/RemoveTheRetiredDispatcherScript.ts`.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
}               from 'node:fs';
import { join } from 'node:path';

import { afterEach, expect, test }                            from 'bun:test';
import { createScratchGitRepository, removeScratchDirectory } from '../../src/testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent }                           from '../../src/testing/ToolGuard.ts';
import { runCommandLine }                                     from '../Main.ts';
import { installedFileTextsFor }                              from '../adoption/InstalledFileGeneration.ts';
import { createCapturedCommandContext }                       from '../testing/CapturedCommandContext.ts';

const scratchDirectories: string[] = [];

const RUNNING_AS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0;

const READ_AND_ENTER_ONLY_MODE = 0o555;

const OWNER_FULL_ACCESS_MODE = 0o755;

const GENERATED_DISPATCHER_SCRIPT = (await installedFileTextsFor({ generatesTheDispatcherScript: true })).dispatcherScript ?? '';

const OLDER_VERSIONS_DISPATCHER = '// The dispatcher an older agent-progress installed.\n';

function scratchRepository(): string {
  const repositoryDirectory = createScratchGitRepository('retired-dispatcher-script');
  scratchDirectories.push(repositoryDirectory);
  return repositoryDirectory;
}

function installedDispatcherScriptPathIn(repositoryDirectory: string): string {
  return join(repositoryDirectory, '.agent-progress', 'agent-progress-dispatch.js');
}

function retiredDispatcherScriptPathIn(repositoryDirectory: string): string {
  return join(repositoryDirectory, '.claude', 'workflows', 'agent-progress-dispatch.js');
}

function writeTheRetiredCopy(repositoryDirectory: string, contents = OLDER_VERSIONS_DISPATCHER): void {
  mkdirSync(join(repositoryDirectory, '.claude', 'workflows'), { recursive: true });
  writeFileSync(retiredDispatcherScriptPathIn(repositoryDirectory), contents);
}

// The printed path is the resolved root, which on macOS carries a `/private` the scratch path does not, so the line is matched by its shape.
function workflowLineRemovingTheRetiredCopy(verdict: 'updated' | 'unchanged'): RegExp {
  return new RegExp(`workflow: {4}${verdict} \\(\\S+/\\.agent-progress/agent-progress-dispatch\\.js\\); removed the old \\S+/\\.claude/workflows/agent-progress-dispatch\\.js\n`);
}

async function initialisedRepository(...initOptions: string[]): Promise<string> {
  const repositoryDirectory = scratchRepository();
  expect(await runCommandLine(['init', ...initOptions], createCapturedCommandContext({ currentDirectory: repositoryDirectory }))).toBe(0);
  return repositoryDirectory;
}

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) removeScratchDirectory(directory);
});

describeWhenGitIsPresent('the dispatcher copy an older version installed', () => {
  test('init on an existing tracker writes the generated dispatcher, removes the older copy, and reports both', async () => {
    const repositoryDirectory = await initialisedRepository();
    writeTheRetiredCopy(repositoryDirectory);

    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['init'], context)).toBe(0);

    expect(existsSync(retiredDispatcherScriptPathIn(repositoryDirectory))).toBe(false);
    expect(existsSync(join(repositoryDirectory, '.claude', 'workflows'))).toBe(false);
    expect(existsSync(join(repositoryDirectory, '.claude'))).toBe(true);
    expect(readFileSync(installedDispatcherScriptPathIn(repositoryDirectory), 'utf8')).toBe(GENERATED_DISPATCHER_SCRIPT);
    expect(context.outputText()).toMatch(workflowLineRemovingTheRetiredCopy('unchanged'));
  });

  test('update removes the older copy, writes the generated script and reports both, and a second run has nothing to remove', async () => {
    const repositoryDirectory = await initialisedRepository('--no-hooks', '--no-workflow', '--no-agent-definition');
    writeTheRetiredCopy(repositoryDirectory);

    const first = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['update'], first)).toBe(0);
    expect(existsSync(retiredDispatcherScriptPathIn(repositoryDirectory))).toBe(false);
    expect(existsSync(join(repositoryDirectory, '.claude', 'workflows'))).toBe(false);
    expect(existsSync(join(repositoryDirectory, '.claude'))).toBe(true);
    expect(readFileSync(installedDispatcherScriptPathIn(repositoryDirectory), 'utf8')).toBe(GENERATED_DISPATCHER_SCRIPT);
    expect(first.outputText()).toMatch(workflowLineRemovingTheRetiredCopy('updated'));

    const second = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['update'], second)).toBe(0);
    expect(second.outputText()).not.toContain('removed the old');
  });

  test('--no-workflow leaves a dispatcher under .claude/workflows byte for byte', async () => {
    const repositoryDirectory = await initialisedRepository('--no-hooks', '--no-workflow', '--no-agent-definition');
    writeTheRetiredCopy(repositoryDirectory, '// Example Agency\'s own dispatcher.\n');

    expect(await runCommandLine(['update', '--no-workflow'], createCapturedCommandContext({ currentDirectory: repositoryDirectory }))).toBe(0);

    expect(readFileSync(retiredDispatcherScriptPathIn(repositoryDirectory), 'utf8')).toBe('// Example Agency\'s own dispatcher.\n');
  });

  // The removal comes after the other writes, so a rerun after a failed write still names it.
  test.skipIf(RUNNING_AS_ROOT)('a refresh cut short by an unwritable agents folder leaves the older copy for the rerun to remove and report', async () => {
    const repositoryDirectory = await initialisedRepository('--no-hooks', '--no-workflow', '--no-agent-definition');
    const agentsDirectory     = join(repositoryDirectory, '.claude', 'agents');
    writeTheRetiredCopy(repositoryDirectory);
    mkdirSync(agentsDirectory, { recursive: true });

    chmodSync(agentsDirectory, READ_AND_ENTER_ONLY_MODE);
    try {
      expect(await runCommandLine(['update'], createCapturedCommandContext({ currentDirectory: repositoryDirectory }))).toBe(2);
    } finally {
      chmodSync(agentsDirectory, OWNER_FULL_ACCESS_MODE);
    }
    expect(existsSync(retiredDispatcherScriptPathIn(repositoryDirectory))).toBe(true);

    const rerun = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['update'], rerun)).toBe(0);
    expect(rerun.outputText()).toMatch(workflowLineRemovingTheRetiredCopy('unchanged'));
  });

  test('the older copy is looked for under .claude/workflows, where older versions installed it, and the folder stays while it holds more', async () => {
    const repositoryDirectory = await initialisedRepository('--no-hooks', '--no-workflow', '--no-agent-definition');
    writeTheRetiredCopy(repositoryDirectory);
    writeFileSync(join(repositoryDirectory, '.claude', 'workflows', 'example-agency-workflow.js'), '// Example Agency\'s own workflow.\n');

    expect(await runCommandLine(['update'], createCapturedCommandContext({ currentDirectory: repositoryDirectory }))).toBe(0);

    expect(existsSync(retiredDispatcherScriptPathIn(repositoryDirectory))).toBe(false);
    expect(existsSync(join(repositoryDirectory, '.claude', 'workflows', 'example-agency-workflow.js'))).toBe(true);
  });
});
