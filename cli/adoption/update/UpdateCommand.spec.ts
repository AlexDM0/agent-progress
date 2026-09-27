/**
 * What `agent-progress update` refreshes, what it reports about each of those files, and that it leaves a current tracker's progress file,
 * tickets and log byte for byte; and that it refuses, writing nothing, files a newer agent-progress installed.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
}               from 'node:fs';
import { join } from 'node:path';

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test
}                                        from 'bun:test';
import { InstallVersionWordingUtil }       from '../../../src/adapters/utils/InstallVersionWordingUtil';
import * as realWorkflowScriptBundleModule from '../../../src/lib/claude-code/WorkflowScriptBundle';
import { resourceFilePathOf }              from '../../../src/shared/ResourceFilePath';
import {
  addWorktree,
  createScratchDirectory,
  createScratchGitRepository,
  gitIsAvailable,
  removeScratchDirectory
}                                        from '../../../src/testing/ScratchWorkspace';
import { CLAUDE_MANAGED_BLOCK_MARKERS, installedFilePathsIn } from '../../InstalledFiles';
import { runCommandLine }                                     from '../../Main';
import { INSTALL_VERSION }                                    from '../../constants/InstallVersion';
import { createCapturedCommandContext }                       from '../../testing/CapturedCommandContext';
import { repositoryFileContentsOf }                           from '../../testing/RepositoryFileContents';
import { installedFileTextsFor }                              from '../InstalledFileGeneration';

const scratchDirectories: string[] = [];

const RUNNING_AS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0;

const READ_AND_ENTER_ONLY_MODE = 0o555;

const OWNER_FULL_ACCESS_MODE = 0o755;

const GENERATED_AGENT_BRIEF = (await installedFileTextsFor({ generatesTheDispatcherScript: false })).agentBrief;

function scratchRepository(): string {
  const repositoryDirectory = createScratchGitRepository('update-command');
  scratchDirectories.push(repositoryDirectory, `${repositoryDirectory}-worktrees`);
  return repositoryDirectory;
}

const SHARED_SETTINGS = 'settings.json';

const LOCAL_SETTINGS = 'settings.local.json';

function settingsFilePathIn(repositoryDirectory: string, settingsFileName: string): string {
  return join(repositoryDirectory, '.claude', settingsFileName);
}

function writeSettings(repositoryDirectory: string, settingsFileName: string, settings: unknown): void {
  mkdirSync(join(repositoryDirectory, '.claude'), { recursive: true });
  writeFileSync(settingsFilePathIn(repositoryDirectory, settingsFileName), `${JSON.stringify(settings, null, 2)}\n`);
}

function subagentStopGroupsIn(repositoryDirectory: string, settingsFileName: string): unknown[] {
  const settings = JSON.parse(readFileSync(settingsFilePathIn(repositoryDirectory, settingsFileName), 'utf8')) as Record<string, unknown>;
  return (settings['hooks'] as Record<string, unknown>)['SubagentStop'] as unknown[];
}

const GENERATED_DISPATCHER_SCRIPT = (await installedFileTextsFor({ generatesTheDispatcherScript: true })).dispatcherScript ?? '';

function workflowFilePathIn(repositoryDirectory: string): string {
  return join(repositoryDirectory, '.agent-progress', 'agent-progress-dispatch.js');
}

function retiredWorkflowFilePathIn(repositoryDirectory: string): string {
  return join(repositoryDirectory, '.claude', 'workflows', 'agent-progress-dispatch.js');
}

// The printed path is the resolved root, which on macOS carries a `/private` the scratch path does not, so the line is matched by its shape.
function workflowLineSaying(verdict: 'updated' | 'unchanged'): RegExp {
  return new RegExp(`workflow: {4}${verdict} \\(\\S+/\\.agent-progress/agent-progress-dispatch\\.js\\)\n`);
}

function workflowLineRemovingTheRetiredCopy(verdict: 'updated' | 'unchanged'): RegExp {
  return new RegExp(`workflow: {4}${verdict} \\(\\S+/\\.agent-progress/agent-progress-dispatch\\.js\\); removed the old \\S+/\\.claude/workflows/agent-progress-dispatch\\.js\n`);
}

// The template with its two placeholders filled by the default pair, which is what `update` must write byte for byte.
const INSTALLED_AGENT_DEFINITION = readFileSync(resourceFilePathOf('templates', 'AgentProgressWorker.md'), 'utf8')
  .replace('{{model}}', 'opus')
  .replace('{{effort}}', 'medium');

function agentDefinitionFilePathIn(repositoryDirectory: string): string {
  return join(repositoryDirectory, '.claude', 'agents', 'agent-progress-worker.md');
}

function agentDefinitionLineSaying(verdict: 'updated' | 'unchanged'): RegExp {
  return new RegExp(`agent: {7}${verdict} \\(\\S+/\\.claude/agents/agent-progress-worker\\.md\\)`);
}

/**
 * A tracked repository whose managed files have all been left behind by an older version of the tool.
 * It is initialised with `--no-hooks`, `--no-workflow` and `--no-agent-definition`, which is the state a repository adopted before
 * any of them existed is in, and lets each test below say for itself what its `.claude/` folder holds.
 */
