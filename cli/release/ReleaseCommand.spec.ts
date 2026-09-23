/**
 * `agent-progress release` against a scratch repository with a tracker in its main checkout and the reviewed work on a linked worktree.
 * The cases that matter are the ones a reviewer acts on without reading prose: every refusal leaves main, the ticket and the worktree
 * as they were; a cleanup git declines is reported at exit 0 because the release happened; and two releases racing for one main line
 * never both fast-forward it.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join }                                    from 'node:path';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test
}                                       from 'bun:test';
import { createCapturedCommandContext } from '../../lib/tooling/dev/CapturedCommandContext';
import {
  addWorktree,
  createScratchGitRepository,
  gitIsAvailable,
  removeScratchDirectory
}                                       from '../../lib/tooling/dev/ScratchWorkspace';
import { runCommandLine } from '../Main';

interface ReleaseDocument {
  released: boolean;
  reason?:  string;
  commit?:  string;
  cleanup:  Array<{ target: string; outcome: string; untrackedFiles?: string[] }>;
}

interface CommandOutcome {
  exitCode: number;
  output:   string;
  error:    string;
}

const COMMIT_IDENTITY = ['-c', 'user.name=Alex Example', '-c', 'user.email=alex.example@example.com', '-c', 'commit.gpgsign=false'];

const FROZEN_NOW = new Date('2026-09-23T10:00:00Z');

let repositoryDirectory = '';

function gitIn(directory: string, gitArguments: readonly string[]): string {
  const finished = Bun.spawnSync(['git', ...COMMIT_IDENTITY, ...gitArguments], { cwd: directory, stdout: 'pipe', stderr: 'pipe' });
  if (finished.exitCode !== 0) throw new Error(`git ${gitArguments.join(' ')} failed in ${directory}: ${finished.stderr.toString()}`);
  return finished.stdout.toString().trim();
}

function commitFile(directory: string, fileName: string, content: string): string {
  writeFileSync(join(directory, fileName), content);
  gitIn(directory, ['add', fileName]);
  gitIn(directory, ['commit', '-q', '-m', `Add ${fileName}`]);
  return gitIn(directory, ['rev-parse', 'HEAD']);
}

function mainTip(): string {
  return gitIn(repositoryDirectory, ['rev-parse', 'refs/heads/main']);
}

function branchExists(branch: string): boolean {
  return Bun.spawnSync(['git', 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: repositoryDirectory }).exitCode === 0;
}

async function agentProgress(commandLineArguments: readonly string[], currentDirectory = repositoryDirectory): Promise<CommandOutcome> {
  const context  = createCapturedCommandContext({ currentDirectory, now: () => FROZEN_NOW });
  const exitCode = await runCommandLine(commandLineArguments, context);
  return { exitCode, output: context.outputText(), error: context.errorText() };
}

async function agentProgressOrFail(commandLineArguments: readonly string[]): Promise<string> {
  const { exitCode, output, error } = await agentProgress(commandLineArguments);
  if (exitCode !== 0) throw new Error(`agent-progress ${commandLineArguments.join(' ')} exited ${exitCode}: ${error}`);
  return output;
}

async function readTicketDocument(identifier: string): Promise<Record<string, unknown>> {
  return JSON.parse(await agentProgressOrFail(['ticket', 'show', identifier, '--json'])) as Record<string, unknown>;
}

function ticketFileText(identifier: string): string {
  const ticketsDirectory = join(repositoryDirectory, '.agent-progress', 'tickets');
  const fileName         = [...new Bun.Glob(`${identifier}-*.md`).scanSync(ticketsDirectory)][0] ?? '';
  return readFileSync(join(ticketsDirectory, fileName), 'utf8');
}

/** A ticket in review whose work is one commit on a fresh linked worktree off the current main. */
async function reviewedTicketOnAWorktree(title: string, worktreeName: string): Promise<{ identifier: string; worktree: string; branch: string; tip: string }> {
  const added      = JSON.parse(await agentProgressOrFail(['ticket', 'add', title, '--json'])) as { id: string };
  const identifier = added.id;
  await agentProgressOrFail(['ticket', 'start', identifier]);
  await agentProgressOrFail(['ticket', 'review', identifier]);
  const worktree = addWorktree(repositoryDirectory, worktreeName);
  const tip      = commitFile(worktree, `${worktreeName}.ts`, `export const ${worktreeName.replaceAll('-', '')} = true;\n`);
  return {
    identifier,
    worktree,
    branch: `worktree/${worktreeName}`,
    tip,
  };
}

