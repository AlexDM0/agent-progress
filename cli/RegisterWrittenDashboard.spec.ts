/**
 * The monitor registry `~/.agent-progress-monitor/projects.json` as the commands write it, under a scratch home and with the temp-folder
 * rule pointed at a scratch folder the repositories lie outside, so they count as real ones. What matters: exactly a call that wrote
 * `progress.html` registers, one entry per `trackerId` carrying every field with its value; a read-only call, `update`, a
 * failed render and a tracker under any temp folder (`/tmp`, `/var/tmp`, the system one) register nothing; the file's version, unknown keys
 * and malformed entries are handled as `docs/cli.md` says; a registry that cannot be written never changes the exit code; and concurrent
 * processes all land in the file. A case needing a registered tracker outside `/tmp` and `/var/tmp` is skipped where the scratch root lies
 * under either (Linux), since neither a child's `TMPDIR` nor the case can move those.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir }        from 'node:os';
import { dirname, join } from 'node:path';

import {
  afterEach,
  beforeEach,
  expect,
  test
} from 'bun:test';

import { LocalTimeUtil }          from '../src/lib/local-time/LocalTimeUtil.ts';
import { registerWithTheMonitor } from '../src/services/tracker/MonitorRegistration.ts';
import { withLockAt }             from '../src/services/tracker/TrackerLock.ts';
import { workspacePathsFor }      from '../src/services/tracker/Workspace.ts';
import { PRODUCT_NAMES }          from '../src/shared/constants/ProductNames.ts';
import {
  createScratchCopyOf,
  createScratchDirectory,
  createScratchGitRepository,
  gitOutputIn,
  removeScratchDirectory
} from '../src/testing/ScratchWorkspace.ts';
import { testWhenGitIsPresent, testWhenGitIsPresentAndTheScratchRootIsOutsideTmp } from '../src/testing/ToolGuard.ts';
import { temporaryDirectoriesOfThisMachine }                                       from './CommandContext.ts';
import { runCommandLine }                                                          from './Main.ts';
import { registerWrittenDashboard }                                                from './RegisterWrittenDashboard.ts';
import { createCapturedCommandContext }                                            from './testing/CapturedCommandContext.ts';
import { runAgentProgress }                                                        from './testing/CliProcess.ts';
import { createInitializedScratchRepository }                                      from './testing/InitializedScratchRepository.ts';

const FIRST_NOW  = new Date('2026-10-21T10:00:00Z');
const SECOND_NOW = new Date('2026-10-21T11:30:00Z');

const EXAMPLE_ORIGIN = 'https://example.invalid/example-agency.git';

const SPAWNED_CASE_TIMEOUT_MILLISECONDS = 60_000;

/** Long enough for a spawned render to reach the registry, well inside the lock's retry budget the children then wait out. */
const LOCK_HELD_WHILE_THE_CHILDREN_START_MILLISECONDS = 2_000;

interface RegistryEntry {
  project:       string;
  root:          string;
  progressHtml:  string;
  progressJson:  string;
  gitOrigin:     string | null;
  registeredAt:  string;
  lastChangedAt: string;
  lastCommand:   string;
}

interface RegistryDocument {
  version:  number;
  projects: Record<string, RegistryEntry>;
}

const scratchDirectories: string[] = [];
let homeDirectory              = '';
let folderOutsideEveryRepository = '';

function scratch(directory: string): string {
  scratchDirectories.push(directory);
  return directory;
}

beforeEach(() => {
  homeDirectory                = scratch(createScratchDirectory('monitor-home'));
  folderOutsideEveryRepository = scratch(createScratchDirectory('monitor-temporary-folder'));
});

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) removeScratchDirectory(directory);
});

function registryFilePath(): string {
  return join(homeDirectory, PRODUCT_NAMES.MONITOR_FOLDER, 'projects.json');
}

function registryText(): string {
  return readFileSync(registryFilePath(), 'utf8');
}

