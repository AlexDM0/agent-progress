/**
 * `ticket review|rereview --start-review`: the move to review and the review bar in one lock hold, so the ticket's slot passes from its builder to
 * its reviewer, and from one round to the next, without a moment at which `status --json` shows it free. The race with a claim for that slot is
 * the case the option exists for; the plain `ticket review` beside it shows the gap it closes.
 */
import { readFileSync } from 'node:fs';
import { join }         from 'node:path';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test
}                                                                             from 'bun:test';
import { LOCK_RETRY_INTERVAL_MILLISECONDS }                                   from '../../lib/constants/Limits';
import type { ProgressFile, Task }                                            from '../../lib/constants/Types';
import { withLock }                                                           from '../../lib/platform/Lock';
import { workspacePathsFor }                                                  from '../../lib/platform/Workspace';
import { createCapturedCommandContext }                                       from '../../lib/tooling/dev/CapturedCommandContext';
import { createScratchGitRepository, gitIsAvailable, removeScratchDirectory } from '../../lib/tooling/dev/ScratchWorkspace';
import { runCommandLine }                                                     from '../Main';

const FROZEN_NOW = new Date('2026-09-24T12:00:00Z');

const LOCK_HELD_WHILE_COMMANDS_QUEUE_MILLISECONDS = LOCK_RETRY_INTERVAL_MILLISECONDS * 4;

const REVIEWED_TICKET_TITLE = 'Double-click a role to edit it';

let repositoryDirectory = '';

function contextHere(): ReturnType<typeof createCapturedCommandContext> {
  return createCapturedCommandContext({ currentDirectory: repositoryDirectory, now: () => FROZEN_NOW });
}

async function runWithExitCode(commandLineArguments: readonly string[]): Promise<{ exitCode: number; context: ReturnType<typeof createCapturedCommandContext> }> {
  const context  = contextHere();
  const exitCode = await runCommandLine(commandLineArguments, context);
  return { exitCode, context };
}

async function run(commandLineArguments: readonly string[]): Promise<ReturnType<typeof createCapturedCommandContext>> {
  const { context, exitCode } = await runWithExitCode(commandLineArguments);
  expect(exitCode, `\`agent-progress ${commandLineArguments.join(' ')}\` failed: ${context.errorText()}`).toBe(0);
  return context;
}

function storedProgress(): ProgressFile {
  return JSON.parse(readFileSync(join(repositoryDirectory, '.agent-progress', 'progress.json'), 'utf8')) as ProgressFile;
}

function runningBarsReviewing(ticketId: string): Task[] {
  return storedProgress().tasks.filter((task) => task.status === 'running' && task.reviewOf === ticketId);
}

async function agentsInFlightNow(): Promise<number> {
  const document = JSON.parse((await run(['status', '--json'])).outputText()) as { concurrency: { agentsInFlight: number } };
  return document.concurrency.agentsInFlight;
}

beforeEach(async () => {
  repositoryDirectory = createScratchGitRepository('ticket-start-review');
  await run(['init', '--project', 'Example Agency']);
  await run(['ticket', 'add', REVIEWED_TICKET_TITLE]);
  await run(['ticket', 'add', 'Show the role history']);
  await run(['concurrency', '1']);
  await run(['ticket', 'claim', '1', '--owner', 'opus']);
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
});