function releaseDocumentOf(outcome: CommandOutcome): ReleaseDocument {
  return JSON.parse(outcome.output) as ReleaseDocument;
}

beforeEach(async () => {
  if (!gitIsAvailable()) return;
  repositoryDirectory = createScratchGitRepository('release');
  gitIn(repositoryDirectory, ['checkout', '-q', '-B', 'main']);
  await agentProgressOrFail(['init', '--project', 'Example Agency', '--no-claude-md', '--no-hooks']);
  gitIn(repositoryDirectory, ['add', '--all']);
  gitIn(repositoryDirectory, ['commit', '-q', '-m', 'Ignore the tracker']);
});

afterEach(() => {
  removeScratchDirectory(`${repositoryDirectory}-worktrees`);
  removeScratchDirectory(repositoryDirectory);
});

describe.skipIf(!gitIsAvailable())('a release that holds', () => {
  test('a descendant branch is fast-forwarded, the ticket ends delivered with branch and commit, and the worktree and branch are gone', async () => {
    const {
      identifier,
      worktree,
      branch,
      tip,
    } = await reviewedTicketOnAWorktree('Show the role history', 'role-history');

    const outcome = await agentProgress(['release', identifier, '--branch', branch, '--worktree', worktree, '--json']);

    expect(outcome.exitCode, outcome.error).toBe(0);
    expect(releaseDocumentOf(outcome)).toMatchObject({
      released: true,
      commit:   tip,
      cleanup:  [{ target: 'worktree', outcome: 'removed' }, { target: 'branch', outcome: 'deleted' }],
    });
    expect(mainTip()).toBe(tip);
    expect(await readTicketDocument(identifier)).toMatchObject({ status: 'delivered', branch, commit: tip });
    expect(existsSync(worktree)).toBe(false);
    expect(branchExists(branch)).toBe(false);
  });

  test('a ticket still in progress is released too, through done to delivered', async () => {
    const added = JSON.parse(await agentProgressOrFail(['ticket', 'add', 'Rename a role', '--json'])) as { id: string };
    await agentProgressOrFail(['ticket', 'start', added.id]);
    const worktree = addWorktree(repositoryDirectory, 'rename-role');
    const tip      = commitFile(worktree, 'rename.ts', 'export const renamed = true;\n');

    const outcome = await agentProgress(['release', added.id, '--branch', 'worktree/rename-role', '--worktree', worktree]);

    expect(outcome.exitCode, outcome.error).toBe(0);
    expect(outcome.output).toContain(`main fast-forwarded to ${tip.slice(0, 8)}`);
    expect(await readTicketDocument(added.id)).toMatchObject({ status: 'delivered', commit: tip });
  });

  // A bundle's tickets share one branch, so one fast-forward delivers them all; a second release per ticket would find the branch gone.
  test('several ids release every ticket of a bundle with the one fast-forward', async () => {
    const {
      identifier,
      worktree,
      branch,
      tip,
    } = await reviewedTicketOnAWorktree('Show the role history', 'role-history');
    const bundled = JSON.parse(await agentProgressOrFail(['ticket', 'add', 'Sort the role history', '--json'])) as { id: string };
    await agentProgressOrFail(['ticket', 'start', bundled.id]);

    const outcome = await agentProgress(['release', identifier, bundled.id, '--branch', branch, '--worktree', worktree]);

    expect(outcome.exitCode, outcome.error).toBe(0);
    expect(outcome.output).toContain(`Released tickets #${identifier}, #${bundled.id}`);
    expect(await readTicketDocument(identifier)).toMatchObject({ status: 'delivered', commit: tip });
    expect(await readTicketDocument(bundled.id)).toMatchObject({ status: 'delivered', commit: tip, branch });
  });

  test('a bundle with one ticket that is not releasable releases none of them', async () => {
    const { identifier, worktree, branch } = await reviewedTicketOnAWorktree('Show the role history', 'role-history');
    const notStarted = JSON.parse(await agentProgressOrFail(['ticket', 'add', 'Not started', '--json'])) as { id: string };
    const mainBefore = mainTip();

    const outcome = await agentProgress(['release', identifier, notStarted.id, '--branch', branch, '--worktree', worktree]);

    expect(outcome.exitCode).toBe(1);
    expect(mainTip()).toBe(mainBefore);
    expect(await readTicketDocument(identifier)).toMatchObject({ status: 'in-review' });
  });

  // A reviewer works from inside its own worktree, and the tracker and main checkout have to be found from there.
  test('run from inside the linked worktree it releases, it fast-forwards the main checkout and removes that worktree', async () => {
    const {
      identifier,
      worktree,
      branch,
      tip,
    } = await reviewedTicketOnAWorktree('Export the chart', 'export-chart');

    const outcome = await agentProgress(['release', identifier, '--branch', branch, '--worktree', '.'], worktree);

    expect(outcome.exitCode, outcome.error).toBe(0);
    expect(mainTip()).toBe(tip);
    expect(existsSync(worktree)).toBe(false);
    expect(await readTicketDocument(identifier)).toMatchObject({ status: 'delivered' });
  });

  // The release happened, so the exit code must say so; what git would not clean up is named for a person to deal with.
  test('a worktree holding an untracked file is left standing at exit 0, and the output names the file', async () => {
    const {
      identifier,
      worktree,
      branch,
      tip,
    } = await reviewedTicketOnAWorktree('Filter by team', 'filter-team');
    writeFileSync(join(worktree, 'scratch-notes.txt'), 'not committed\n');

    const outcome = await agentProgress(['release', identifier, '--branch', branch, '--worktree', worktree]);

    expect(outcome.exitCode, outcome.error).toBe(0);
    expect(mainTip()).toBe(tip);
    expect(await readTicketDocument(identifier)).toMatchObject({ status: 'delivered', commit: tip });
    expect(existsSync(worktree)).toBe(true);
    expect(outcome.output).toContain(`The worktree ${worktree} is still there`);
    expect(outcome.output).toContain('untracked: scratch-notes.txt');
    expect(outcome.output).toContain(`The branch ${branch} is still there`);
  });

  test('under --json the untracked file is listed on the worktree step', async () => {
    const { identifier, worktree, branch } = await reviewedTicketOnAWorktree('Filter by team', 'filter-team');
    writeFileSync(join(worktree, 'scratch-notes.txt'), 'not committed\n');

    const outcome = await agentProgress(['release', identifier, '--branch', branch, '--worktree', worktree, '--json']);

    expect(releaseDocumentOf(outcome).cleanup[0]).toMatchObject({ target: 'worktree', outcome: 'left', untrackedFiles: ['scratch-notes.txt'] });
  });
});

