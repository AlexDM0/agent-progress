/**
 * `agent-progress release` with a check command stored in the tracker. The cases that matter: with none stored the release is the one it
 * always was; the command runs in the branch's worktree on exactly the tip it fast-forwards to, through the user's shell, and is the
 * tracker's, never the branch's; and every refusal — a worktree not at the tip or holding other files, a failing command, a command that
 * changed tracked files, a branch that moved while it ran — changes nothing: main, the ticket, the review row and the log stay as they were.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
}                from 'node:fs';
import { join } from 'node:path';

import {
  afterEach,
  beforeEach,
  expect,
  test
}                                             from 'bun:test';
import { PRODUCT_NAMES }              from '../../../src/shared/constants/ProductNames.ts';
import {
  addWorktree,
  commitFile,
  gitIsAvailable,
  gitOutputIn,
  removeScratchDirectory,
  SCRATCH_COMMIT_IDENTITY_ARGUMENTS
}                                             from '../../../src/testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent }           from '../../../src/testing/ToolGuard.ts';
import { runCommandLine }                     from '../../Main.ts';
import { ACCOUNTED_TICKET_BODY_ARGUMENTS }    from '../../testing/AccountedTicketBody.ts';
import { createCapturedCommandContext }       from '../../testing/CapturedCommandContext.ts';
import { runAgentProgress }                   from '../../testing/CliProcess.ts';
import { createInitializedScratchRepository } from '../../testing/InitializedScratchRepository.ts';
import { fileReadyTicketThrough }             from '../../testing/ReadyTicketFiling.ts';
import { storedLogTextOf }                    from '../../testing/StoredLogText.ts';

interface CommandOutcome {
  exitCode: number;
  output:   string;
  error:    string;
}

interface ReleaseDocument {
  released:      boolean;
  reason?:       string;
  detail?:       string;
  checkCommand?: string | null;
}

interface ReviewedWork {
  identifier: string;
  worktree:   string;
  branch:     string;
  tip:        string;
}

const FROZEN_NOW = new Date('2026-10-06T09:00:00Z');

/** Written beside the worktrees, outside every checkout, so the check that writes it leaves its worktree clean. */
const MARKER_COMMAND = 'git rev-parse HEAD > ../checked-at';

const OUTPUT_LINE_COUNT = 30;

let repositoryDirectory = '';

function mainTip(): string {
  return gitOutputIn(repositoryDirectory, ['rev-parse', 'refs/heads/main']);
}

function markerPath(): string {
  return join(`${repositoryDirectory}-worktrees`, 'checked-at');
}

