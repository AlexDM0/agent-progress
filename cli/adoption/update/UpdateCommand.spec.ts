/**
 * What `agent-progress update` refreshes, what it reports about each of those files, what it removes once from an install version 16
 * repository, and that it leaves a current tracker's progress file, tickets and log byte for byte; and that it refuses, writing nothing,
 * files a newer agent-progress installed and a directory at the manifest's path, which it could not replace.
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

import { afterEach, expect, test }     from 'bun:test';
import { OperationRefusalWordingUtil } from '../../../src/adapters/utils/OperationRefusalWordingUtil.ts';
import { DISPATCH_PROTOCOL }           from '../../../src/shared/constants/DispatchProtocol.ts';
import { PRODUCT_NAMES }               from '../../../src/shared/constants/ProductNames.ts';
import {
  addWorktree,
  createScratchDirectory,
  createScratchGitRepository,
  removeScratchDirectory
}                                        from '../../../src/testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent }     from '../../../src/testing/ToolGuard.ts';
import { installedFilePathsIn }         from '../../InstalledFiles.ts';
import { runCommandLine }               from '../../Main.ts';
import { INSTALL_VERSION }              from '../../constants/InstallVersion.ts';
import { createCapturedCommandContext } from '../../testing/CapturedCommandContext.ts';
import { repositoryFileContentsOf }     from '../../testing/RepositoryFileContents.ts';
import { installedFileTextsFor }        from '../InstalledFileGeneration.ts';
import { CLAUDE_MANAGED_BLOCK_MARKERS } from '../constants/ClaudeManagedBlockMarkers.ts';

const scratchDirectories: string[] = [];

const RUNNING_AS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0;

const READ_AND_ENTER_ONLY_MODE = 0o555;

const OWNER_FULL_ACCESS_MODE = 0o755;

const GENERATED_SESSION_INSTRUCTIONS = installedFileTextsFor().sessionInstructions ?? '';

const SHARED_SETTINGS = 'settings.json';

const LOCAL_SETTINGS = 'settings.local.json';

const SESSION_START_GROUP = { matcher: '', hooks: [{ type: 'command', command: `${PRODUCT_NAMES.PROGRAM} hook session-start`, timeout: 10 }] };

function scratchRepository(): string {
  const repositoryDirectory = createScratchGitRepository('update-command');
  scratchDirectories.push(repositoryDirectory, `${repositoryDirectory}-worktrees`);
  return repositoryDirectory;
}

function settingsFilePathIn(repositoryDirectory: string, settingsFileName: string): string {
  return join(repositoryDirectory, '.claude', settingsFileName);
}

function writeSettings(repositoryDirectory: string, settingsFileName: string, settings: unknown): void {
  mkdirSync(join(repositoryDirectory, '.claude'), { recursive: true });
  writeFileSync(settingsFilePathIn(repositoryDirectory, settingsFileName), `${JSON.stringify(settings, null, 2)}\n`);
}

function settingsIn(repositoryDirectory: string, settingsFileName: string): Record<string, unknown> {
  return JSON.parse(readFileSync(settingsFilePathIn(repositoryDirectory, settingsFileName), 'utf8')) as Record<string, unknown>;
}

function hookGroupsIn(repositoryDirectory: string, settingsFileName: string, event: string): unknown {
  return (settingsIn(repositoryDirectory, settingsFileName)['hooks'] as Record<string, unknown> | undefined)?.[event];
}

function sessionInstructionsPathIn(repositoryDirectory: string): string {
  return join(repositoryDirectory, PRODUCT_NAMES.DATA_FOLDER, 'session-instructions.md');
}

/**
 * A tracked repository whose instructions an older version of the tool left behind. It is initialised with `--no-hooks`, which lets each
 * test below say for itself what its `.claude/` folder holds.
 */
async function trackedRepositoryWithStaleFiles(): Promise<string> {
  const repositoryDirectory = scratchRepository();
  await runCommandLine(['init', '--no-hooks'], createCapturedCommandContext({ currentDirectory: repositoryDirectory }));
  writeFileSync(sessionInstructionsPathIn(repositoryDirectory), '## Progress tracking\n\nThe wording two releases ago, which nobody refreshed.\n');
  return repositoryDirectory;
}