async function trackedRepositoryWithStaleFiles(): Promise<string> {
  const repositoryDirectory = scratchRepository();
  await runCommandLine(['init', '--no-hooks', '--no-workflow', '--no-agent-definition'], createCapturedCommandContext({ currentDirectory: repositoryDirectory }));
  writeFileSync(join(repositoryDirectory, '.agent-progress', 'agent-brief.md'), '# Agent brief\n\nThe wording two releases ago, which nobody refreshed.\n');
  const olderClaudeInstructions = `# Example Agency\n\n${CLAUDE_MANAGED_BLOCK_MARKERS.start}\nAn older managed block.\n<!-- agent-progress:managed:end -->\n`;
  writeFileSync(join(repositoryDirectory, 'CLAUDE.md'), olderClaudeInstructions);
  return repositoryDirectory;
}

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) removeScratchDirectory(directory);
});

describe.skipIf(!gitIsAvailable())('updating a tracked repository', () => {
  test('rewrites a brief left behind by an older version and says to re-read it', async () => {
    const repositoryDirectory = await trackedRepositoryWithStaleFiles();
    const briefFilePath       = join(repositoryDirectory, '.agent-progress', 'agent-brief.md');

    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['update'], context)).toBe(0);

    expect(readFileSync(briefFilePath, 'utf8')).toBe(GENERATED_AGENT_BRIEF);
    expect(context.outputText()).toContain('brief:       updated — re-read it before your next brief');
    expect(context.errorText()).toBe('');
  });

  test('a brief that is already the shipped one is reported unchanged', async () => {
    const repositoryDirectory = await trackedRepositoryWithStaleFiles();
    await runCommandLine(['update'], createCapturedCommandContext({ currentDirectory: repositoryDirectory }));

    const second = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['update'], second)).toBe(0);

    expect(second.outputText()).toContain('brief:       unchanged');
    expect(second.outputText()).not.toContain('brief:       updated');
  });

  test('a brief that is missing altogether counts as updated, and the file is the template afterwards', async () => {
    const repositoryDirectory = await trackedRepositoryWithStaleFiles();
    const briefFilePath       = join(repositoryDirectory, '.agent-progress', 'agent-brief.md');
    rmSync(briefFilePath);

    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['update'], context)).toBe(0);

    expect(context.outputText()).toContain('brief:       updated');
    expect(readFileSync(briefFilePath, 'utf8')).toBe(GENERATED_AGENT_BRIEF);
  });

  test('a stale managed block is rewritten and reported updated, and a current one unchanged', async () => {
    const repositoryDirectory = await trackedRepositoryWithStaleFiles();
    const claudeFilePath      = join(repositoryDirectory, 'CLAUDE.md');

    const first = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['update'], first)).toBe(0);

    expect(first.outputText()).toContain('CLAUDE.md:   updated (replaced)');
    expect(readFileSync(claudeFilePath, 'utf8'), 'what the repository wrote outside the markers survives').toContain('# Example Agency');
    expect(readFileSync(claudeFilePath, 'utf8')).not.toContain('An older managed block.');

    const second = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['update'], second)).toBe(0);
    expect(second.outputText()).toContain('CLAUDE.md:   unchanged\n');
    expect(second.outputText(), 'the outcome names a write, so it says nothing beside `unchanged`').not.toContain('unchanged (replaced)');
  });

  test('--no-claude-md leaves the instructions file byte for byte as it was', async () => {
    const repositoryDirectory = await trackedRepositoryWithStaleFiles();
    const claudeFilePath      = join(repositoryDirectory, 'CLAUDE.md');
    const claudeContentBefore = readFileSync(claudeFilePath, 'utf8');

    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['update', '--no-claude-md'], context)).toBe(0);

    expect(readFileSync(claudeFilePath, 'utf8')).toBe(claudeContentBefore);
    expect(context.outputText()).toContain('CLAUDE.md:   left alone (--no-claude-md)');
    expect(context.outputText(), 'the brief is refreshed either way').toContain('brief:       updated');
  });

  test('the hook is installed by default into the local settings file, and the shared one is not even created', async () => {
    const repositoryDirectory = await trackedRepositoryWithStaleFiles();

    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['update'], context)).toBe(0);

    expect(subagentStopGroupsIn(repositoryDirectory, LOCAL_SETTINGS)).toEqual([
      { matcher: '', hooks: [{ type: 'command', command: 'agent-progress hook subagent-stop', timeout: 20 }] },
    ]);
    expect(existsSync(settingsFilePathIn(repositoryDirectory, SHARED_SETTINGS)), 'nothing lands in the file colleagues share').toBe(false);
    expect(context.outputText()).toContain('settings.local.json (installed)');
  });

  test('a second run reports the hook unchanged and leaves the local settings file byte for byte', async () => {
    const repositoryDirectory = await trackedRepositoryWithStaleFiles();
    await runCommandLine(['update'], createCapturedCommandContext({ currentDirectory: repositoryDirectory }));
    const settingsBefore = readFileSync(settingsFilePathIn(repositoryDirectory, LOCAL_SETTINGS), 'utf8');

    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['update'], context)).toBe(0);

    expect(readFileSync(settingsFilePathIn(repositoryDirectory, LOCAL_SETTINGS), 'utf8')).toBe(settingsBefore);
    expect(context.outputText()).toContain('settings.local.json (unchanged)');
  });

  /** An entry a repository chose to share is its author's; it is kept current where it is rather than copied, which would log every agent twice. */
  test('a hook already in the shared settings file is refreshed in place, and no local file appears beside it', async () => {
    const repositoryDirectory = await trackedRepositoryWithStaleFiles();
    writeSettings(repositoryDirectory, SHARED_SETTINGS, {
      hooks: {
        SessionStart: [{ matcher: '', hooks: [{ type: 'command', command: 'echo hello' }] }],
        SubagentStop: [{ matcher: '', hooks: [{ type: 'command', command: 'agent-progress hook subagent-stop', timeout: 3 }] }],
      },
    });

    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['update'], context)).toBe(0);

    expect(subagentStopGroupsIn(repositoryDirectory, SHARED_SETTINGS)).toEqual([
      { matcher: '', hooks: [{ type: 'command', command: 'agent-progress hook subagent-stop', timeout: 20 }] },
    ]);
    expect(existsSync(settingsFilePathIn(repositoryDirectory, LOCAL_SETTINGS)), 'a second copy would record every agent twice').toBe(false);
    expect(context.outputText()).toContain('settings.json (updated)');
    expect(context.outputText()).not.toContain('settings.local.json');
  });

  test('a local settings file that holds other keys keeps every one of them', async () => {
    const repositoryDirectory = await trackedRepositoryWithStaleFiles();
    writeSettings(repositoryDirectory, LOCAL_SETTINGS, {
      model:       'claude-opus-4-8',
      permissions: { allow: ['Bash(bun test:*)'] },
      hooks:       { SessionStart: [{ matcher: '', hooks: [{ type: 'command', command: 'echo hello' }] }] },
    });

    expect(await runCommandLine(['update'], createCapturedCommandContext({ currentDirectory: repositoryDirectory }))).toBe(0);

    const settings = JSON.parse(readFileSync(settingsFilePathIn(repositoryDirectory, LOCAL_SETTINGS), 'utf8')) as Record<string, unknown>;
    expect(settings['model']).toBe('claude-opus-4-8');
    expect(settings['permissions']).toEqual({ allow: ['Bash(bun test:*)'] });
    expect((settings['hooks'] as Record<string, unknown>)['SessionStart']).toEqual([{ matcher: '', hooks: [{ type: 'command', command: 'echo hello' }] }]);
    expect(subagentStopGroupsIn(repositoryDirectory, LOCAL_SETTINGS)).toHaveLength(1);
  });

  test('--no-hooks writes neither settings file, and says so', async () => {
    const repositoryDirectory = await trackedRepositoryWithStaleFiles();

    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['update', '--no-hooks'], context)).toBe(0);

    expect(existsSync(settingsFilePathIn(repositoryDirectory, LOCAL_SETTINGS))).toBe(false);
    expect(existsSync(settingsFilePathIn(repositoryDirectory, SHARED_SETTINGS))).toBe(false);
    expect(context.outputText()).toContain('hooks:       left alone (--no-hooks)');
  });

  /** A repository with nothing in `.claude/` cannot tell a refusal to write from having nothing to write, so the stale entry is really there. */
  test('--no-hooks leaves a shared settings file that holds a stale entry byte for byte', async () => {
    const repositoryDirectory = await trackedRepositoryWithStaleFiles();
    const staleGroup = { matcher: '', hooks: [{ type: 'command', command: 'agent-progress hook subagent-stop', timeout: 3 }] };
    writeSettings(repositoryDirectory, SHARED_SETTINGS, { hooks: { SubagentStop: [staleGroup] } });
    const sharedSettingsBefore = readFileSync(settingsFilePathIn(repositoryDirectory, SHARED_SETTINGS), 'utf8');

    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['update', '--no-hooks'], context)).toBe(0);

    expect(readFileSync(settingsFilePathIn(repositoryDirectory, SHARED_SETTINGS), 'utf8')).toBe(sharedSettingsBefore);
    expect(existsSync(settingsFilePathIn(repositoryDirectory, LOCAL_SETTINGS))).toBe(false);
    expect(context.outputText()).toContain('hooks:       left alone (--no-hooks)');
  });

  test('the dispatcher is installed byte-identical to the generated script, and a second run reports it unchanged', async () => {
    const repositoryDirectory = await trackedRepositoryWithStaleFiles();
    const workflowFilePath    = workflowFilePathIn(repositoryDirectory);

    const first = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['update'], first)).toBe(0);
    expect(readFileSync(workflowFilePath, 'utf8')).toBe(GENERATED_DISPATCHER_SCRIPT);
    expect(first.outputText()).toMatch(workflowLineSaying('updated'));

    const second = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['update'], second)).toBe(0);
    expect(second.outputText()).toMatch(workflowLineSaying('unchanged'));
  });

  // The script is the tool's, not the project's: a hand edit to the installed copy is a dispatcher the harness never pinned.
  test('a dispatcher changed by hand is reported updated and restored to the generated script', async () => {
    const repositoryDirectory = await trackedRepositoryWithStaleFiles();
    const workflowFilePath    = workflowFilePathIn(repositoryDirectory);
    await runCommandLine(['update'], createCapturedCommandContext({ currentDirectory: repositoryDirectory }));
    writeFileSync(workflowFilePath, `${GENERATED_DISPATCHER_SCRIPT}\n// A local tweak nobody reviewed.\n`);

    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['update'], context)).toBe(0);

    expect(context.outputText()).toMatch(workflowLineSaying('updated'));
    expect(readFileSync(workflowFilePath, 'utf8')).toBe(GENERATED_DISPATCHER_SCRIPT);
  });

  // Only one dispatcher may be left to launch, so the copy an older version installed goes, and the line names both files.
  test('removes the copy an older version installed under .claude/workflows, writes the generated script and reports both', async () => {
    const repositoryDirectory = await trackedRepositoryWithStaleFiles();
    mkdirSync(join(repositoryDirectory, '.claude', 'workflows'), { recursive: true });
    writeFileSync(retiredWorkflowFilePathIn(repositoryDirectory), '// The dispatcher an older agent-progress installed.\n');

    const first = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['update'], first)).toBe(0);
    expect(existsSync(retiredWorkflowFilePathIn(repositoryDirectory))).toBe(false);
    expect(readFileSync(workflowFilePathIn(repositoryDirectory), 'utf8')).toBe(GENERATED_DISPATCHER_SCRIPT);
    expect(first.outputText()).toMatch(workflowLineRemovingTheRetiredCopy('updated'));

    const second = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['update'], second)).toBe(0);
    expect(second.outputText()).toMatch(workflowLineSaying('unchanged'));
    expect(second.outputText()).not.toContain('removed the old');
  });

  test('--no-workflow writes no dispatcher, in the tracker or under .claude/workflows, and says so', async () => {
    const repositoryDirectory = await trackedRepositoryWithStaleFiles();

    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['update', '--no-workflow'], context)).toBe(0);

    expect(existsSync(workflowFilePathIn(repositoryDirectory))).toBe(false);
    expect(existsSync(join(repositoryDirectory, '.claude', 'workflows'))).toBe(false);
    expect(context.outputText()).toContain('workflow:    left alone (--no-workflow)');
  });

  /** A hand-edited copy is the one a refusal to write can be told apart from having nothing to write by. */
  test('--no-workflow leaves a hand-edited dispatcher byte for byte, at the installed path and at the retired one', async () => {
    const repositoryDirectory = await trackedRepositoryWithStaleFiles();
    const installedFilePath   = workflowFilePathIn(repositoryDirectory);
    const retiredFilePath     = retiredWorkflowFilePathIn(repositoryDirectory);
    mkdirSync(join(repositoryDirectory, '.claude', 'workflows'), { recursive: true });
    writeFileSync(installedFilePath, '// Example Agency\'s own tweak of the installed dispatcher.\n');
    writeFileSync(retiredFilePath, '// Example Agency\'s own dispatcher.\n');

    expect(await runCommandLine(['update', '--no-workflow'], createCapturedCommandContext({ currentDirectory: repositoryDirectory }))).toBe(0);

    expect(readFileSync(installedFilePath, 'utf8')).toBe('// Example Agency\'s own tweak of the installed dispatcher.\n');
    expect(readFileSync(retiredFilePath, 'utf8')).toBe('// Example Agency\'s own dispatcher.\n');
  });

  // The brief and the removal come last, so a rerun after a failed write still tells the orchestrator its brief changed and names the removal.
  test.skipIf(RUNNING_AS_ROOT)('a refresh cut short by an unwritable agents folder leaves the stale brief and the old dispatcher for the rerun to report', async () => {
    const repositoryDirectory = await trackedRepositoryWithStaleFiles();
    const briefFilePath       = join(repositoryDirectory, '.agent-progress', 'agent-brief.md');
    const agentsDirectory     = join(repositoryDirectory, '.claude', 'agents');
    mkdirSync(join(repositoryDirectory, '.claude', 'workflows'), { recursive: true });
    writeFileSync(retiredWorkflowFilePathIn(repositoryDirectory), '// The dispatcher an older agent-progress installed.\n');
    mkdirSync(agentsDirectory, { recursive: true });

    chmodSync(agentsDirectory, READ_AND_ENTER_ONLY_MODE);
    try {
      expect(await runCommandLine(['update'], createCapturedCommandContext({ currentDirectory: repositoryDirectory }))).toBe(2);
    } finally {
      chmodSync(agentsDirectory, OWNER_FULL_ACCESS_MODE);
    }
    expect(readFileSync(briefFilePath, 'utf8')).not.toBe(GENERATED_AGENT_BRIEF);
    expect(existsSync(retiredWorkflowFilePathIn(repositoryDirectory))).toBe(true);

    const rerun = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['update'], rerun)).toBe(0);
    expect(rerun.outputText()).toContain('brief:       updated — re-read it before your next brief');
    expect(rerun.outputText()).toMatch(workflowLineRemovingTheRetiredCopy('unchanged'));
  });

  test('the worker agent definition is installed with the default pair, and a second run reports it unchanged', async () => {
    const repositoryDirectory = await trackedRepositoryWithStaleFiles();
    const definitionFilePath  = agentDefinitionFilePathIn(repositoryDirectory);

    const first = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['update'], first)).toBe(0);
    expect(readFileSync(definitionFilePath, 'utf8')).toBe(INSTALLED_AGENT_DEFINITION);
    expect(first.outputText()).toMatch(agentDefinitionLineSaying('updated'));

    const second = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['update'], second)).toBe(0);
    expect(second.outputText()).toMatch(agentDefinitionLineSaying('unchanged'));
  });

  test('an agent definition changed by hand is reported updated and restored', async () => {
    const repositoryDirectory = await trackedRepositoryWithStaleFiles();
    const definitionFilePath  = agentDefinitionFilePathIn(repositoryDirectory);
    await runCommandLine(['update'], createCapturedCommandContext({ currentDirectory: repositoryDirectory }));
    writeFileSync(definitionFilePath, INSTALLED_AGENT_DEFINITION.replace('effort: medium', 'effort: max'));

    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['update'], context)).toBe(0);

    expect(context.outputText()).toMatch(agentDefinitionLineSaying('updated'));
    expect(readFileSync(definitionFilePath, 'utf8')).toBe(INSTALLED_AGENT_DEFINITION);
  });

  test('--no-agent-definition writes nothing under .claude/agents and leaves a hand-edited one byte for byte', async () => {
    const repositoryDirectory = await trackedRepositoryWithStaleFiles();

    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['update', '--no-agent-definition'], context)).toBe(0);
    expect(existsSync(join(repositoryDirectory, '.claude', 'agents'))).toBe(false);
    expect(context.outputText()).toContain('agent:       left alone (--no-agent-definition)');

    mkdirSync(join(repositoryDirectory, '.claude', 'agents'), { recursive: true });
    writeFileSync(agentDefinitionFilePathIn(repositoryDirectory), '---\nname: agent-progress-worker\n---\nExample Agency\'s own.\n');
    expect(await runCommandLine(['update', '--no-agent-definition'], createCapturedCommandContext({ currentDirectory: repositoryDirectory }))).toBe(0);
    expect(readFileSync(agentDefinitionFilePathIn(repositoryDirectory), 'utf8')).toBe('---\nname: agent-progress-worker\n---\nExample Agency\'s own.\n');
  });

  // A tracker adopted before the manifest existed has none, and `update` is what gives it one.
  test('records the install version on a tracker that has none, and a second run leaves it byte for byte', async () => {
    const repositoryDirectory = await trackedRepositoryWithStaleFiles();
    const manifestFilePath    = join(repositoryDirectory, '.agent-progress', 'version.json');
    rmSync(manifestFilePath);

    expect(await runCommandLine(['update'], createCapturedCommandContext({ currentDirectory: repositoryDirectory }))).toBe(0);
    const manifestAfterTheFirstRun = readFileSync(manifestFilePath, 'utf8');
    expect(manifestAfterTheFirstRun).toBe(`{\n  "installVersion": ${INSTALL_VERSION}\n}\n`);

    expect(await runCommandLine(['update'], createCapturedCommandContext({ currentDirectory: repositoryDirectory }))).toBe(0);
    expect(readFileSync(manifestFilePath, 'utf8')).toBe(manifestAfterTheFirstRun);
  });

  test('a local settings file that will not parse is left exactly as it was and reported on standard error', async () => {
    const repositoryDirectory = await trackedRepositoryWithStaleFiles();
    const malformed           = '{ "hooks": { "SubagentStop": [ ';
    mkdirSync(join(repositoryDirectory, '.claude'), { recursive: true });
    writeFileSync(settingsFilePathIn(repositoryDirectory, LOCAL_SETTINGS), malformed);

    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['update'], context), 'the refresh of everything else still happened').toBe(0);

    expect(readFileSync(settingsFilePathIn(repositoryDirectory, LOCAL_SETTINGS), 'utf8')).toBe(malformed);
    expect(context.outputText()).toContain('hooks:       refused (the settings file could not be read)');
    expect(context.errorText()).toContain('settings.local.json');
  });
});

