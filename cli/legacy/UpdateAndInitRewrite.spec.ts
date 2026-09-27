/**
 * What `update` and `init` do only for older trackers and older habits: a version 1 progress file, a version 2 one holding a retired word
 * or a review row known only by its name, and a ticket in a retired word are rewritten once in the current format, a rewrite that cannot
 * take the lock still prints the refresh report and records no install version, and `--hooks` is accepted.
 * It answers the older input and habit `cli/legacy/` and `src/services/tracker/legacy/` exist for, and is deleted with them.
 */
import {
  existsSync,
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
}                                       from 'bun:test';
import { workspacePathsFor }                                                  from '../../src/services/tracker/Workspace.ts';
import { LIMITS }                                                             from '../../src/shared/constants/Limits.ts';
import { createScratchGitRepository, gitIsAvailable, removeScratchDirectory } from '../../src/testing/ScratchWorkspace.ts';
import { storedFileContentsOf }                                               from '../../src/testing/TrackerFileFixtures.ts';
import { runCommandLine }                                                     from '../Main.ts';
import { CLAUDE_MANAGED_BLOCK_MARKERS }                                       from '../adoption/constants/ClaudeManagedBlockMarkers.ts';
import { createCapturedCommandContext }                                       from '../testing/CapturedCommandContext.ts';

const scratchDirectories: string[] = [];

/** Every run below renders at the same moment, so a run that changes nothing leaves the page byte for byte too. */
const FROZEN_NOW = new Date('2026-09-18T10:00:00+02:00');

/** A lock that is never given up is waited out through the whole retry budget before the refusal. */
const HELD_LOCK_TIMEOUT_MILLISECONDS = LIMITS.LOCK_RETRY_COUNT * LIMITS.LOCK_RETRY_INTERVAL_MILLISECONDS * 3;

function scratchRepository(): string {
  const repositoryDirectory = createScratchGitRepository('older-tracker-rewrite');
  scratchDirectories.push(repositoryDirectory, `${repositoryDirectory}-worktrees`);
  return repositoryDirectory;
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

describe.skipIf(!gitIsAvailable())('the --hooks habit', () => {
  /** The flag that used to ask for the hook is now the default; a habit that still types it is answered, not refused. */
  test('update --hooks is still accepted and does what the default already does', async () => {
    const repositoryDirectory = await trackedRepositoryWithStaleFiles();

    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['update', '--hooks'], context)).toBe(0);

    expect(context.outputText()).toContain('settings.local.json (installed)');
  });

  test('init --hooks is still accepted for the habit', async () => {
    const withTheOldFlag = scratchRepository();
    const asked          = createCapturedCommandContext({ currentDirectory: withTheOldFlag });
    expect(await runCommandLine(['init', '--hooks'], asked)).toBe(0);
    expect(asked.outputText()).toContain('settings.local.json (installed)');
  });
});

interface TrackerInAnOlderFormat {
  repositoryDirectory: string;
  progressFilePath:    string;
  logFilePath:         string;
  ticketFilePath:      string;
}

/** A tracker as a build before log.jsonl left it: the log inside a version 1 progress file, and a ticket holding the retired word `open`. */
async function trackedRepositoryInAnOlderFormat(): Promise<TrackerInAnOlderFormat> {
  const repositoryDirectory = await trackedRepositoryWithStaleFiles();
  await runCommandLine(['ticket', 'add', 'Rename the export button', '--type', 'change'], createCapturedCommandContext({ currentDirectory: repositoryDirectory }));

  const trackerDirectory = join(repositoryDirectory, '.agent-progress');
  const progressFilePath = join(trackerDirectory, 'progress.json');
  const logFilePath      = join(trackerDirectory, 'log.jsonl');
  const ticketsDirectory = join(trackerDirectory, 'tickets');
  const ticketFilePath   = join(ticketsDirectory, readdirSync(ticketsDirectory)[0] ?? '');

  const currentProgress = JSON.parse(readFileSync(progressFilePath, 'utf8')) as Record<string, unknown>;
  const versionOneProgress = {
    ...currentProgress,
    version: 1,
    log:     [{ at: '2026-09-18T09:00:00+02:00', text: 'Example session started' }],
  };
  writeFileSync(progressFilePath, `${JSON.stringify(versionOneProgress, null, 2)}\n`);
  rmSync(logFilePath);
  writeFileSync(ticketFilePath, readFileSync(ticketFilePath, 'utf8').replace('status: "pending"', 'status: open'));
  return {
    repositoryDirectory,
    progressFilePath,
    logFilePath,
    ticketFilePath,
  };
}

interface StoredRow {
  status:          string;
  history?:        Array<{ status: string }>;
  reviewOf?:       string;
  reviewBarRound?: number;
}