describe.skipIf(!gitIsAvailable())('a release that is refused changes nothing', () => {
  async function expectNothingChanged(identifier: string, worktree: string, action: () => Promise<CommandOutcome>): Promise<CommandOutcome> {
    const mainBefore     = mainTip();
    const ticketBefore   = ticketFileText(identifier);
    const progressBefore = readFileSync(join(repositoryDirectory, '.agent-progress', 'progress.json'), 'utf8');

    const outcome = await action();

    expect(outcome.exitCode).toBe(1);
    expect(mainTip()).toBe(mainBefore);
    expect(ticketFileText(identifier)).toBe(ticketBefore);
    expect(readFileSync(join(repositoryDirectory, '.agent-progress', 'progress.json'), 'utf8')).toBe(progressBefore);
    expect(existsSync(worktree)).toBe(true);
    return outcome;
  }

  // The refusal a reviewer is told to act on by rebasing, so its reason word is the contract.
  test('a branch that does not descend from main exits 1 with reason main-moved', async () => {
    const { identifier, worktree, branch } = await reviewedTicketOnAWorktree('Show the role history', 'role-history');
    commitFile(repositoryDirectory, 'main-moves.ts', 'export const mainMoved = true;\n');

    const outcome = await expectNothingChanged(identifier, worktree, () => agentProgress(['release', identifier, '--branch', branch, '--worktree', worktree, '--json']));

    expect(releaseDocumentOf(outcome)).toMatchObject({ released: false, reason: 'main-moved', cleanup: [] });
    expect(outcome.error).toContain(`Rebase ${branch} onto main`);
    expect(branchExists(branch)).toBe(true);
  });

  test('a main checkout on another branch exits 1', async () => {
    const { identifier, worktree, branch } = await reviewedTicketOnAWorktree('Show the role history', 'role-history');
    gitIn(repositoryDirectory, ['checkout', '-q', '-b', 'side-line']);

    const outcome = await expectNothingChanged(identifier, worktree, () => agentProgress(['release', identifier, '--branch', branch, '--worktree', worktree, '--json']));

    expect(releaseDocumentOf(outcome).reason).toBe('not-on-main-line');
    expect(gitIn(repositoryDirectory, ['symbolic-ref', '--short', 'HEAD'])).toBe('side-line');
  });

  test('a ticket that is still open exits 1 before git is asked anything', async () => {
    const added    = JSON.parse(await agentProgressOrFail(['ticket', 'add', 'Not started', '--json'])) as { id: string };
    const worktree = addWorktree(repositoryDirectory, 'not-started');
    commitFile(worktree, 'early.ts', 'export const early = true;\n');

    const outcome = await expectNothingChanged(added.id, worktree, () => agentProgress(['release', added.id, '--branch', 'worktree/not-started', '--json']));

    expect(releaseDocumentOf(outcome).reason).toBe('ticket-not-releasable');
  });

  test('a branch that does not exist exits 1 with reason unknown-branch', async () => {
    const { identifier, worktree } = await reviewedTicketOnAWorktree('Show the role history', 'role-history');

    const outcome = await expectNothingChanged(identifier, worktree, () => agentProgress(['release', identifier, '--branch', 'no-such-branch', '--json']));

    expect(releaseDocumentOf(outcome).reason).toBe('unknown-branch');
  });
});