describe.skipIf(!gitIsAvailable())('what update never touches', () => {
  test('the progress file, the tickets and the log are byte-identical afterwards', async () => {
    const repositoryDirectory = await trackedRepositoryWithStaleFiles();
    const seeding = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    await runCommandLine(['ticket', 'add', 'Rename the export button', '--type', 'change'], seeding);
    await runCommandLine(['log', 'The orchestrator started the board'], createCapturedCommandContext({ currentDirectory: repositoryDirectory }));

    const progressFilePath = join(repositoryDirectory, '.agent-progress', 'progress.json');
    const logFilePath      = join(repositoryDirectory, '.agent-progress', 'log.jsonl');
    const ticketsDirectory = join(repositoryDirectory, '.agent-progress', 'tickets');
    const ticketFileName   = readdirSync(ticketsDirectory)[0] ?? '';
    const ticketFilePath   = join(ticketsDirectory, ticketFileName);
    const progressBefore   = readFileSync(progressFilePath, 'utf8');
    const logBefore        = readFileSync(logFilePath, 'utf8');
    const ticketBefore     = readFileSync(ticketFilePath, 'utf8');
    expect(ticketFileName, 'the fixture filed a ticket, so the comparison below is about a real file').toContain('export-button');

    expect(await runCommandLine(['update'], createCapturedCommandContext({ currentDirectory: repositoryDirectory }))).toBe(0);

    expect(readFileSync(progressFilePath, 'utf8'), 'the rows, the log and the counters are none of this command\'s business').toBe(progressBefore);
    expect(readFileSync(logFilePath, 'utf8')).toBe(logBefore);
    expect(readFileSync(ticketFilePath, 'utf8')).toBe(ticketBefore);
    expect(logBefore, 'the fixture holds a log line, so the comparison above is about something').toContain('The orchestrator started the board');
  });

  test('an unreadable tracker still exits 0 with the untouched line, and its files are left byte for byte', async () => {
    const repositoryDirectory = await trackedRepositoryWithStaleFiles();
    const progressFilePath    = join(repositoryDirectory, '.agent-progress', 'progress.json');
    const logFilePath         = join(repositoryDirectory, '.agent-progress', 'log.jsonl');
    const unreadableProgress  = '{ "version": 1, "tasks": [';
    writeFileSync(progressFilePath, unreadableProgress);
    const logBefore = readFileSync(logFilePath, 'utf8');

    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['update'], context)).toBe(0);

    expect(context.outputText().split('\n')[0]).toEndWith('; the tracker itself was not touched.');
    expect(readFileSync(progressFilePath, 'utf8')).toBe(unreadableProgress);
    expect(readFileSync(logFilePath, 'utf8')).toBe(logBefore);
  });
});