/** A version 2 tracker as a build before the status rename and the review link left it: a row and its phase running, and a bar named only. */
async function trackedRepositoryWithVersionTwoRowsInOlderWords(): Promise<{ repositoryDirectory: string; progressFilePath: string }> {
  const repositoryDirectory = scratchRepository();
  for (const commandLineArguments of [
    ['init', '--project', 'Example Agency'],
    ['ticket', 'add', 'Example importer', '--type', 'change'],
    ['task', 'add', 'Draft the example page', '--start'],
  ]) {
    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory, now: () => FROZEN_NOW });
    expect(await runCommandLine(commandLineArguments, context), context.errorText()).toBe(0);
  }

  const progressFilePath = join(repositoryDirectory, '.agent-progress', 'progress.json');
  const stored           = JSON.parse(readFileSync(progressFilePath, 'utf8')) as { nextTaskId: number; tasks: Array<Record<string, unknown>> };
  const draftingRow      = stored.tasks.find((row) => row['name'] === 'Draft the example page');
  if (draftingRow === undefined) throw new Error('expected the filed row in progress.json');
  draftingRow['status']  = 'running';
  draftingRow['history'] = (draftingRow['history'] as Array<Record<string, unknown>>).map((phase) => ({ ...phase, status: 'running' }));
  stored.tasks.push({
    id:     stored.nextTaskId,
    name:   'Review 1 #001 — Example importer',
    status: 'pending',
    start:  null,
    end:    null,
    owner:  '',
    note:   '',
    ticket: null,
    tokens: null,
  });
  stored.nextTaskId += 1;
  writeFileSync(progressFilePath, `${JSON.stringify(stored, null, LIMITS.JSON_INDENT_SPACES)}\n`);
  return { repositoryDirectory, progressFilePath };
}

describe.skipIf(!gitIsAvailable())('what update rewrites', () => {
  test('a version 2 progress file holding a retired word and a review row known only by its name is stored current, and a second run touches nothing', async () => {
    const { repositoryDirectory, progressFilePath } = await trackedRepositoryWithVersionTwoRowsInOlderWords();
    expect(readFileSync(progressFilePath, 'utf8'), 'the fixture holds the retired word, so the rewrite below is about something').toContain('"running"');

    const first = createCapturedCommandContext({ currentDirectory: repositoryDirectory, now: () => FROZEN_NOW });
    expect(await runCommandLine(['update'], first)).toBe(0);

    expect(first.outputText().split('\n')[0]).toEndWith(', and rewrote its older tracker files in the current format: progress.json.');
    const [, draftingRow, reviewRow] = (JSON.parse(readFileSync(progressFilePath, 'utf8')) as { tasks: StoredRow[] }).tasks;
    expect(draftingRow?.status).toBe('in-progress');
    expect(draftingRow?.history?.map((phase) => phase.status)).toEqual(['in-progress', 'in-progress']);
    expect(reviewRow).toMatchObject({ reviewOf: '001', reviewBarRound: 1 });

    const filesAfterTheRewrite = storedFileContentsOf(workspacePathsFor(repositoryDirectory));
    const second               = createCapturedCommandContext({ currentDirectory: repositoryDirectory, now: () => FROZEN_NOW });
    expect(await runCommandLine(['update'], second)).toBe(0);

    expect(second.outputText().split('\n')[0]).toEndWith('; the tracker itself was not touched.');
    expect(storedFileContentsOf(workspacePathsFor(repositoryDirectory))).toEqual(filesAfterTheRewrite);
  });

  test('a version 1 progress file and a ticket holding a retired word are rewritten in the current format, and a second run touches nothing', async () => {
    const {
      repositoryDirectory,
      progressFilePath,
      logFilePath,
      ticketFilePath
    } = await trackedRepositoryInAnOlderFormat();
    expect(readFileSync(ticketFilePath, 'utf8'), 'the fixture holds the retired word, so the rewrite below is about something').toContain('status: open');

    const first = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['update'], first)).toBe(0);

    expect(first.outputText().split('\n')[0]).toEndWith(
      ', and rewrote its older tracker files in the current format: progress.json (its log moved to log.jsonl) and 1 ticket file.',
    );
    const storedProgress = JSON.parse(readFileSync(progressFilePath, 'utf8')) as Record<string, unknown>;
    expect(storedProgress['version']).toBe(2);
    expect(storedProgress).not.toHaveProperty('log');
    expect(readFileSync(logFilePath, 'utf8')).toBe('{"at":"2026-09-18T09:00:00+02:00","kind":"note","fields":{"text":"Example session started"}}\n');
    expect(readFileSync(ticketFilePath, 'utf8')).toContain('status: "pending"');

    const progressAfterRewrite = readFileSync(progressFilePath, 'utf8');
    const logAfterRewrite      = readFileSync(logFilePath, 'utf8');
    const ticketAfterRewrite   = readFileSync(ticketFilePath, 'utf8');
    const second = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['update'], second)).toBe(0);

    expect(second.outputText().split('\n')[0]).toEndWith('; the tracker itself was not touched.');
    expect(readFileSync(progressFilePath, 'utf8')).toBe(progressAfterRewrite);
    expect(readFileSync(logFilePath, 'utf8')).toBe(logAfterRewrite);
    expect(readFileSync(ticketFilePath, 'utf8')).toBe(ticketAfterRewrite);
  });

  /** The refreshed files are already on disk when the lock is refused, so the report that names a stale brief must still be printed. */
  test('a rewrite that cannot take the lock exits 2 after the refresh report, leaving the progress file as it was and no install version', async () => {
    const { repositoryDirectory, progressFilePath } = await trackedRepositoryInAnOlderFormat();
    const progressBefore   = readFileSync(progressFilePath, 'utf8');
    const manifestFilePath = join(repositoryDirectory, '.agent-progress', 'version.json');
    rmSync(manifestFilePath);
    const lockFilePath     = join(repositoryDirectory, '.agent-progress', '.lock');
    rmSync(lockFilePath, { force: true, recursive: true });
    writeFileSync(lockFilePath, '');

    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['update'], context)).toBe(2);

    const outputLines = context.outputText().split('\n');
    expect(outputLines[0]).toEndWith('; rewriting its older tracker files did not finish, so some may already be in the current format.');
    expect(outputLines[2]).toStartWith('  brief:       updated — re-read it before your next brief');
    expect(outputLines.slice(1, 7).map((line) => line.slice(0, 15))).toEqual([
      '  CLAUDE.md:   ',
      '  brief:       ',
      '  hooks:       ',
      '  workflow:    ',
      '  agent:       ',
      '  dashboard:   ',
    ]);
    expect(readFileSync(progressFilePath, 'utf8')).toBe(progressBefore);
    expect(existsSync(manifestFilePath), 'a refresh cut short leaves the old version, so every command keeps asking for update').toBe(false);
  }, HELD_LOCK_TIMEOUT_MILLISECONDS);
});