function registry(): RegistryDocument {
  return JSON.parse(registryText()) as RegistryDocument;
}

function trackerIdOf(repositoryDirectory: string): string {
  return (JSON.parse(readFileSync(workspacePathsFor(repositoryDirectory).progressFilePath, 'utf8')) as { trackerId: string }).trackerId;
}

function registeringContext(repositoryDirectory: string, now: Date = FIRST_NOW): ReturnType<typeof createCapturedCommandContext> {
  return createCapturedCommandContext({
    currentDirectory: repositoryDirectory, homeDirectory, temporaryDirectories: [folderOutsideEveryRepository], now: () => now
  });
}

async function initializedRepository(): Promise<string> {
  return scratch(await createInitializedScratchRepository('monitor-repository', ['--project', 'Example Agency'], () => FIRST_NOW));
}

async function requireExitZero(commandLine: readonly string[], context: ReturnType<typeof createCapturedCommandContext>): Promise<void> {
  expect(await runCommandLine(commandLine, context), context.errorText()).toBe(0);
}

/** Spawned with `TMPDIR` on the outside folder, so the child's own temp-folder rule does not reach the repository either. */
function renderInAChildProcess(repositoryDirectory: string): ReturnType<typeof runAgentProgress> {
  return runAgentProgress(['render'], { currentDirectory: repositoryDirectory, homeDirectory, environment: { TMPDIR: folderOutsideEveryRepository } });
}

testWhenGitIsPresent('A1: init registers one entry keyed by the trackerId, carrying every field with its value', async () => {
  const repositoryDirectory = scratch(createScratchGitRepository('monitor-init'));
  gitOutputIn(repositoryDirectory, ['remote', 'add', 'origin', EXAMPLE_ORIGIN]);
  await requireExitZero(['init', '--project', 'Example Agency'], registeringContext(repositoryDirectory));

  const document  = registry();
  const trackerId = trackerIdOf(repositoryDirectory);
  expect(document.version).toBe(1);
  expect(Object.keys(document.projects)).toEqual([trackerId]);
  const entry = document.projects[trackerId];
  expect(realpathSync(entry?.root ?? '')).toBe(realpathSync(repositoryDirectory));
  const paths = workspacePathsFor(entry?.root ?? '');
  expect(entry).toEqual({
    project:       'Example Agency',
    root:          paths.rootDirectory,
    progressHtml:  paths.htmlFilePath,
    progressJson:  paths.progressFilePath,
    gitOrigin:     EXAMPLE_ORIGIN,
    registeredAt:  LocalTimeUtil.formatLocalIso(FIRST_NOW),
    lastChangedAt: LocalTimeUtil.formatLocalIso(FIRST_NOW),
    lastCommand:   'init',
  });
  expect(Object.keys(entry ?? {})).toEqual(['project', 'root', 'progressHtml', 'progressJson', 'gitOrigin', 'registeredAt', 'lastChangedAt', 'lastCommand']);
});

testWhenGitIsPresent('A1: a mutating command and render each update lastChangedAt and lastCommand, keeping registeredAt; no origin is null', async () => {
  const repositoryDirectory = await initializedRepository();
  const trackerId           = trackerIdOf(repositoryDirectory);

  await requireExitZero(['log', 'Example milestone'], registeringContext(repositoryDirectory, FIRST_NOW));
  expect(registry().projects[trackerId]).toMatchObject({
    gitOrigin: null, registeredAt: LocalTimeUtil.formatLocalIso(FIRST_NOW), lastChangedAt: LocalTimeUtil.formatLocalIso(FIRST_NOW), lastCommand: 'log'
  });

  await requireExitZero(['ticket', 'add', 'Example ticket', '--type', 'ticket'], registeringContext(repositoryDirectory, SECOND_NOW));
  const firstStamp  = LocalTimeUtil.formatLocalIso(FIRST_NOW);
  const secondStamp = LocalTimeUtil.formatLocalIso(SECOND_NOW);
  expect(registry().projects[trackerId]).toMatchObject({ registeredAt: firstStamp, lastChangedAt: secondStamp, lastCommand: 'ticket add' });

  await requireExitZero(['render'], registeringContext(repositoryDirectory, SECOND_NOW));
  expect(registry().projects[trackerId]?.lastCommand).toBe('render');
  expect(Object.keys(registry().projects)).toEqual([trackerId]);
});