describe.skipIf(!gitIsAvailable())('from inside a linked worktree', () => {
  test('the main checkout\'s managed files are the ones refreshed', async () => {
    const repositoryDirectory = await trackedRepositoryWithStaleFiles();
    const worktreeDirectory   = addWorktree(repositoryDirectory, 'subagent');

    const context = createCapturedCommandContext({ currentDirectory: worktreeDirectory });
    expect(await runCommandLine(['update'], context)).toBe(0);

    expect(readFileSync(join(repositoryDirectory, '.agent-progress', 'agent-brief.md'), 'utf8')).toBe(GENERATED_AGENT_BRIEF);
    expect(existsSync(join(worktreeDirectory, '.agent-progress')), 'a worktree never grows a tracker of its own').toBe(false);
    expect(context.outputText()).toContain(repositoryDirectory);
  });
});

describe.skipIf(!gitIsAvailable())('what update refuses', () => {
  test('a directory with no tracker anywhere above it is refused with exit 1, naming init, and nothing is written', async () => {
    const plainDirectory = createScratchDirectory('update-without-a-tracker');
    scratchDirectories.push(plainDirectory);

    const context = createCapturedCommandContext({ currentDirectory: plainDirectory });
    expect(await runCommandLine(['update'], context)).toBe(1);

    expect(context.errorText()).toContain('agent-progress init');
    expect(existsSync(join(plainDirectory, '.agent-progress')), 'update creates no tracker, which is the whole difference from init').toBe(false);
    expect(existsSync(join(plainDirectory, 'CLAUDE.md'))).toBe(false);
    expect(context.outputText()).toBe('');
  });

  test('an unknown option and an extra positional are each refused with exit 1', async () => {
    const repositoryDirectory = await trackedRepositoryWithStaleFiles();
    const briefFilePath       = join(repositoryDirectory, '.agent-progress', 'agent-brief.md');
    const briefBefore         = readFileSync(briefFilePath, 'utf8');

    for (const refusedArguments of [['update', '--project', 'Example Agency'], ['update', '--root', repositoryDirectory], ['update', '--no-claud-md'], ['update', 'here']]) {
      const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
      expect(await runCommandLine(refusedArguments, context), refusedArguments.join(' ')).toBe(1);
      expect(context.errorText(), refusedArguments.join(' ')).toContain('agent-progress update [--no-claude-md] [--no-hooks] [--no-workflow]');
    }
    expect(readFileSync(briefFilePath, 'utf8'), 'a refused invocation writes nothing').toBe(briefBefore);
  });

  // Two colleagues on different versions would otherwise flip the committed installed files back and forth.
  test('files installed by a newer agent-progress are refused with exit 1 and the newer paragraph, and nothing is written', async () => {
    const repositoryDirectory = await trackedRepositoryWithStaleFiles();
    const rootDirectory       = realpathSync(repositoryDirectory);
    const manifestFilePath    = installedFilePathsIn(rootDirectory).installManifest;
    writeFileSync(manifestFilePath, `{\n  "installVersion": ${INSTALL_VERSION + 1}\n}\n`);
    const filesBefore = repositoryFileContentsOf(repositoryDirectory);

    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['update'], context)).toBe(1);

    expect(context.errorText()).toBe(InstallVersionWordingUtil.messageOf({
      kind:           'install-version-mismatch',
      rootDirectory,
      manifestFilePath,
      installVersion: INSTALL_VERSION,
      mismatch:       { reason: 'newer', installedVersion: INSTALL_VERSION + 1 },
    }));
    expect(context.outputText()).toBe('');
    expect(repositoryFileContentsOf(repositoryDirectory)).toEqual(filesBefore);
    expect(filesBefore.size, 'the fixture holds the tracker and its installed files, so the comparison above is about something').toBeGreaterThan(3);
  });
});

