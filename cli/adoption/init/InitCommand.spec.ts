/**
 * What `agent-progress init` leaves behind and what a second one does, including the root discovered from inside a linked worktree.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test
}                                                              from 'bun:test';
import { InstallVersionWordingUtil }       from '../../../src/adapters/utils/InstallVersionWordingUtil.ts';
import * as realWorkflowScriptBundleModule from '../../../src/lib/claude-code/WorkflowScriptBundle.ts';
import {
  addWorktree,
  createScratchDirectory,
  createScratchGitRepository,
  gitIsAvailable,
  removeScratchDirectory
}                                                              from '../../../src/testing/ScratchWorkspace.ts';
import { installedFilePathsIn }         from '../../InstalledFiles.ts';
import { runCommandLine }               from '../../Main.ts';
import { INSTALL_VERSION }              from '../../constants/InstallVersion.ts';
import { createCapturedCommandContext } from '../../testing/CapturedCommandContext.ts';
import { repositoryFileContentsOf }     from '../../testing/RepositoryFileContents.ts';
import { storedProgressOf }             from '../../testing/StoredProgress.ts';
import { installedFileTextsFor }        from '../InstalledFileGeneration.ts';
import { CLAUDE_MANAGED_BLOCK_MARKERS } from '../constants/ClaudeManagedBlockMarkers.ts';

const scratchDirectories: string[] = [];

const GENERATED_DISPATCHER_SCRIPT = (await installedFileTextsFor({ generatesTheDispatcherScript: true })).dispatcherScript ?? '';

function dispatcherScriptPathIn(repositoryDirectory: string): string {
  return join(repositoryDirectory, '.agent-progress', 'agent-progress-dispatch.js');
}

function scratchRepository(): string {
  const repositoryDirectory = createScratchGitRepository('init-command');
  scratchDirectories.push(repositoryDirectory, `${repositoryDirectory}-worktrees`);
  return repositoryDirectory;
}

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) removeScratchDirectory(directory);
});

describe.skipIf(!gitIsAvailable())('initialising a repository', () => {
  test('creates the tracker tree, ignores it, writes the CLAUDE.md block and the agent brief, and renders a page', async () => {
    const repositoryDirectory = scratchRepository();
    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory });

    expect(await runCommandLine(['init', '--project', 'Example Agency'], context)).toBe(0);

    expect(existsSync(join(repositoryDirectory, '.agent-progress', 'progress.json'))).toBe(true);
    expect(existsSync(join(repositoryDirectory, '.agent-progress', 'tickets'))).toBe(true);
    expect(existsSync(join(repositoryDirectory, '.agent-progress', 'progress.html'))).toBe(true);
    expect(readFileSync(join(repositoryDirectory, '.gitignore'), 'utf8')).toContain('.agent-progress/');

    const claudeInstructions = readFileSync(join(repositoryDirectory, 'CLAUDE.md'), 'utf8');
    expect(claudeInstructions).toContain(CLAUDE_MANAGED_BLOCK_MARKERS.start);
    expect(claudeInstructions).toContain('agent-progress');

    expect(readFileSync(join(repositoryDirectory, '.agent-progress', 'progress.json'), 'utf8')).toContain('Example Agency');
    expect(readFileSync(join(repositoryDirectory, '.agent-progress', 'agent-brief.md'), 'utf8')).toStartWith('# Agent brief');
    expect(context.outputText()).toContain('.gitignore:');
    expect(context.outputText()).toContain('progress.html');
    expect(context.errorText()).toBe('');
  });

  // A new tracker's log starts empty, so a log left from a removed tracker is never adopted as its history.
  test('a fresh init empties a log.jsonl left from a removed tracker', async () => {
    const repositoryDirectory = scratchRepository();
    const logFilePath         = join(repositoryDirectory, '.agent-progress', 'log.jsonl');
    mkdirSync(join(repositoryDirectory, '.agent-progress'), { recursive: true });
    writeFileSync(logFilePath, '{"at":"2026-09-18T08:00:00+02:00","kind":"note","fields":{"text":"A line from a removed tracker"}}\n');
    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory });

    expect(await runCommandLine(['init', '--project', 'Example Agency'], context)).toBe(0);

    expect(context.outputText()).not.toContain('already initialised');
    expect(readFileSync(logFilePath, 'utf8')).toBe('');
  });

  test('a ticket file left from a removed tracker that will not parse is the first line on standard error, and init still exits 0', async () => {
    const repositoryDirectory = scratchRepository();
    const ticketsDirectory    = join(realpathSync(repositoryDirectory), '.agent-progress', 'tickets');
    const ticketFilePath      = join(ticketsDirectory, '001-broken-by-hand.md');
    mkdirSync(ticketsDirectory, { recursive: true });
    writeFileSync(ticketFilePath, 'no frontmatter here\n');
    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory });

    expect(await runCommandLine(['init', '--project', 'Example Agency'], context)).toBe(0);

    expect(context.errorText().split('\n')[0]).toBe(`Ticket file ignored: ${ticketFilePath} (line 1): the first line must be the frontmatter fence \`---\``);
  });

  test('the project name defaults to the directory the tracker is in', async () => {
    const repositoryDirectory = scratchRepository();
    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory });

    await runCommandLine(['init'], context);

    const stored = storedProgressOf(repositoryDirectory);
    expect(repositoryDirectory.endsWith(stored.project)).toBe(true);
  });

  test('--no-claude-md leaves the repository\'s instructions file exactly as it was', async () => {
    const repositoryDirectory = scratchRepository();
    const claudeFilePath      = join(repositoryDirectory, 'CLAUDE.md');
    writeFileSync(claudeFilePath, '# Example Agency\n\nRules nobody asked this tool to touch.\n');
    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory });

    expect(await runCommandLine(['init', '--no-claude-md'], context)).toBe(0);

    expect(readFileSync(claudeFilePath, 'utf8')).toBe('# Example Agency\n\nRules nobody asked this tool to touch.\n');
    expect(existsSync(join(repositoryDirectory, '.agent-progress', 'progress.json'))).toBe(true);
  });

  // The matcher is empty on purpose: every subagent type is recorded, so the log covers the same agents `usage` reports on.
  // It goes in the local settings file, which is per-user and stays out of git, so an accurate token figure costs nobody a shared commit.
  test('writes the SubagentStop entry into .claude/settings.local.json by default, leaving the shared settings file alone', async () => {
    const repositoryDirectory = scratchRepository();
    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory });

    expect(await runCommandLine(['init'], context)).toBe(0);

    const settings = JSON.parse(readFileSync(join(repositoryDirectory, '.claude', 'settings.local.json'), 'utf8')) as Record<string, unknown>;
    expect((settings['hooks'] as Record<string, unknown>)['SubagentStop']).toEqual([
      { matcher: '', hooks: [{ type: 'command', command: 'agent-progress hook subagent-stop', timeout: 20 }] },
    ]);
    expect(existsSync(join(repositoryDirectory, '.claude', 'settings.json'))).toBe(false);
    expect(context.outputText()).toContain('settings.local.json (installed)');
    expect(context.errorText()).toBe('');
  });

  test('--no-hooks leaves both settings files unwritten', async () => {
    const withoutHooks = scratchRepository();
    const optedOut     = createCapturedCommandContext({ currentDirectory: withoutHooks });
    expect(await runCommandLine(['init', '--no-hooks'], optedOut)).toBe(0);

    expect(existsSync(join(withoutHooks, '.claude', 'settings.local.json'))).toBe(false);
    expect(existsSync(join(withoutHooks, '.claude', 'settings.json'))).toBe(false);
    expect(optedOut.outputText()).toContain('hooks:       left alone (--no-hooks)');
  });

  // The orchestrator launches the dispatcher by this path, so a copy that differs from the generated script by a byte is a dispatcher nobody tested.
  test('installs the dispatcher in the tracker directory byte-identical to the generated script, and nothing under .claude/workflows', async () => {
    const repositoryDirectory = scratchRepository();
    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory });

    expect(await runCommandLine(['init'], context)).toBe(0);

    expect(readFileSync(dispatcherScriptPathIn(repositoryDirectory), 'utf8')).toBe(GENERATED_DISPATCHER_SCRIPT);
    expect(existsSync(join(repositoryDirectory, '.claude', 'workflows'))).toBe(false);
    expect(context.outputText()).toMatch(/workflow: {4}updated \(\S+\/\.agent-progress\/agent-progress-dispatch\.js\)\n/);
  });

  test('--no-workflow writes no dispatcher, in the tracker or under .claude/workflows, and says so', async () => {
    const repositoryDirectory = scratchRepository();
    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory });

    expect(await runCommandLine(['init', '--no-workflow', '--no-hooks', '--no-agent-definition'], context)).toBe(0);

    expect(existsSync(join(repositoryDirectory, '.claude')), 'with the hook and the agent opted out too, nothing at all lands in .claude/').toBe(false);
    expect(existsSync(dispatcherScriptPathIn(repositoryDirectory))).toBe(false);
    expect(context.outputText()).toContain('workflow:    left alone (--no-workflow)');
  });

  // The Agent tool takes a subagent's effort from its definition alone, so this file is the only way a hand-spawned agent runs on the default pair.
  test('installs the worker agent definition with the default model and effort in its frontmatter', async () => {
    const repositoryDirectory = scratchRepository();
    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory });

    expect(await runCommandLine(['init'], context)).toBe(0);

    const definitionText = readFileSync(join(repositoryDirectory, '.claude', 'agents', 'agent-progress-worker.md'), 'utf8');
    const frontmatter    = definitionText.split('---\n')[1] ?? '';
    expect(frontmatter).toContain('name: agent-progress-worker\n');
    expect(frontmatter).toContain('model: opus\n');
    expect(frontmatter).toContain('effort: medium\n');
    expect(definitionText).not.toContain('{{');
    expect(context.outputText()).toMatch(/agent: {7}updated \(\S+\/\.claude\/agents\/agent-progress-worker\.md\)/);
  });

  test('--no-agent-definition writes nothing under .claude/agents, and says so', async () => {
    const repositoryDirectory = scratchRepository();
    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory });

    expect(await runCommandLine(['init', '--no-agent-definition'], context)).toBe(0);

    expect(existsSync(join(repositoryDirectory, '.claude', 'agents'))).toBe(false);
    expect(context.outputText()).toContain('agent:       left alone (--no-agent-definition)');
  });

  test('records the install version in the tracker directory as exactly the CLI\'s own', async () => {
    const repositoryDirectory = scratchRepository();

    expect(await runCommandLine(['init'], createCapturedCommandContext({ currentDirectory: repositoryDirectory }))).toBe(0);

    expect(readFileSync(join(repositoryDirectory, '.agent-progress', 'version.json'), 'utf8')).toBe(`{\n  "installVersion": ${INSTALL_VERSION}\n}\n`);
  });

  test('a fresh init cut short after its first installed file leaves the tracker unversioned, so the next command asks for a rerun', async () => {
    const repositoryDirectory = scratchRepository();
    const rootDirectory       = realpathSync(repositoryDirectory);
    // A directory where the agent definition goes makes its write fail after the brief, the dispatcher and the CLAUDE.md block.
    mkdirSync(installedFilePathsIn(rootDirectory).agentDefinition, { recursive: true });

    expect(await runCommandLine(['init'], createCapturedCommandContext({ currentDirectory: repositoryDirectory }))).toBe(2);
    expect(existsSync(installedFilePathsIn(rootDirectory).agentBrief)).toBe(true);
    expect(existsSync(installedFilePathsIn(rootDirectory).installManifest)).toBe(false);

    const nextCommand = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['task', 'add', 'Example row'], nextCommand)).toBe(1);
    expect(nextCommand.errorText()).toBe(InstallVersionWordingUtil.messageOf({
      kind:             'install-version-mismatch',
      rootDirectory,
      manifestFilePath: installedFilePathsIn(rootDirectory).installManifest,
      installVersion:   INSTALL_VERSION,
      mismatch:         { reason: 'unversioned' },
    }));
  });

  test('--root tracks the directory it names rather than the discovered repository root', async () => {
    const repositoryDirectory = scratchRepository();
    const plainDirectory      = createScratchGitRepository('init-command-root');
    scratchDirectories.push(plainDirectory);
    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory });

    expect(await runCommandLine(['init', '--root', plainDirectory], context)).toBe(0);

    expect(existsSync(join(plainDirectory, '.agent-progress', 'progress.json'))).toBe(true);
    expect(existsSync(join(repositoryDirectory, '.agent-progress', 'progress.json'))).toBe(false);
  });
});

describe.skipIf(!gitIsAvailable())('a second init', () => {
  test('at the same root refreshes the CLAUDE.md block, keeps the tracker and exits 0', async () => {
    const repositoryDirectory = scratchRepository();
    const first = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    await runCommandLine(['init'], first);
    const trackerIdBefore = storedProgressOf(repositoryDirectory).trackerId;

    const claudeFilePath = join(repositoryDirectory, 'CLAUDE.md');
    writeFileSync(claudeFilePath, `${CLAUDE_MANAGED_BLOCK_MARKERS.start}\n<!-- agent-progress:managed:end -->\n`);
    const briefFilePath = join(repositoryDirectory, '.agent-progress', 'agent-brief.md');
    writeFileSync(briefFilePath, 'An older brief nobody refreshed.\n');

    const second = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['init'], second)).toBe(0);

    expect(second.outputText()).toContain('already initialised');
    expect(second.outputText(), 'a re-run says so on both paths, or the hook is invisible to a repository that adopted the tool a month ago').toContain('hooks:       ');
    expect(second.outputText(), 'the refresh has its own verb now').toContain('`agent-progress update` is the command for this refresh');
    expect(readFileSync(claudeFilePath, 'utf8')).toContain('agent-progress');
    expect(readFileSync(briefFilePath, 'utf8'), 'the brief is shipped guidance, so a re-run restores the current wording').toStartWith('# Agent brief');
    // The tracker id is the page's localStorage key, so a re-run that reset it would reset every reader's stored range.
    expect(storedProgressOf(repositoryDirectory).trackerId).toBe(trackerIdBefore);
  });

  test('one directory below an existing tracker is refused with exit 1 and names where the tracker is', async () => {
    const repositoryDirectory = scratchRepository();
    await runCommandLine(['init'], createCapturedCommandContext({ currentDirectory: repositoryDirectory }));
    const nestedDirectory = join(repositoryDirectory, 'packages', 'example');
    mkdirSync(nestedDirectory, { recursive: true });

    const context = createCapturedCommandContext({ currentDirectory: nestedDirectory });
    expect(await runCommandLine(['init', '--root', nestedDirectory], context)).toBe(1);

    expect(context.errorText()).toContain(repositoryDirectory);
    expect(context.errorText(), 'the refresh at the tracker\'s root is `update`, and it refreshes more than the block').toContain('agent-progress update');
    expect(context.errorText()).not.toContain('only refreshes the CLAUDE.md block');
    expect(existsSync(join(nestedDirectory, '.agent-progress'))).toBe(false);
  });

  test('a re-run with --no-claude-md does not claim the block was refreshed', async () => {
    const repositoryDirectory = scratchRepository();
    await runCommandLine(['init'], createCapturedCommandContext({ currentDirectory: repositoryDirectory }));

    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['init', '--no-claude-md'], context)).toBe(0);

    expect(context.outputText()).toContain('already initialised');
    expect(context.outputText()).not.toContain('CLAUDE.md block refreshed');
    expect(context.outputText()).toContain('left alone');
  });

  // The tracker walk misses a progress file that is not a readable regular file, so only the create-exclusive store write keeps it.
  test('a progress file the tracker walk does not recognise is refreshed around, never replaced', async () => {
    const repositoryDirectory = scratchRepository();
    const progressFilePath    = join(repositoryDirectory, '.agent-progress', 'progress.json');
    const missingTargetPath   = join(repositoryDirectory, 'missing-progress-target.json');
    mkdirSync(join(repositoryDirectory, '.agent-progress'), { recursive: true });
    symlinkSync(missingTargetPath, progressFilePath);

    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['init'], context)).toBe(0);

    expect(context.outputText()).toContain('already initialised');
    expect(readlinkSync(progressFilePath)).toBe(missingTargetPath);
    expect(existsSync(missingTargetPath)).toBe(false);
  });

  test('over files a newer agent-progress installed is refused with exit 1 and the newer paragraph, and nothing is written', async () => {
    const repositoryDirectory = scratchRepository();
    await runCommandLine(['init'], createCapturedCommandContext({ currentDirectory: repositoryDirectory }));
    writeFileSync(join(repositoryDirectory, '.agent-progress', 'agent-brief.md'), 'An older brief nobody refreshed.\n');
    const rootDirectory    = realpathSync(repositoryDirectory);
    const manifestFilePath = installedFilePathsIn(rootDirectory).installManifest;
    writeFileSync(manifestFilePath, `{\n  "installVersion": ${INSTALL_VERSION + 1}\n}\n`);
    const filesBefore = repositoryFileContentsOf(repositoryDirectory);

    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['init'], context)).toBe(1);

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

describe.skipIf(!gitIsAvailable())('from inside a linked worktree', () => {
  test('the tracker is created in the main checkout, not in the worktree', async () => {
    const repositoryDirectory = scratchRepository();
    const worktreeDirectory   = addWorktree(repositoryDirectory, 'subagent');

    const context = createCapturedCommandContext({ currentDirectory: worktreeDirectory });
    expect(await runCommandLine(['init'], context)).toBe(0);

    expect(existsSync(join(repositoryDirectory, '.agent-progress', 'progress.json'))).toBe(true);
    expect(existsSync(join(worktreeDirectory, '.agent-progress'))).toBe(false);
  });
});

describe.skipIf(!gitIsAvailable())('the two places init refuses before it writes anything', () => {
  test('a bare repository is refused, rather than tracked from its parent directory', async () => {
    const parentDirectory = createScratchDirectory('init-bare-parent');
    scratchDirectories.push(parentDirectory);
    const bareDirectory = join(parentDirectory, 'example.git');
    Bun.spawnSync(['git', 'init', '-q', '--bare', bareDirectory], { stdout: 'pipe', stderr: 'pipe' });

    const context  = createCapturedCommandContext({ currentDirectory: bareDirectory });
    const exitCode = await runCommandLine(['init'], context);

    expect(exitCode).toBe(1);
    expect(context.errorText()).toContain('bare git repository');
    expect(existsSync(join(parentDirectory, '.agent-progress')), 'nothing was written beside the bare repository').toBe(false);
    expect(existsSync(join(parentDirectory, 'CLAUDE.md'))).toBe(false);
  });

  test('--root naming a file or a path that is not there is refused with exit 1, not a raw errno', async () => {
    const repositoryDirectory = scratchRepository();
    writeFileSync(join(repositoryDirectory, 'notes.txt'), 'not a directory\n');

    for (const rootOption of ['notes.txt', 'no-such-directory']) {
      const context  = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
      const exitCode = await runCommandLine(['init', '--root', rootOption], context);

      expect(exitCode, rootOption).toBe(1);
      expect(context.errorText(), rootOption).toContain('is not an existing directory');
    }
    expect(existsSync(join(repositoryDirectory, 'no-such-directory'))).toBe(false);
  });

  test('the .gitignore line is reported in words a person reads, not as a verdict name', async () => {
    const repositoryDirectory = scratchRepository();

    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    await runCommandLine(['init'], context);

    expect(context.outputText()).toContain('.gitignore:  entry added');
    expect(context.outputText()).not.toContain('no-gitignore-written');
  });
});

describe.skipIf(!gitIsAvailable())('a dispatcher that will not bundle', () => {
  let realWorkflowScriptBundleExports: Record<string, unknown> = {};

  // Bun keeps a module mock for the rest of the process, so the real exports are copied before the stub goes in and mocked back afterwards.
  beforeAll(() => {
    realWorkflowScriptBundleExports = { ...realWorkflowScriptBundleModule };
    mock.module('../../../src/lib/claude-code/WorkflowScriptBundle.ts', () => ({
      ...realWorkflowScriptBundleExports,
      bundleWorkflowScript: () => Promise.resolve({ verdict: 'failed', reason: 'build-failed', detail: 'Example build failure' }),
    }));
  });

  afterAll(() => {
    mock.module('../../../src/lib/claude-code/WorkflowScriptBundle.ts', () => realWorkflowScriptBundleExports);
  });

  // Every installed text is computed before the first write, so a fresh init that cannot generate the dispatcher leaves no tracker behind.
  test('stops a fresh init at exit 2 before it writes a tracker, a .gitignore entry, a CLAUDE.md block or a manifest', async () => {
    const repositoryDirectory = scratchRepository();
    const contentsBefore      = repositoryFileContentsOf(repositoryDirectory);

    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['init'], context)).toBe(2);

    expect(context.errorText()).toContain('could not be generated');
    expect(existsSync(join(repositoryDirectory, '.agent-progress'))).toBe(false);
    expect(repositoryFileContentsOf(repositoryDirectory)).toEqual(contentsBefore);
  });
});
