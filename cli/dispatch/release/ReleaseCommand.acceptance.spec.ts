/**
 * `agent-progress release` holding each ticket's latest Review to its numbered Acceptance. The cases that matter: an Acceptance with no
 * numbered item, an item the Review does not account for and a waiver only the Review makes are each refused with the items named, main and
 * the tracker left as they were; a waiver the Acceptance itself marks releases; every ticket of a bundle is judged on its own; and with a
 * check command stored the refusal comes before the command runs.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join }                                    from 'node:path';

import {
  afterEach,
  beforeEach,
  expect,
  test
}                                             from 'bun:test';
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
import { createInitializedScratchRepository } from '../../testing/InitializedScratchRepository.ts';
import { storedLogTextOf }                    from '../../testing/StoredLogText.ts';

interface CommandOutcome {
  exitCode: number;
  output:   string;
}

interface ReleaseDocument {
  released: boolean;
  reason?:  string;
  detail?:  string;
}

interface ReviewedWork {
  identifier: string;
  worktree:   string;
  branch:     string;
  tip:        string;
}

const FROZEN_NOW = new Date('2026-10-06T09:00:00Z');

const ACCEPTANCE_OF_THREE = '## Acceptance\n\nA1. The export names Alex Example.\nA2. The header says Example Agency.\nA3. The footer carries the page count.\n';

let repositoryDirectory = '';

function mainTip(): string {
  return gitOutputIn(repositoryDirectory, ['rev-parse', 'refs/heads/main']);
}

function progressText(): string {
  return readFileSync(join(repositoryDirectory, '.agent-progress', 'progress.json'), 'utf8');
}

async function agentProgress(commandLineArguments: readonly string[]): Promise<CommandOutcome> {
  const context  = createCapturedCommandContext({ currentDirectory: repositoryDirectory, now: () => FROZEN_NOW });
  const exitCode = await runCommandLine(commandLineArguments, context);
  return { exitCode, output: context.outputText() };
}

async function agentProgressOrFail(commandLineArguments: readonly string[]): Promise<string> {
  const { exitCode, output } = await agentProgress(commandLineArguments);
  if (exitCode !== 0) throw new Error(`agent-progress ${commandLineArguments.join(' ')} exited ${exitCode}: ${output}`);
  return output;
}

function ticketFilePath(identifier: string): string {
  const ticketsDirectory = join(repositoryDirectory, '.agent-progress', 'tickets');
  return join(ticketsDirectory, [...new Bun.Glob(`${identifier}-*.md`).scanSync(ticketsDirectory)][0] ?? '');
}

/** Swaps one passage of the ticket's body by hand, as the orchestrator edits an Acceptance between runs. */
function editTicketBody(identifier: string, passage: string, replacement: string): void {
  const filePath = ticketFilePath(identifier);
  writeFileSync(filePath, readFileSync(filePath, 'utf8').replace(passage, replacement));
}

async function startedTicket(title: string, body: string): Promise<string> {
  const added = JSON.parse(await agentProgressOrFail(['ticket', 'add', title, '--body', body, '--json'])) as { id: string };
  await agentProgressOrFail(['ticket', 'start', added.id]);
  return added.id;
}

async function reviewedTicketOnAWorktree(body: string): Promise<ReviewedWork> {
  const identifier = await startedTicket('Export the role history', body);
  await agentProgressOrFail(['ticket', 'finish', identifier, '--start-review', '--owner', 'opus']);
  const worktree = addWorktree(repositoryDirectory, 'role-history');
  const tip      = commitFile(worktree, 'role-history.ts', 'export const roleHistory = true;\n');
  return {
    identifier, worktree, branch: 'worktree/role-history', tip
  };
}

function releaseArgumentsFor(work: ReviewedWork, identifiers: readonly string[] = [work.identifier]): string[] {
  return ['release', ...identifiers, '--branch', work.branch, '--worktree', work.worktree, '--json'];
}

async function expectRefusedChangingNothing(releaseArguments: readonly string[], reason: string): Promise<string> {
  const mainBefore     = mainTip();
  const progressBefore = progressText();
  const logBefore      = storedLogTextOf(repositoryDirectory);

  const outcome = await agentProgress(releaseArguments);

  expect(outcome.exitCode, outcome.output).toBe(1);
  const document = JSON.parse(outcome.output) as ReleaseDocument;
  expect(document).toMatchObject({ released: false, reason });
  expect(mainTip()).toBe(mainBefore);
  expect(progressText()).toBe(progressBefore);
  expect(storedLogTextOf(repositoryDirectory)).toBe(logBefore);
  return document.detail ?? '';
}