function progressText(): string {
  return readFileSync(join(repositoryDirectory, PRODUCT_NAMES.DATA_FOLDER, 'progress.json'), 'utf8');
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

async function readyTicketOrFail(addArguments: readonly string[]): Promise<string> {
  return await fileReadyTicketThrough(agentProgressOrFail, (output) => output, addArguments);
}

/**
 * Written straight into progress.json, since `checks` would first try the line in the main checkout, and most lines here fail or change
 * something on purpose. Stored before a ticket starts, so its row is stamped with it.
 */
function storeCheckCommand(checkCommand: string): void {
  const progressFilePath = join(repositoryDirectory, PRODUCT_NAMES.DATA_FOLDER, 'progress.json');
  writeFileSync(progressFilePath, `${JSON.stringify({ ...(JSON.parse(progressText()) as Record<string, unknown>), checkCommand }, null, 2)}\n`);
}

/** A ticket in review whose work is one commit on a fresh linked worktree, with its review bar running as a reviewer leaves it. */
async function reviewedTicketOnAWorktree(worktreeName: string): Promise<ReviewedWork> {
  const added = JSON.parse(await readyTicketOrFail([
    'ticket', 'add', '--type', 'ticket', 'Show the role history', ...ACCOUNTED_TICKET_BODY_ARGUMENTS, '--json',
  ])) as { id: string };
  await agentProgressOrFail(['ticket', 'start', added.id]);
  await agentProgressOrFail(['ticket', 'finish', added.id, '--start-review', '--owner', 'opus']);
  const worktree = addWorktree(repositoryDirectory, worktreeName);
  const tip      = commitFile(worktree, `${worktreeName}.ts`, 'export const roleHistory = true;\n');
  return {
    identifier: added.id,
    worktree,
    branch:     `worktree/${worktreeName}`,
    tip,
  };
}

function releaseArgumentsFor(work: ReviewedWork): string[] {
  return ['release', work.identifier, '--branch', work.branch, '--worktree', work.worktree, '--json'];
}

function documentOf(outcome: CommandOutcome): ReleaseDocument {
  return JSON.parse(outcome.output) as ReleaseDocument;
}

/** Runs the release and holds that it was refused at exit 1 with `reason`, leaving main, the tracker's files and the worktree as they were. */
async function expectRefusedChangingNothing(work: ReviewedWork, reason: string, releaseArguments = releaseArgumentsFor(work)): Promise<ReleaseDocument> {
  const mainBefore     = mainTip();
  const progressBefore = progressText();
  const logBefore      = storedLogTextOf(repositoryDirectory);

  const outcome = await agentProgress(releaseArguments);

  expect(outcome.exitCode, outcome.output).toBe(1);
  const document = documentOf(outcome);
  expect(document).toMatchObject({ released: false, reason });
  expect(mainTip()).toBe(mainBefore);
  expect(progressText()).toBe(progressBefore);
  expect(storedLogTextOf(repositoryDirectory)).toBe(logBefore);
  expect(existsSync(work.worktree)).toBe(true);
  expect(gitOutputIn(repositoryDirectory, ['rev-parse', '--verify', `refs/heads/${work.branch}`]).length).toBeGreaterThan(0);
  return document;
}

beforeEach(async () => {
  if (!gitIsAvailable()) return;
  repositoryDirectory = await createInitializedScratchRepository('release-checks', ['--project', 'Example Agency', '--no-claude-md', '--no-hooks'], () => FROZEN_NOW);
  gitOutputIn(repositoryDirectory, ['checkout', '-q', '-B', 'main']);
  gitOutputIn(repositoryDirectory, ['add', '--all']);
  gitOutputIn(repositoryDirectory, [...SCRATCH_COMMIT_IDENTITY_ARGUMENTS, 'commit', '-q', '-m', 'Ignore the tracker']);
});

afterEach(() => {
  removeScratchDirectory(`${repositoryDirectory}-worktrees`);
  removeScratchDirectory(repositoryDirectory);
});

describeWhenGitIsPresent('a release with no check command stored', () => {
  test('releases without --worktree as it always did, runs nothing, and prints a null checkCommand', async () => {
    const work = await reviewedTicketOnAWorktree('role-history');

    const outcome = await agentProgress(['release', work.identifier, '--branch', work.branch, '--json']);

    expect(outcome.exitCode, outcome.output).toBe(0);
    expect(documentOf(outcome)).toMatchObject({ released: true, checkCommand: null });
    expect(mainTip()).toBe(work.tip);
    expect(outcome.error).toBe('');
  });
});

describeWhenGitIsPresent('a release with a check command stored', () => {
  test('a passing command runs in the worktree on the tip, and the release then fast-forwards to that tip', async () => {
    storeCheckCommand(MARKER_COMMAND);
    const work = await reviewedTicketOnAWorktree('role-history');

    const outcome = await agentProgress(releaseArgumentsFor(work));

    expect(outcome.exitCode, outcome.output).toBe(0);
    expect(documentOf(outcome)).toMatchObject({ released: true, checkCommand: MARKER_COMMAND });
    expect(readFileSync(markerPath(), 'utf8').trim()).toBe(work.tip);
    expect(mainTip()).toBe(work.tip);
  });

  test('the human output says the checks are running on standard error and that they passed', async () => {
    storeCheckCommand(MARKER_COMMAND);
    const work = await reviewedTicketOnAWorktree('role-history');

    const outcome = await agentProgress(releaseArgumentsFor(work).filter((argument) => argument !== '--json'));

    expect(outcome.exitCode, outcome.error).toBe(0);
    expect(outcome.error).toContain(`Running the checks on ${work.branch}`);
    expect(outcome.output).toContain(`The check command passed on it first: ${MARKER_COMMAND}`);
  });

  // The reviewer acts on the detail alone, so it has to carry the end of the output, standard error included and in order.
  test('a failing command is refused checks-failed with its last 20 lines as the detail, and changes nothing', async () => {
    storeCheckCommand(`for i in $(seq 1 ${OUTPUT_LINE_COUNT}); do echo "check line $i"; done; echo "example failure" >&2; exit 3`);
    const work = await reviewedTicketOnAWorktree('role-history');

    const document = await expectRefusedChangingNothing(work, 'checks-failed');

    const detail = document.detail ?? '';
    expect(detail).toContain('exited 3');
    expect(detail).toContain(`check line ${OUTPUT_LINE_COUNT}\nexample failure`);
    expect(detail).toContain('check line 12\n');
    expect(detail).not.toContain('check line 11\n');
    expect(JSON.parse(await agentProgressOrFail(['ticket', 'show', work.identifier, '--json']))).toMatchObject({ status: 'in-review' });
  });

  test('with no --worktree it is refused invalid-request before anything runs', async () => {
    storeCheckCommand(MARKER_COMMAND);
    const work = await reviewedTicketOnAWorktree('role-history');

    const document = await expectRefusedChangingNothing(work, 'invalid-request', ['release', work.identifier, '--branch', work.branch, '--json']);

    expect(document.detail).toContain('--worktree');
    expect(existsSync(markerPath())).toBe(false);
  });

  test('a ticket that is not releasable is refused before the command runs', async () => {
    storeCheckCommand(MARKER_COMMAND);
    const work = await reviewedTicketOnAWorktree('role-history');
    const pending = JSON.parse(await readyTicketOrFail(['ticket', 'add', '--type', 'ticket', 'Not started', '--json'])) as { id: string };

    await expectRefusedChangingNothing(work, 'ticket-not-releasable', ['release', pending.id, '--branch', work.branch, '--worktree', work.worktree, '--json']);

    expect(existsSync(markerPath())).toBe(false);
  });

  test('a worktree whose HEAD is not the branch tip is refused worktree-not-at-tip before the command runs', async () => {
    storeCheckCommand(MARKER_COMMAND);
    const work = await reviewedTicketOnAWorktree('role-history');
    gitOutputIn(work.worktree, ['checkout', '-q', '--detach', 'HEAD~1']);

    await expectRefusedChangingNothing(work, 'worktree-not-at-tip');

    expect(existsSync(markerPath())).toBe(false);
  });

  test.each([
    ['an untracked file', (worktree: string): void => writeFileSync(join(worktree, 'probe.ts'), 'export const probe = true;\n'), 'untracked: probe.ts'],
    ['a changed tracked file', (worktree: string): void => writeFileSync(join(worktree, 'role-history.ts'), 'export const changed = true;\n'), 'changed: role-history.ts'],
  ])('a worktree holding %s is refused worktree-dirty, naming it, before the command runs', async (_case, dirty, named) => {
    storeCheckCommand(MARKER_COMMAND);
    const work = await reviewedTicketOnAWorktree('role-history');
    dirty(work.worktree);

    const document = await expectRefusedChangingNothing(work, 'worktree-dirty');

    expect(document.detail).toContain(named);
    expect(existsSync(markerPath())).toBe(false);
  });

  test('a file the worktree ignores does not count against it', async () => {
    storeCheckCommand(MARKER_COMMAND);
    const work = await reviewedTicketOnAWorktree('role-history');
    mkdirSync(join(work.worktree, PRODUCT_NAMES.DATA_FOLDER));
    writeFileSync(join(work.worktree, PRODUCT_NAMES.DATA_FOLDER, 'scratch.txt'), 'ignored\n');

    const outcome = await agentProgress(releaseArgumentsFor(work));

    expect(outcome.exitCode, outcome.output).toBe(0);
  });

  // What passed would then be the changed files, not the commit main is fast-forwarded to.
  test('a command that changes a tracked file is refused worktree-dirty even though it exited 0', async () => {
    storeCheckCommand('echo "export const rewritten = true;" > role-history.ts');
    const work = await reviewedTicketOnAWorktree('role-history');

    const document = await expectRefusedChangingNothing(work, 'worktree-dirty');

    expect(document.detail).toContain('The checks changed tracked files');
  });

  test('a command that moves the worktree off the tip is refused worktree-not-at-tip even though it exited 0', async () => {
    storeCheckCommand('git checkout -q --detach HEAD~1');
    const work = await reviewedTicketOnAWorktree('role-history');

    const document = await expectRefusedChangingNothing(work, 'worktree-not-at-tip');

    expect(document.detail).toContain(`The checks moved the worktree ${work.worktree} from ${work.tip.slice(0, 8)}`);
  });

  // The worktree stands detached at the tip, so only the branch moves: the lock is the last place that can see it.
  test('a branch that moves while the command runs is refused branch-moved inside the lock', async () => {
    const identity = SCRATCH_COMMIT_IDENTITY_ARGUMENTS.map((argument) => `'${argument}'`).join(' ');
    storeCheckCommand(`git update-ref refs/heads/worktree/role-history "$(git ${identity} commit-tree 'HEAD^{tree}' -p HEAD -m moved)"`);
    const work     = await reviewedTicketOnAWorktree('role-history');
    gitOutputIn(work.worktree, ['checkout', '-q', '--detach', work.tip]);

    const document = await expectRefusedChangingNothing(work, 'branch-moved');

    expect(document.detail).toContain(`${work.branch} moved from ${work.tip.slice(0, 8)}`);
  });

  test('a check command changed while the command runs is refused check-command-changed inside the lock', async () => {
    const progressFilePath = join(repositoryDirectory, PRODUCT_NAMES.DATA_FOLDER, 'progress.json');
    const rewriteScript    = `const path = ${JSON.stringify(progressFilePath)}; const document = JSON.parse(await Bun.file(path).text()); `
      + 'document.checkCommand = "true"; await Bun.write(path, JSON.stringify(document, null, 2));';
    storeCheckCommand(`bun -e '${rewriteScript}'`);
    const work      = await reviewedTicketOnAWorktree('role-history');
    const mainBefore = mainTip();

    const outcome = await agentProgress(releaseArgumentsFor(work));

    expect(outcome.exitCode, outcome.output).toBe(1);
    expect(documentOf(outcome)).toMatchObject({ released: false, reason: 'check-command-changed' });
    expect(mainTip()).toBe(mainBefore);
    expect(JSON.parse(await agentProgressOrFail(['ticket', 'show', work.identifier, '--json']))).toMatchObject({ status: 'in-review' });
  });

  // The incident this guards against: a branch that brings its own copy of the gate judges itself.
  test('the command run is the tracker\'s, never one the branch carries, wherever the release runs from', async () => {
    storeCheckCommand('echo "the tracker command ran"; exit 4');
    const work = await reviewedTicketOnAWorktree('role-history');
    const branchTracker = JSON.parse(progressText()) as Record<string, unknown>;
    mkdirSync(join(work.worktree, PRODUCT_NAMES.DATA_FOLDER));
    writeFileSync(join(work.worktree, PRODUCT_NAMES.DATA_FOLDER, 'progress.json'), JSON.stringify({ ...branchTracker, checkCommand: 'true' }, null, 2));
    gitOutputIn(work.worktree, ['add', '--force', `${PRODUCT_NAMES.DATA_FOLDER}/progress.json`]);
    gitOutputIn(work.worktree, [...SCRATCH_COMMIT_IDENTITY_ARGUMENTS, 'commit', '-q', '-m', 'Bring a passing check command']);
    const tippedWork = { ...work, tip: gitOutputIn(work.worktree, ['rev-parse', 'HEAD']) };

    const fromTheMainCheckout = await expectRefusedChangingNothing(tippedWork, 'checks-failed');
    expect(fromTheMainCheckout.detail).toContain('the tracker command ran');

    const mainBefore = mainTip();
    const fromTheWorktree = await agentProgress(['release', work.identifier, '--branch', work.branch, '--worktree', '.', '--json'], work.worktree);
    expect(fromTheWorktree.exitCode).not.toBe(0);
    expect(mainTip()).toBe(mainBefore);
  });
});

describeWhenGitIsPresent('the shell a check command runs in', () => {
  function fakeShellIn(directory: string): string {
    const shellPath = join(directory, 'example-shell');
    writeFileSync(shellPath, '#!/bin/sh\necho "example shell ran: $2"\nexit 5\n');
    chmodSync(shellPath, 0o755);
    return shellPath;
  }

  test('is the user\'s SHELL, handed the stored line after -c', async () => {
    storeCheckCommand(MARKER_COMMAND);
    const work = await reviewedTicketOnAWorktree('role-history');

    const result = await runAgentProgress(releaseArgumentsFor(work), {
      currentDirectory: repositoryDirectory,
      environment:      { SHELL: fakeShellIn(`${repositoryDirectory}-worktrees`) },
    });

    expect(result.exitCode, result.standardError).toBe(1);
    expect(JSON.parse(result.standardOutput)).toMatchObject({ reason: 'checks-failed' });
    expect((JSON.parse(result.standardOutput) as ReleaseDocument).detail).toContain(`example shell ran: ${MARKER_COMMAND}`);
  });

  test('is /bin/sh when SHELL is unset', async () => {
    storeCheckCommand('echo "ran by $0"; exit 6');
    const work = await reviewedTicketOnAWorktree('role-history');

    const result = await runAgentProgress(releaseArgumentsFor(work), { currentDirectory: repositoryDirectory, environment: {} });

    expect(result.exitCode, result.standardError).toBe(1);
    expect((JSON.parse(result.standardOutput) as ReleaseDocument).detail).toContain('ran by /bin/sh');
  });
});

describeWhenGitIsPresent('a ticket stamped with the check command it started under', () => {
  test('is refused check-command-differs-from-start once the stored line differs, and released after a restamp', async () => {
    storeCheckCommand('false');
    const work = await reviewedTicketOnAWorktree('role-history');
    storeCheckCommand(MARKER_COMMAND);

    const document = await expectRefusedChangingNothing(work, 'check-command-differs-from-start');

    expect(document.detail).toContain('`false`');
    expect(document.detail).toContain(`\`${MARKER_COMMAND}\``);
    expect(document.detail).toContain(`${PRODUCT_NAMES.PROGRAM} checks "${MARKER_COMMAND}" --restamp`);
    expect((document.detail ?? '').split('Nothing was changed.').length - 1, 'said once').toBe(1);
    expect(existsSync(markerPath()), 'refused before the command runs').toBe(false);

    // Tried in the main checkout first, so the line must pass there and write nothing beside it.
    await agentProgressOrFail(['checks', 'git rev-parse HEAD', '--restamp']);

    const outcome = await agentProgress(releaseArgumentsFor(work));
    expect(outcome.exitCode, outcome.output).toBe(0);
    expect(mainTip()).toBe(work.tip);
  });

  test('a ticket started with none stored is refused once a line is stored, and one started under a line once it is cleared', async () => {
    const unstamped = await reviewedTicketOnAWorktree('role-history');
    storeCheckCommand(MARKER_COMMAND);
    expect((await expectRefusedChangingNothing(unstamped, 'check-command-differs-from-start')).detail).toContain('under the check command none');

    const stamped = await reviewedTicketOnAWorktree('role-audit');
    const progressWithoutTheLine = JSON.parse(progressText()) as Record<string, unknown>;
    delete progressWithoutTheLine['checkCommand'];
    writeFileSync(join(repositoryDirectory, PRODUCT_NAMES.DATA_FOLDER, 'progress.json'), `${JSON.stringify(progressWithoutTheLine, null, 2)}\n`);
    const cleared = await expectRefusedChangingNothing(stamped, 'check-command-differs-from-start');
    expect(cleared.detail).toContain(`${PRODUCT_NAMES.PROGRAM} checks --clear --restamp`);
  });

  test('one ticket of a release whose stamp differs refuses the whole release', async () => {
    storeCheckCommand('true');
    const matching = await reviewedTicketOnAWorktree('role-history');
    storeCheckCommand('bun test');
    const differing = JSON.parse(await readyTicketOrFail([
      'ticket', 'add', '--type', 'ticket', 'Show the role audit', ...ACCOUNTED_TICKET_BODY_ARGUMENTS, '--json',
    ])) as { id: string };
    await agentProgressOrFail(['ticket', 'start', differing.id]);
    await agentProgressOrFail(['ticket', 'finish', differing.id]);
    storeCheckCommand('true');

    const document = await expectRefusedChangingNothing(
      matching,
      'check-command-differs-from-start',
      ['release', matching.identifier, differing.id, '--branch', matching.branch, '--worktree', matching.worktree, '--json'],
    );
    expect(document.detail).toContain(`Ticket #${differing.id}`);
  });
});