describe.skipIf(!gitIsAvailable())('two releases at once', () => {
  // The lock is what serialises them: the second must see the main line the first one moved, never merge over it.
  test('two branches off the same main never both merge: one fast-forwards and the other is refused with main-moved', async () => {
    const first  = await reviewedTicketOnAWorktree('Show the role history', 'role-history');
    const second = await reviewedTicketOnAWorktree('Export the chart', 'export-chart');
    const mainBefore = mainTip();

    const outcomes = await Promise.all([
      agentProgress(['release', first.identifier, '--branch', first.branch, '--worktree', first.worktree, '--json']),
      agentProgress(['release', second.identifier, '--branch', second.branch, '--worktree', second.worktree, '--json']),
    ]);

    expect(outcomes.map(({ exitCode }) => exitCode).sort()).toEqual([0, 1]);
    const refused = outcomes.find(({ exitCode }) => exitCode === 1);
    expect(refused === undefined ? undefined : releaseDocumentOf(refused).reason).toBe('main-moved');
    expect([first.tip, second.tip]).toContain(mainTip());
    expect(gitIn(repositoryDirectory, ['rev-list', '--count', `${mainBefore}..main`])).toBe('1');
  });

  test('a branch built on top of another\'s released tip fast-forwards on top of it', async () => {
    const first = await reviewedTicketOnAWorktree('Show the role history', 'role-history');
    const added = JSON.parse(await agentProgressOrFail(['ticket', 'add', 'Build on it', '--json'])) as { id: string };
    await agentProgressOrFail(['ticket', 'start', added.id]);
    gitIn(first.worktree, ['branch', 'stacked', first.branch]);
    const stackedWorktree = join(`${repositoryDirectory}-worktrees`, 'stacked');
    gitIn(repositoryDirectory, ['worktree', 'add', '-q', stackedWorktree, 'stacked']);
    const stackedTip = commitFile(stackedWorktree, 'stacked.ts', 'export const stacked = true;\n');

    const [firstOutcome, stackedOutcome] = await Promise.all([
      agentProgress(['release', first.identifier, '--branch', first.branch, '--worktree', first.worktree, '--json']),
      agentProgress(['release', added.id, '--branch', 'stacked', '--worktree', stackedWorktree, '--json']),
    ]);

    // In either order main ends on the stacked tip; the first branch is fast-forwarded before it or, released after it, refused as main-moved.
    expect(stackedOutcome.exitCode, stackedOutcome.error).toBe(0);
    expect(mainTip()).toBe(stackedTip);
    if (firstOutcome.exitCode !== 0) expect(releaseDocumentOf(firstOutcome).reason).toBe('main-moved');
  });
});