testWhenGitIsPresent('A2: status, ticket show, and open on a page that exists register nothing', async () => {
  const repositoryDirectory = await initializedRepository();
  await requireExitZero(['ticket', 'add', 'Example ticket', '--type', 'ticket'], createCapturedCommandContext({ currentDirectory: repositoryDirectory }));

  await requireExitZero(['status', '--json'], registeringContext(repositoryDirectory));
  await requireExitZero(['ticket', 'show', '1'], registeringContext(repositoryDirectory));
  // Spawned with a PATH holding only Bun, so no browser opener is found and none is launched.
  const environment = { TMPDIR: folderOutsideEveryRepository, PATH: dirname(process.execPath) };
  const opened      = await runAgentProgress(['open'], { currentDirectory: repositoryDirectory, homeDirectory, environment });
  expect(opened.exitCode, opened.standardError).toBe(0);
  expect(existsSync(registryFilePath())).toBe(false);
}, SPAWNED_CASE_TIMEOUT_MILLISECONDS);

testWhenGitIsPresent('A2: a status call leaves an existing registry byte-identical', async () => {
  const repositoryDirectory = await initializedRepository();
  await requireExitZero(['render'], registeringContext(repositoryDirectory));
  const before = registryText();
  await requireExitZero(['status'], registeringContext(repositoryDirectory, SECOND_NOW));
  expect(registryText()).toBe(before);
});

testWhenGitIsPresent('A2: update registers nothing, since it never writes progress.html', async () => {
  const repositoryDirectory = await initializedRepository();
  await requireExitZero(['update'], registeringContext(repositoryDirectory));
  expect(existsSync(registryFilePath())).toBe(false);
});

testWhenGitIsPresent('A2: a store write whose render failed registers nothing', async () => {
  const repositoryDirectory = await initializedRepository();
  const workspace           = workspacePathsFor(repositoryDirectory);
  const context             = registeringContext(repositoryDirectory);
  await registerWrittenDashboard(context, workspace, { verdict: 'unreadable', reading: { verdict: 'absent', filePath: workspace.progressFilePath } });
  expect(existsSync(registryFilePath())).toBe(false);
  await registerWrittenDashboard(context, workspace, { verdict: 'rendered', malformedTickets: [], malformedEpics: [] });
  expect(existsSync(registryFilePath())).toBe(true);
});

testWhenGitIsPresent('A2: a tracker under the system temp folder registers nothing, also when that folder is named through a symlink', async () => {
  const repositoryDirectory = await initializedRepository();
  await requireExitZero(['render'], createCapturedCommandContext({ currentDirectory: repositoryDirectory, homeDirectory, now: () => FIRST_NOW }));
  expect(existsSync(registryFilePath())).toBe(false);

  const linkToTheRepositoryFolder = join(folderOutsideEveryRepository, 'linked-temporary-folder');
  symlinkSync(realpathSync(dirname(repositoryDirectory)), linkToTheRepositoryFolder);
  await requireExitZero(['render'], createCapturedCommandContext({
    currentDirectory: repositoryDirectory, homeDirectory, temporaryDirectories: [linkToTheRepositoryFolder], now: () => FIRST_NOW
  }));
  expect(existsSync(registryFilePath())).toBe(false);
});

/** Registers straight through the service, since no spec may write a tracker under `/tmp` or `/var/tmp` themselves. */
async function registrationOfATrackerRootedAt(rootDirectory: string, temporaryDirectories: readonly string[]): Promise<string> {
  const outcome = await registerWithTheMonitor({
    workspace: workspacePathsFor(rootDirectory), homeDirectory, temporaryDirectories, command: 'render', now: () => FIRST_NOW
  });
  return outcome.verdict;
}