describe.skipIf(!gitIsAvailable())('starting the review bar with the move to review', () => {
  test('ticket review --start-review puts the ticket in review beside a running bar that reviews it, and the agents in flight stay as many', async () => {
    const agentsBefore = await agentsInFlightNow();

    const output = (await run(['ticket', 'review', '1', '--start-review', '--owner', 'opus', '--note', 'Reviewed by the dispatcher'])).outputText();

    const bars = runningBarsReviewing('001');
    expect(bars).toHaveLength(1);
    expect(bars[0]?.name).toBe(`Review 1 #001 — ${REVIEWED_TICKET_TITLE}`);
    expect(bars[0]?.owner).toBe('opus');
    expect(bars[0]?.note).toBe('Reviewed by the dispatcher');
    expect(JSON.parse((await run(['ticket', 'show', '1', '--json'])).outputText())).toMatchObject({ status: 'in-review' });
    expect(await agentsInFlightNow()).toBe(agentsBefore);
    expect(output).toContain(`Review row #${bars[0]?.id} started`);
  });

  // The gap the option closes: between a plain move to review and the reviewer's own `task add --start`, the board shows the slot free.
  test('a plain ticket review frees the slot, so a claim before the reviewer adds its bar takes it and the board runs one over', async () => {
    await run(['ticket', 'review', '1']);
    await run(['ticket', 'claim', '2']);
    await run(['task', 'add', `Review 1 #001 — ${REVIEWED_TICKET_TITLE}`, '--review-of', '1', '--start']);

    expect(await agentsInFlightNow()).toBe(2);
  });

  // Whichever of the two the lock lets in first, the claim meets a full board: the slot never shows free between them.
  test('a claim racing the move to review for the ticket\'s slot is refused, and one agent stays in flight', async () => {
    let queuedCommands: Promise<{ exitCode: number }>[] = [];

    await withLock(workspacePathsFor(repositoryDirectory), async () => {
      queuedCommands = [
        runWithExitCode(['ticket', 'review', '1', '--start-review']),
        runWithExitCode(['ticket', 'claim', '2']),
      ];
      await Bun.sleep(LOCK_HELD_WHILE_COMMANDS_QUEUE_MILLISECONDS);
    }, () => new Date());

    const [reviewOutcome, claimOutcome] = await Promise.all(queuedCommands);
    expect(reviewOutcome?.exitCode).toBe(0);
    expect(claimOutcome?.exitCode).toBe(1);
    expect(await agentsInFlightNow()).toBe(1);
    expect(runningBarsReviewing('001')).toHaveLength(1);
  });

  test('ticket rereview --start-review closes the round\'s running bar and starts the next, numbered from the ticket\'s review sections', async () => {
    await run(['ticket', 'review', '1', '--start-review']);
    const [firstBar] = runningBarsReviewing('001');
    const ticketFilePath = JSON.parse((await run(['ticket', 'show', '1', '--json'])).outputText()) as { filePath: string };
    const ticketText     = readFileSync(ticketFilePath.filePath, 'utf8');
    await Bun.write(ticketFilePath.filePath, `${ticketText}\n## Review\nRound 1 reworked 900 lines.\n`);
    const agentsBefore = await agentsInFlightNow();

    await run(['ticket', 'rereview', '1', '--start-review', '--owner', 'opus']);

    const bars = runningBarsReviewing('001');
    expect(bars).toHaveLength(1);
    expect(bars[0]?.name).toBe(`Review 2 #001 — ${REVIEWED_TICKET_TITLE}`);
    expect(storedProgress().tasks.find((task) => task.id === firstBar?.id)?.status).toBe('delivered');
    expect(await agentsInFlightNow()).toBe(agentsBefore);
  });

  // A single-ticket dispatcher run launched late would otherwise claim the in-review ticket its whole-board twin is reviewing, and rebuild it.
  test('a claim of a ticket whose review bar runs is refused, and one after the bar is closed takes it for the rebuild', async () => {
    await run(['ticket', 'review', '1', '--start-review']);
    await run(['concurrency', '2']);
    const [bar] = runningBarsReviewing('001');

    const refused = await runWithExitCode(['ticket', 'claim', '1']);
    expect(refused.exitCode).toBe(1);
    expect(refused.context.errorText()).toContain(`Ticket #001 is under review: its review row #${bar?.id} is running`);
    expect(JSON.parse((await run(['ticket', 'show', '1', '--json'])).outputText())).toMatchObject({ status: 'in-review' });

    await run(['task', 'finish', String(bar?.id)]);
    await run(['task', 'deliver', String(bar?.id)]);
    await run(['ticket', 'claim', '1']);
    expect(JSON.parse((await run(['ticket', 'show', '1', '--json'])).outputText())).toMatchObject({ status: 'in-progress' });
  });

  // Only `release` used to close the bar, so a ticket abandoned, reopened or finished by hand kept its reviewer's slot taken and refused its own claim.
  test('every move out of review closes the ticket\'s running bar with one log line, freeing its slot', async () => {
    const movesOutOfReview: string[][] = [
      ['ticket', 'abandon', '1', '--reason', 'superseded by #2'],
      ['ticket', 'reopen', '1'],
      ['ticket', 'start', '1'],
      ['ticket', 'done', '1'],
      ['ticket', 'status', '1', 'open'],
    ];
    for (const moveOutOfReview of movesOutOfReview) {
      await run(['ticket', 'status', '1', 'in-review']);
      await run(['ticket', 'rereview', '1', '--start-review']);
      const [bar] = runningBarsReviewing('001');

      const output = (await run(moveOutOfReview)).outputText();

      expect(runningBarsReviewing('001'), moveOutOfReview.join(' ')).toHaveLength(0);
      expect(storedProgress().tasks.find((task) => task.id === bar?.id)?.status).toBe('delivered');
      expect(output).toContain(`Closed the review row #${bar?.id}, delivered`);
      expect(storedProgress().log.filter((entry) => entry.text.startsWith(`Closed the review row #${bar?.id}`))).toHaveLength(1);
    }
  });

  test('at a limit of 1, a claim after abandoning a ticket whose review bar ran takes the freed slot', async () => {
    await run(['ticket', 'review', '1', '--start-review']);
    await run(['ticket', 'abandon', '1', '--reason', 'superseded by #2']);

    expect(await agentsInFlightNow()).toBe(0);
    await run(['ticket', 'claim', '2']);
  });

  test('a reopened ticket whose review bar ran can be claimed again', async () => {
    await run(['ticket', 'review', '1', '--start-review']);
    await run(['ticket', 'reopen', '1']);

    await run(['ticket', 'claim', '1']);
  });

  // A bundle is one agent: its first ticket's reviewer shares the slot the builder still holds for the rest.
  test('a bundle\'s review bar shares the claim\'s slot while the bundle\'s other rows still run, so the agents in flight stay one', async () => {
    await run(['ticket', 'reopen', '1']);
    await run(['ticket', 'claim', '1', '2']);
    expect(await agentsInFlightNow()).toBe(1);

    await run(['ticket', 'review', '1', '--start-review']);
    expect(await agentsInFlightNow()).toBe(1);
    expect(runningBarsReviewing('001')[0]?.agent).toBe('001,002');

    await run(['ticket', 'review', '2', '--start-review']);
    expect(await agentsInFlightNow()).toBe(1);
  });

  test('--owner or --note without --start-review is refused, and nothing moves', async () => {
    const { exitCode, context } = await runWithExitCode(['ticket', 'review', '1', '--owner', 'opus']);

    expect(exitCode).toBe(1);
    expect(context.errorText()).toContain('only with --start-review');
    expect(JSON.parse((await run(['ticket', 'show', '1', '--json'])).outputText())).toMatchObject({ status: 'in-progress' });
  });
});
