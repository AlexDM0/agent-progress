/**
 * What `agent-progress update` refreshes, what it reports about each of those files, and the three
 * things it never touches: the progress file, the tickets and the log.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
}               from 'node:fs';
import { join } from 'node:path';

import {
  afterEach,
  describe,
  expect,
  test
}                                        from 'bun:test';
import { CLAUDE_MANAGED_START }         from '../../lib/constants/Statuses';
import { createCapturedCommandContext } from '../../lib/tooling/dev/CapturedCommandContext';
import {
  addWorktree,
  createScratchDirectory,
  createScratchGitRepository,
  gitIsAvailable,
  removeScratchDirectory
}                                        from '../../lib/tooling/dev/ScratchWorkspace';
import { runCommandLine } from '../Main';

const scratchDirectories: string[] = [];

const BRIEF_TEMPLATE = readFileSync(join(import.meta.dir, '..', '..', 'templates', 'AgentBrief.md'), 'utf8');

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

/**
 * A tracked repository whose managed files have all been left behind by an older version of the tool.
 * It is initialised with `--no-hooks`, which is the state a repository adopted before the hook existed
 * is in, and lets each test below say for itself what its settings files hold.
 */
async function trackedRepositoryWithStaleFiles(): Promise<string> {
  const repositoryDirectory = scratchRepository();
  await runCommandLine(['init', '--no-hooks'], createCapturedCommandContext({ currentDirectory: repositoryDirectory }));
  writeFileSync(join(repositoryDirectory, '.agent-progress', 'agent-brief.md'), '# Agent brief\n\nThe wording two releases ago, which nobody refreshed.\n');
  writeFileSync(join(repositoryDirectory, 'CLAUDE.md'), `# Example Agency\n\n${CLAUDE_MANAGED_START}\nAn older managed block.\n<!-- agent-progress:managed:end -->\n`);
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

    expect(readFileSync(briefFilePath, 'utf8')).toBe(BRIEF_TEMPLATE);
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
    expect(readFileSync(briefFilePath, 'utf8')).toBe(BRIEF_TEMPLATE);
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
    expect(second.outputText()).toContain('CLAUDE.md:   unchanged (replaced)');
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

  /** The flag that used to ask for the hook is now the default; a habit that still types it is answered, not refused. */
  test('--hooks is still accepted and does what the default already does', async () => {
    const repositoryDirectory = await trackedRepositoryWithStaleFiles();

    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['update', '--hooks'], context)).toBe(0);

    expect(context.outputText()).toContain('settings.local.json (installed)');
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
    const ticketsDirectory = join(repositoryDirectory, '.agent-progress', 'tickets');
    const ticketFileName   = readdirSync(ticketsDirectory)[0] ?? '';
    const ticketFilePath   = join(ticketsDirectory, ticketFileName);
    const progressBefore   = readFileSync(progressFilePath, 'utf8');
    const ticketBefore     = readFileSync(ticketFilePath, 'utf8');
    expect(ticketFileName, 'the fixture filed a ticket, so the comparison below is about a real file').toContain('export-button');

    expect(await runCommandLine(['update', '--hooks'], createCapturedCommandContext({ currentDirectory: repositoryDirectory }))).toBe(0);

    expect(readFileSync(progressFilePath, 'utf8'), 'the rows, the log and the counters are none of this command\'s business').toBe(progressBefore);
    expect(readFileSync(ticketFilePath, 'utf8')).toBe(ticketBefore);
    expect(progressBefore, 'the fixture holds a row and a log line, so the comparison above is about something').toContain('The orchestrator started the board');
  });
});

describe.skipIf(!gitIsAvailable())('from inside a linked worktree', () => {
  test('the main checkout\'s managed files are the ones refreshed', async () => {
    const repositoryDirectory = await trackedRepositoryWithStaleFiles();
    const worktreeDirectory   = addWorktree(repositoryDirectory, 'subagent');

    const context = createCapturedCommandContext({ currentDirectory: worktreeDirectory });
    expect(await runCommandLine(['update'], context)).toBe(0);

    expect(readFileSync(join(repositoryDirectory, '.agent-progress', 'agent-brief.md'), 'utf8')).toBe(BRIEF_TEMPLATE);
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
      expect(context.errorText(), refusedArguments.join(' ')).toContain('agent-progress update [--no-claude-md] [--no-hooks]');
    }
    expect(readFileSync(briefFilePath, 'utf8'), 'a refused invocation writes nothing').toBe(briefBefore);
  });
});