test('A1: a tracker rooted under /tmp registers nothing, named directly or through its resolved path', async () => {
  for (const rootDirectory of [join('/tmp', 'scratch-x'), join(realpathSync('/tmp'), 'scratch-x', 'nested')]) {
    expect(await registrationOfATrackerRootedAt(rootDirectory, temporaryDirectoriesOfThisMachine())).toBe('not-registered-temporary-tracker');
  }
  expect(existsSync(registryFilePath())).toBe(false);
});

test('A2: a tracker rooted under /var/tmp or the system temp folder registers nothing, each resolved through symlinks', async () => {
  const roots = [join('/var/tmp', 'scratch-x'), join(realpathSync('/var/tmp'), 'scratch-x'), join(tmpdir(), 'scratch-x'), join(realpathSync(tmpdir()), 'scratch-x')];
  for (const rootDirectory of roots) {
    expect(await registrationOfATrackerRootedAt(rootDirectory, temporaryDirectoriesOfThisMachine())).toBe('not-registered-temporary-tracker');
  }
  expect(existsSync(registryFilePath())).toBe(false);
});

testWhenGitIsPresentAndTheScratchRootIsOutsideTmp('A2: a tracker outside every temp folder still registers when /tmp and /var/tmp are among them', async () => {
  const repositoryDirectory = await initializedRepository();
  const temporaryDirectories = ['/tmp', '/var/tmp', folderOutsideEveryRepository];
  expect(await registrationOfATrackerRootedAt(repositoryDirectory, temporaryDirectories)).toBe('registered');
  expect(Object.keys(registry().projects)).toEqual([trackerIdOf(repositoryDirectory)]);
});

testWhenGitIsPresent('A3: a moved tracker updates its one entry\'s paths', async () => {
  const firstPlace  = await initializedRepository();
  const secondPlace = scratch(createScratchCopyOf(firstPlace, 'monitor-moved-repository'));
  await requireExitZero(['render'], registeringContext(firstPlace));
  await requireExitZero(['render'], registeringContext(secondPlace, SECOND_NOW));

  const entries = registry().projects;
  expect(Object.keys(entries)).toEqual([trackerIdOf(secondPlace)]);
  const entry = Object.values(entries)[0];
  expect(realpathSync(entry?.root ?? '')).toBe(realpathSync(secondPlace));
  expect(entry?.progressHtml).toBe(workspacePathsFor(entry?.root ?? '').htmlFilePath);
  expect(entry?.registeredAt).toBe(LocalTimeUtil.formatLocalIso(FIRST_NOW));
});

testWhenGitIsPresent('A4: a registry of a newer version is left byte-identical, with a warning and exit 0', async () => {
  const repositoryDirectory = await initializedRepository();
  const newerText           = '{"version":2,"projects":{"elsewhere":{"shape":"unknown"}}}';
  mkdirSync(dirname(registryFilePath()), { recursive: true });
  writeFileSync(registryFilePath(), newerText);

  const context = registeringContext(repositoryDirectory);
  await requireExitZero(['render'], context);
  expect(registryText()).toBe(newerText);
  expect(context.errorText()).toContain('is version 2, newer than this agent-progress writes; it was left untouched');
});