describe.skipIf(!gitIsAvailable())('a dispatcher that will not bundle', () => {
  let realWorkflowScriptBundleExports: Record<string, unknown> = {};

  // Bun keeps a module mock for the rest of the process, so the real exports are copied before the stub goes in and mocked back afterwards.
  beforeAll(() => {
    realWorkflowScriptBundleExports = { ...realWorkflowScriptBundleModule };
    mock.module('../../../src/lib/claude-code/WorkflowScriptBundle', () => ({
      ...realWorkflowScriptBundleExports,
      bundleWorkflowScript: () => Promise.resolve({ verdict: 'failed', reason: 'build-failed', detail: 'Example build failure' }),
    }));
  });

  afterAll(() => {
    mock.module('../../../src/lib/claude-code/WorkflowScriptBundle', () => realWorkflowScriptBundleExports);
  });

  // Every installed text is computed before the first write, so the repository is left exactly as it was, its install version included.
  test('stops update at exit 2 with every file of the repository byte for byte as it was', async () => {
    const repositoryDirectory = await trackedRepositoryWithStaleFiles();
    const contentsBefore      = repositoryFileContentsOf(repositoryDirectory);

    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['update'], context)).toBe(2);

    expect(context.errorText()).toContain('could not be generated');
    expect(repositoryFileContentsOf(repositoryDirectory)).toEqual(contentsBefore);
  });
});