describe.skipIf(!gitIsAvailable())('what a second init rewrites', () => {
  test('a version 2 progress file holding a retired word and a review row known only by its name is named on the tracker line', async () => {
    const { repositoryDirectory, progressFilePath } = await trackedRepositoryWithVersionTwoRowsInOlderWords();

    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory, now: () => FROZEN_NOW });
    expect(await runCommandLine(['init'], context)).toBe(0);

    expect(context.outputText().split('\n')[1]).toBe('  tracker:     rewrote progress.json in the current format');
    expect(JSON.parse(readFileSync(progressFilePath, 'utf8'))).toMatchObject({ tasks: [{ ticket: '001' }, { status: 'in-progress' }, { reviewOf: '001', reviewBarRound: 1 }] });
  });

  /** The refreshed files are already on disk when the lock is refused, so the report that names a stale brief must still be printed. */
  test('a rewrite of an older tracker that cannot take the lock exits 2 after the refresh report, leaving the progress file as it was and no install version', async () => {
    const repositoryDirectory = scratchRepository();
    await runCommandLine(['init'], createCapturedCommandContext({ currentDirectory: repositoryDirectory }));
    const trackerDirectory   = join(repositoryDirectory, '.agent-progress');
    const progressFilePath   = join(trackerDirectory, 'progress.json');
    const versionOneProgress = {
      ...(JSON.parse(readFileSync(progressFilePath, 'utf8')) as Record<string, unknown>),
      version: 1,
      log:     [{ at: '2026-09-18T09:00:00+02:00', text: 'Example session started' }],
    };
    writeFileSync(progressFilePath, `${JSON.stringify(versionOneProgress, null, 2)}\n`);
    // A version 1 tracker has no log.jsonl.
    rmSync(join(trackerDirectory, 'log.jsonl'));
    const progressBefore = readFileSync(progressFilePath, 'utf8');
    writeFileSync(join(trackerDirectory, 'agent-brief.md'), 'An older brief nobody refreshed.\n');
    const manifestFilePath = join(trackerDirectory, 'version.json');
    rmSync(manifestFilePath);
    const lockFilePath = join(trackerDirectory, '.lock');
    rmSync(lockFilePath, { force: true, recursive: true });
    writeFileSync(lockFilePath, '');

    const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory });
    expect(await runCommandLine(['init'], context)).toBe(2);

    const outputLines = context.outputText().split('\n');
    expect(outputLines[0]).toStartWith('agent-progress is already initialised in ');
    expect(outputLines.slice(1, 9).map((line) => line.slice(0, 15))).toEqual([
      '  tracker:     ',
      '  CLAUDE.md:   ',
      '  brief:       ',
      '  hooks:       ',
      '  workflow:    ',
      '  agent:       ',
      '  dashboard:   ',
      '  `agent-progre',
    ]);
    expect(outputLines[1]).toBe('  tracker:     rewriting older files did not finish; some may already be in the current format');
    expect(outputLines[3]).toStartWith('  brief:       updated — re-read it before your next brief');
    expect(readFileSync(progressFilePath, 'utf8')).toBe(progressBefore);
    expect(existsSync(manifestFilePath), 'a refresh cut short leaves the old version, so every command keeps asking for update').toBe(false);
  }, HELD_LOCK_TIMEOUT_MILLISECONDS);
});