beforeEach(async () => {
  if (!gitIsAvailable()) return;
  repositoryDirectory = await createInitializedScratchRepository('release-acceptance', ['--project', 'Example Agency', '--no-claude-md', '--no-hooks'], () => FROZEN_NOW);
  gitOutputIn(repositoryDirectory, ['checkout', '-q', '-B', 'main']);
  gitOutputIn(repositoryDirectory, ['add', '--all']);
  gitOutputIn(repositoryDirectory, [...SCRATCH_COMMIT_IDENTITY_ARGUMENTS, 'commit', '-q', '-m', 'Ignore the tracker']);
});

afterEach(() => {
  removeScratchDirectory(`${repositoryDirectory}-worktrees`);
  removeScratchDirectory(repositoryDirectory);
});

describeWhenGitIsPresent('a release reading the Acceptance against the latest Review', () => {
  test('an Acceptance with no numbered item is refused acceptance-unnumbered', async () => {
    const work = await reviewedTicketOnAWorktree('## Acceptance\n\nThe export works.\n\n## Review\n\nIt holds.\n');

    const detail = await expectRefusedChangingNothing(releaseArgumentsFor(work), 'acceptance-unnumbered');

    expect(detail).toContain(`#${work.identifier}`);
  });

  test('a Review accounting for A1 and A2 of three is refused acceptance-unaccounted, naming A3', async () => {
    const work = await reviewedTicketOnAWorktree(`${ACCEPTANCE_OF_THREE}\n## Review\n\nA1 holds — probe\nA2 holds — probe\n`);

    const detail = await expectRefusedChangingNothing(releaseArgumentsFor(work), 'acceptance-unaccounted');

    expect(detail).toContain('A3');
    expect(detail).not.toContain('A1');
  });

  test('a waiver only the Review makes is refused acceptance-waived with its reason, and releases once the Acceptance marks it', async () => {
    const work = await reviewedTicketOnAWorktree(`${ACCEPTANCE_OF_THREE}\n## Review\n\nA1 holds — probe\nA2 holds — probe\nA3 waived — the footer moved\n`);

    const detail = await expectRefusedChangingNothing(releaseArgumentsFor(work), 'acceptance-waived');
    expect(detail).toContain('A3 (the footer moved)');

    editTicketBody(work.identifier, 'A3. The footer carries the page count.', 'A3. Waived: the footer moved');
    const outcome = await agentProgress(releaseArgumentsFor(work));

    expect(outcome.exitCode, outcome.output).toBe(0);
    expect(mainTip()).toBe(work.tip);
  });

  test('every ticket of a bundle is judged on its own, and the one falling short is named', async () => {
    const work      = await reviewedTicketOnAWorktree(`${ACCEPTANCE_OF_THREE}\n## Review\n\nA1 holds\nA2 holds\nA3 holds\n`);
    const shortfall = await startedTicket('Sort the role history', `${ACCEPTANCE_OF_THREE}\n## Review\n\nA1 holds\nA3 holds\n`);

    const detail = await expectRefusedChangingNothing(releaseArgumentsFor(work, [work.identifier, shortfall]), 'acceptance-unaccounted');

    expect(detail).toContain(`#${shortfall}`);
    expect(detail).toContain('A2');
  });

  test('every item holding releases', async () => {
    const work = await reviewedTicketOnAWorktree(ACCOUNTED_TICKET_BODY_ARGUMENTS[1]);

    const outcome = await agentProgress(releaseArgumentsFor(work));

    expect(outcome.exitCode, outcome.output).toBe(0);
    expect(mainTip()).toBe(work.tip);
  });

  test('with a check command stored, the refusal comes before the command runs', async () => {
    const progressFilePath = join(repositoryDirectory, '.agent-progress', 'progress.json');
    writeFileSync(progressFilePath, `${JSON.stringify({ ...(JSON.parse(progressText()) as Record<string, unknown>), checkCommand: 'touch ../checked' }, null, 2)}\n`);
    const work = await reviewedTicketOnAWorktree(`${ACCEPTANCE_OF_THREE}\n## Review\n\nA1 holds\n`);

    await expectRefusedChangingNothing(releaseArgumentsFor(work), 'acceptance-unaccounted');

    expect(existsSync(join(`${repositoryDirectory}-worktrees`, 'checked'))).toBe(false);
  });
});