/** What install version 16 wrote into a repository, each file holding a line of its own so a test can tell it was there. */
function plantVersion16Install(repositoryDirectory: string): void {
  const dataFolder = join(repositoryDirectory, PRODUCT_NAMES.DATA_FOLDER);
  for (const fileName of ['agent-brief.md', 'builder-brief.md', 'review-brief.md', 'agent-progress-dispatch.js']) {
    writeFileSync(join(dataFolder, fileName), `Example version 16 ${fileName}\n`);
  }
  mkdirSync(join(repositoryDirectory, '.claude', 'agents'), { recursive: true });
  writeFileSync(join(repositoryDirectory, '.claude', 'agents', `${DISPATCH_PROTOCOL.WORKER_AGENT_TYPE}.md`), 'Example worker definition\n');
  const managedBlock = `${CLAUDE_MANAGED_BLOCK_MARKERS.start}\nAn older managed block.\n${CLAUDE_MANAGED_BLOCK_MARKERS.end}`;
  writeFileSync(join(repositoryDirectory, 'CLAUDE.md'), `# Example Agency\n\n${managedBlock}\n`);
  const otherGroup = { matcher: '', hooks: [{ type: 'command', command: 'echo hello' }] };
  writeSettings(repositoryDirectory, LOCAL_SETTINGS, {
    hooks: {
      SubagentStop: [{ matcher: '', hooks: [{ type: 'command', command: `${PRODUCT_NAMES.PROGRAM} hook subagent-stop`, timeout: 20 }] }],
      PreToolUse:   [{ matcher: 'Bash', hooks: [{ type: 'command', command: `${PRODUCT_NAMES.PROGRAM} hook pre-tool-use`, timeout: 10 }] }],
      PostToolUse:  [{ matcher: '', hooks: [{ type: 'command', command: `${PRODUCT_NAMES.PROGRAM} hook post-tool-use`, timeout: 10 }] }, otherGroup],
    },
  });
  writeFileSync(installedFilePathsIn(repositoryDirectory).installManifest, '{\n  "installVersion": 16\n}\n');
}

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) removeScratchDirectory(directory);
});