testWhenGitIsPresent('A4: unknown keys at the top level and on an entry survive a write, in order', async () => {
  const repositoryDirectory = await initializedRepository();
  const trackerId           = trackerIdOf(repositoryDirectory);
  mkdirSync(dirname(registryFilePath()), { recursive: true });
  writeFileSync(registryFilePath(), JSON.stringify({
    comment:  'kept first',
    version:  1,
    projects: { other: { project: 'Other Example', pinned: true }, [trackerId]: { pinned: true, project: 'Old name', registeredAt: '2026-01-02T03:04:05+01:00' } },
    tail:     { kept: 'last' },
  }));

  await requireExitZero(['render'], registeringContext(repositoryDirectory));
  const document = registry() as unknown as Record<string, unknown>;
  expect(Object.keys(document)).toEqual(['comment', 'version', 'projects', 'tail']);
  expect(document['tail']).toEqual({ kept: 'last' });
  const entries = registry().projects;
  expect(Object.keys(entries)).toEqual(['other', trackerId]);
  expect(entries['other']).toEqual({ project: 'Other Example', pinned: true } as unknown as RegistryEntry);
  expect(Object.keys(entries[trackerId] ?? {})).toEqual(['pinned', 'project', 'registeredAt', 'root', 'progressHtml', 'progressJson', 'gitOrigin', 'lastChangedAt', 'lastCommand']);
  expect(entries[trackerId]).toMatchObject({ project: 'Example Agency', registeredAt: '2026-01-02T03:04:05+01:00' });
});

testWhenGitIsPresent('A4: a malformed registry is reported and rewritten keeping every readable entry, plus this one', async () => {
  const repositoryDirectory = await initializedRepository();
  mkdirSync(dirname(registryFilePath()), { recursive: true });
  writeFileSync(registryFilePath(), JSON.stringify({ version: 1, projects: { readable: { project: 'Other Example' }, broken: 'not an entry' } }));

  const context = registeringContext(repositoryDirectory);
  await requireExitZero(['render'], context);
  expect(Object.keys(registry().projects)).toEqual(['readable', trackerIdOf(repositoryDirectory)]);
  expect(context.errorText()).toContain('was malformed (entry "broken" is not an object); it was rewritten keeping every readable entry');

  writeFileSync(registryFilePath(), '{ not json');
  await requireExitZero(['render'], context);
  expect(Object.keys(registry().projects)).toEqual([trackerIdOf(repositoryDirectory)]);
});

testWhenGitIsPresent('A4: a registry that cannot be written warns on standard error and the command keeps exit 0', async () => {
  const repositoryDirectory = await initializedRepository();
  writeFileSync(join(homeDirectory, PRODUCT_NAMES.MONITOR_FOLDER), 'a file where the registry folder belongs');

  const context = registeringContext(repositoryDirectory);
  await requireExitZero(['log', 'Example milestone'], context);
  expect(context.errorText()).toContain(`The monitor registry ${registryFilePath()} could not be updated:`);
});

testWhenGitIsPresentAndTheScratchRootIsOutsideTmp('A5: several processes registering different projects at once all end up in the file', async () => {
  const repositoryDirectories = await Promise.all([1, 2, 3, 4].map(async (projectNumber) => {
    const repositoryDirectory = scratch(createScratchGitRepository(`monitor-concurrent-${projectNumber}`));
    await requireExitZero(['init', '--project', `Example Agency ${projectNumber}`], createCapturedCommandContext({ currentDirectory: repositoryDirectory }));
    return repositoryDirectory;
  }));

  // The registry's lock is held here while the children start, so a child writing without taking it would be seen writing meanwhile.
  mkdirSync(dirname(registryFilePath()), { recursive: true });
  let runningChildren: ReturnType<typeof renderInAChildProcess>[] = [];
  await withLockAt(join(dirname(registryFilePath()), '.lock'), async () => {
    runningChildren = repositoryDirectories.map(renderInAChildProcess);
    await Bun.sleep(LOCK_HELD_WHILE_THE_CHILDREN_START_MILLISECONDS);
    expect(existsSync(registryFilePath())).toBe(false);
  }, () => new Date());

  const results = await Promise.all(runningChildren);
  for (const result of results) expect(`${result.exitCode} ${result.standardError}`).toBe('0 ');
  expect(Object.keys(registry().projects).sort()).toEqual(repositoryDirectories.map(trackerIdOf).sort());
}, SPAWNED_CASE_TIMEOUT_MILLISECONDS);