describeWhenGitIsPresent('updating a tracked repository', () => {
  test('rewrites session instructions left behind by an older version and says to re-read them', async () => {
    const repositoryDirectory = await trackedRepositoryWithStaleFiles();

    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['update'], context)).toBe(0);

    expect(readFileSync(sessionInstructionsPathIn(repositoryDirectory), 'utf8')).toBe(GENERATED_SESSION_INSTRUCTIONS);
    expect(context.outputText()).toContain('brief:       updated — re-read it before your next brief');
    expect(context.errorText()).toBe('');
  });

  test('briefs that are already the shipped ones are reported unchanged, and missing ones count as updated', async () => {
    const repositoryDirectory = await trackedRepositoryWithStaleFiles();
    await runCommandLine(['update'], createCapturedCommandContext({ currentDirectory: repositoryDirectory }));

    const second = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['update'], second)).toBe(0);
    expect(second.outputText()).toContain('brief:       unchanged');

    rmSync(installedFilePathsIn(repositoryDirectory).assistantDefault);
    const third = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['update'], third)).toBe(0);
    expect(third.outputText()).toContain('brief:       updated');
    expect(existsSync(installedFilePathsIn(repositoryDirectory).assistantDefault)).toBe(true);
  });

  test('a version 16 install is removed once: the block, the three hooks, the agent definition, the dispatcher and the three briefs', async () => {
    const repositoryDirectory = await trackedRepositoryWithStaleFiles();
    plantVersion16Install(repositoryDirectory);

    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['update'], context), context.errorText()).toBe(0);

    expect(readFileSync(join(repositoryDirectory, 'CLAUDE.md'), 'utf8')).toBe('# Example Agency\n');
    expect(context.outputText()).toContain('  CLAUDE.md:   removed; commit CLAUDE.md\n');
    expect(hookGroupsIn(repositoryDirectory, LOCAL_SETTINGS, 'SubagentStop')).toBeUndefined();
    expect(hookGroupsIn(repositoryDirectory, LOCAL_SETTINGS, 'PreToolUse')).toBeUndefined();
    expect(hookGroupsIn(repositoryDirectory, LOCAL_SETTINGS, 'PostToolUse'), 'a hook somebody else wrote stays').toEqual([
      { matcher: '', hooks: [{ type: 'command', command: 'echo hello' }] },
    ]);
    expect(hookGroupsIn(repositoryDirectory, LOCAL_SETTINGS, 'SessionStart')).toEqual([SESSION_START_GROUP]);
    expect(context.outputText()).toContain('removed SubagentStop, PreToolUse, PostToolUse hooks');
    expect(readdirSync(join(repositoryDirectory, '.claude', 'agents'))).toEqual([]);
    for (const fileName of ['agent-brief.md', 'builder-brief.md', 'review-brief.md', 'agent-progress-dispatch.js']) {
      expect(existsSync(join(repositoryDirectory, PRODUCT_NAMES.DATA_FOLDER, fileName)), fileName).toBe(false);
    }
    expect(JSON.parse(readFileSync(installedFilePathsIn(repositoryDirectory).installManifest, 'utf8'))).toEqual({ installVersion: INSTALL_VERSION });

    const second = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['update'], second)).toBe(0);
    expect(second.outputText()).toContain('  CLAUDE.md:   no managed block\n');
    expect(second.outputText()).toContain('  retired:     nothing to remove\n');
  });

  test('a managed block with a start marker and no end is left alone, reported, and the rest of the update still runs', async () => {
    const repositoryDirectory = await trackedRepositoryWithStaleFiles();
    const truncated = `# Example Agency\n\n${CLAUDE_MANAGED_BLOCK_MARKERS.start}\nsomething truncated the end marker\n`;
    writeFileSync(join(repositoryDirectory, 'CLAUDE.md'), truncated);

    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['update'], context)).toBe(0);

    expect(readFileSync(join(repositoryDirectory, 'CLAUDE.md'), 'utf8')).toBe(truncated);
    expect(context.outputText()).toContain('  CLAUDE.md:   refused (start marker without an end marker)');
    expect(context.errorText()).toContain('with no matching end marker');
  });

  test('the SessionStart hook is installed by default into the local settings file, the shared one is not created, and a rerun is unchanged', async () => {
    const repositoryDirectory = await trackedRepositoryWithStaleFiles();

    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['update'], context)).toBe(0);
    expect(hookGroupsIn(repositoryDirectory, LOCAL_SETTINGS, 'SessionStart')).toEqual([SESSION_START_GROUP]);
    expect(existsSync(settingsFilePathIn(repositoryDirectory, SHARED_SETTINGS)), 'nothing lands in the file colleagues share').toBe(false);
    expect(context.outputText()).toContain('settings.local.json (installed)');

    const settingsBefore = readFileSync(settingsFilePathIn(repositoryDirectory, LOCAL_SETTINGS), 'utf8');
    const second = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['update'], second)).toBe(0);
    expect(readFileSync(settingsFilePathIn(repositoryDirectory, LOCAL_SETTINGS), 'utf8')).toBe(settingsBefore);
    expect(second.outputText()).toContain('settings.local.json (unchanged)');
  });

  test('a local settings file that holds other keys keeps every one of them', async () => {
    const repositoryDirectory = await trackedRepositoryWithStaleFiles();
    writeSettings(repositoryDirectory, LOCAL_SETTINGS, {
      model:       'claude-opus-4-8',
      permissions: { allow: ['Bash(bun test:*)'] },
      hooks:       { SessionStart: [{ matcher: '', hooks: [{ type: 'command', command: 'echo hello' }] }] },
    });

    expect(await runCommandLine(['update'], createCapturedCommandContext({ currentDirectory: repositoryDirectory }))).toBe(0);

    const settings = settingsIn(repositoryDirectory, LOCAL_SETTINGS);
    expect(settings['model']).toBe('claude-opus-4-8');
    expect(settings['permissions']).toEqual({ allow: ['Bash(bun test:*)'] });
    expect(hookGroupsIn(repositoryDirectory, LOCAL_SETTINGS, 'SessionStart')).toEqual([
      { matcher: '', hooks: [{ type: 'command', command: 'echo hello' }] },
      SESSION_START_GROUP,
    ]);
  });

  /** A shared file holding a retired entry tells a refusal to touch settings apart from having nothing to remove. */
  test('--no-hooks writes neither settings file and leaves a retired hook in the shared one byte for byte, and says so', async () => {
    const repositoryDirectory = await trackedRepositoryWithStaleFiles();
    const retiredGroup = { matcher: '', hooks: [{ type: 'command', command: `${PRODUCT_NAMES.PROGRAM} hook subagent-stop`, timeout: 3 }] };
    writeSettings(repositoryDirectory, SHARED_SETTINGS, { hooks: { SubagentStop: [retiredGroup] } });
    const sharedSettingsBefore = readFileSync(settingsFilePathIn(repositoryDirectory, SHARED_SETTINGS), 'utf8');

    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['update', '--no-hooks'], context)).toBe(0);

    expect(readFileSync(settingsFilePathIn(repositoryDirectory, SHARED_SETTINGS), 'utf8')).toBe(sharedSettingsBefore);
    expect(existsSync(settingsFilePathIn(repositoryDirectory, LOCAL_SETTINGS))).toBe(false);
    expect(context.outputText()).toContain('hooks:       left alone (--no-hooks)');
  });

  test('the worktrees folder is git-ignored', async () => {
    const repositoryDirectory = await trackedRepositoryWithStaleFiles();
    writeFileSync(join(repositoryDirectory, '.gitignore'), `${PRODUCT_NAMES.DATA_FOLDER}/\n`);

    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['update'], context)).toBe(0);

    expect(readFileSync(join(repositoryDirectory, '.gitignore'), 'utf8')).toContain(`${PRODUCT_NAMES.WORKTREES_FOLDER}/`);
    expect(context.outputText()).toContain(`  worktrees:   ${PRODUCT_NAMES.WORKTREES_FOLDER} entry added`);
  });

  // The briefs come after the hooks and skills and the manifest after all of them, so a rerun after a failed write still reports the stale
  // brief and every checked command keeps asking for update until one finishes.
  test.skipIf(RUNNING_AS_ROOT)('a refresh cut short by an unwritable skills folder leaves the stale brief and no install version for the rerun to report and record', async () => {
    const repositoryDirectory = await trackedRepositoryWithStaleFiles();
    const manifestFilePath    = installedFilePathsIn(repositoryDirectory).installManifest;
    const skillsDirectory     = join(repositoryDirectory, '.claude', 'skills');
    rmSync(manifestFilePath);
    rmSync(skillsDirectory, { recursive: true, force: true });
    mkdirSync(skillsDirectory, { recursive: true });

    chmodSync(skillsDirectory, READ_AND_ENTER_ONLY_MODE);
    try {
      expect(await runCommandLine(['update'], createCapturedCommandContext({ currentDirectory: repositoryDirectory }))).toBe(2);
    } finally {
      chmodSync(skillsDirectory, OWNER_FULL_ACCESS_MODE);
    }
    expect(readFileSync(sessionInstructionsPathIn(repositoryDirectory), 'utf8')).not.toBe(GENERATED_SESSION_INSTRUCTIONS);
    expect(existsSync(manifestFilePath), 'a refresh cut short leaves the old version, so every command keeps asking for update').toBe(false);

    const rerun = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['update'], rerun)).toBe(0);
    expect(rerun.outputText()).toContain('brief:       updated — re-read it before your next brief');
    expect(JSON.parse(readFileSync(manifestFilePath, 'utf8'))).toEqual({ installVersion: INSTALL_VERSION });
  });

  // A tracker adopted before the manifest existed has none, and `update` is what gives it one.
  test('records the install version on a tracker that has none, and a second run leaves it byte for byte', async () => {
    const repositoryDirectory = await trackedRepositoryWithStaleFiles();
    const manifestFilePath    = join(repositoryDirectory, PRODUCT_NAMES.DATA_FOLDER, 'version.json');
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

describeWhenGitIsPresent('what update never touches', () => {
  test('the progress file, the tickets and the log are byte-identical afterwards', async () => {
    const repositoryDirectory = await trackedRepositoryWithStaleFiles();
    const seeding = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    await runCommandLine(['ticket', 'add', 'Rename the export button', '--type', 'ticket'], seeding);
    await runCommandLine(['log', 'The orchestrator started the board'], createCapturedCommandContext({ currentDirectory: repositoryDirectory }));

    const progressFilePath = join(repositoryDirectory, PRODUCT_NAMES.DATA_FOLDER, 'progress.json');
    const logFilePath      = join(repositoryDirectory, PRODUCT_NAMES.DATA_FOLDER, 'log.jsonl');
    const ticketsDirectory = join(repositoryDirectory, PRODUCT_NAMES.DATA_FOLDER, 'tickets');
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
    const progressFilePath    = join(repositoryDirectory, PRODUCT_NAMES.DATA_FOLDER, 'progress.json');
    const logFilePath         = join(repositoryDirectory, PRODUCT_NAMES.DATA_FOLDER, 'log.jsonl');
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

describeWhenGitIsPresent('from inside a linked worktree', () => {
  test('the main checkout\'s managed files are the ones refreshed', async () => {
    const repositoryDirectory = await trackedRepositoryWithStaleFiles();
    const worktreeDirectory   = addWorktree(repositoryDirectory, 'subagent');

    const context = createCapturedCommandContext({ currentDirectory: worktreeDirectory });
    expect(await runCommandLine(['update'], context)).toBe(0);

    expect(readFileSync(join(repositoryDirectory, PRODUCT_NAMES.DATA_FOLDER, 'session-instructions.md'), 'utf8')).toBe(GENERATED_SESSION_INSTRUCTIONS);
    expect(existsSync(join(worktreeDirectory, PRODUCT_NAMES.DATA_FOLDER)), 'a worktree never grows a tracker of its own').toBe(false);
    expect(context.outputText()).toContain(repositoryDirectory);
  });
});

describeWhenGitIsPresent('what update refuses', () => {
  test('a directory with no tracker anywhere above it is refused with exit 1, naming init, and nothing is written', async () => {
    const plainDirectory = createScratchDirectory('update-without-a-tracker');
    scratchDirectories.push(plainDirectory);

    const context = createCapturedCommandContext({ currentDirectory: plainDirectory });
    expect(await runCommandLine(['update'], context)).toBe(1);

    expect(context.errorText()).toContain(`${PRODUCT_NAMES.PROGRAM} init`);
    expect(existsSync(join(plainDirectory, PRODUCT_NAMES.DATA_FOLDER)), 'update creates no tracker, which is the whole difference from init').toBe(false);
    expect(existsSync(join(plainDirectory, 'CLAUDE.md'))).toBe(false);
    expect(context.outputText()).toBe('');
  });

  test('an unknown option, each retired opt-out flag among them, and an extra positional are each refused with exit 1', async () => {
    const repositoryDirectory = await trackedRepositoryWithStaleFiles();
    const briefFilePath       = join(repositoryDirectory, PRODUCT_NAMES.DATA_FOLDER, 'session-instructions.md');
    const briefBefore         = readFileSync(briefFilePath, 'utf8');
    const refusedArgumentLists = [
      ['update', '--project', 'Example Agency'],
      ['update', '--root', repositoryDirectory],
      ['update', '--no-claude-md'],
      ['update', '--no-workflow'],
      ['update', '--no-agent-definition'],
      ['update', 'here'],
    ];

    for (const refusedArguments of refusedArgumentLists) {
      const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
      expect(await runCommandLine(refusedArguments, context), refusedArguments.join(' ')).toBe(1);
      expect(context.errorText(), refusedArguments.join(' ')).toContain(`${PRODUCT_NAMES.PROGRAM} update [--no-hooks]`);
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

    expect(context.errorText()).toBe(OperationRefusalWordingUtil.installVersionMismatchMessageOf({
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

  // The manifest is written last, by a rename a directory would refuse, so without the check every other file would be written first.
  test('a directory at the manifest\'s path is refused with exit 1 before anything is written, and update runs once it is removed', async () => {
    const repositoryDirectory = await trackedRepositoryWithStaleFiles();
    const rootDirectory       = realpathSync(repositoryDirectory);
    const manifestFilePath    = installedFilePathsIn(rootDirectory).installManifest;
    rmSync(manifestFilePath, { force: true });
    mkdirSync(manifestFilePath);
    const filesBefore = repositoryFileContentsOf(repositoryDirectory);

    const refusedContext = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['update'], refusedContext)).toBe(1);
    expect(refusedContext.errorText()).toBe(OperationRefusalWordingUtil.installVersionMismatchMessageOf({
      kind:           'install-version-mismatch',
      rootDirectory,
      manifestFilePath,
      installVersion: INSTALL_VERSION,
      mismatch:       { reason: 'manifest-is-a-directory' },
    }));
    expect(refusedContext.outputText()).toBe('');
    expect(repositoryFileContentsOf(repositoryDirectory)).toEqual(filesBefore);

    rmSync(manifestFilePath, { recursive: true });
    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['update'], context)).toBe(0);
    expect(JSON.parse(readFileSync(manifestFilePath, 'utf8'))).toEqual({ installVersion: INSTALL_VERSION });
  });
});
