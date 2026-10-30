/**
 * `merges` lists the merge queue read-only. What matters: a held slot is listed with its phase and tips and leaves the queue, the queued
 * tickets follow in priority then queue order, and the read leaves the progress file byte-identical.
 */
import { readFileSync } from 'node:fs';

import {
  afterEach,
  beforeEach,
  expect,
  test
}                                             from 'bun:test';
import { writeTracker }                       from '../../src/services/tracker/TrackerPipeline.ts';
import { workspacePathsFor }                  from '../../src/services/tracker/Workspace.ts';
import { removeScratchDirectory }             from '../../src/testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent }           from '../../src/testing/ToolGuard.ts';
import { runCommandLine }                     from '../Main.ts';
import { createCapturedCommandContext }       from '../testing/CapturedCommandContext.ts';
import { createInitializedScratchRepository } from '../testing/InitializedScratchRepository.ts';
import { fileReadyTicket }                    from '../testing/ReadyTicketFiling.ts';

const FROZEN_NOW = new Date('2026-10-28T09:00:00Z');
const QUEUED_AT  = '2026-10-28T10:00:00+01:00';
const TARGET_TIP = 'a'.repeat(40);
const BRANCH_TIP = 'b'.repeat(40);

let repositoryDirectory = '';

async function run(commandLineArguments: readonly string[]): Promise<ReturnType<typeof createCapturedCommandContext>> {
  const context  = createCapturedCommandContext({ currentDirectory: repositoryDirectory, now: () => FROZEN_NOW });
  const exitCode = await runCommandLine(commandLineArguments, context);
  expect(exitCode, `\`agent-progress ${commandLineArguments.join(' ')}\` failed: ${context.errorText()}`).toBe(0);
  return context;
}

beforeEach(async () => {
  repositoryDirectory = await createInitializedScratchRepository('merges-command', ['--project', 'Example Agency'], () => FROZEN_NOW);
  for (const [title, priority] of [['Example cart', 'normal'], ['Example checkout', 'high'], ['Example invoice', 'low']] as const) {
    await fileReadyTicket(run, ['ticket', 'add', title, '--type', 'ticket', '--priority', priority]);
  }
  await writeTracker({
    workspace: workspacePathsFor(repositoryDirectory),
    at:        QUEUED_AT,
    now:       () => FROZEN_NOW,
    mutate:    (change) => {
      // The low ticket queues first, so only the priority order lists the normal one before it.
      for (const ticketId of ['003', '001', '002']) {
        change.board.moveTicket(ticketId, 'in-review', { checksLegality: false }, change.at);
        change.board.queueTicketForMerge(ticketId, 'main', change.at);
      }
      change.board.claimMergeSlot({
        ticketId: '002', target: 'main', targetTip: TARGET_TIP, branchTip: BRANCH_TIP, predictedConflictFiles: [],
      }, () => 'main', change.at);
    },
  });
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
});

describeWhenGitIsPresent('the merges command', () => {
  test('lists the held slot, then the queued tickets in priority order, and the read leaves the progress file byte-identical', async () => {
    const { progressFilePath } = workspacePathsFor(repositoryDirectory);
    const before = readFileSync(progressFilePath, 'utf8');

    const report = JSON.parse((await run(['merges', '--json'])).outputText()) as { slots: unknown[]; queue: { ticketId: string; priority: string }[] };

    expect(report.slots).toEqual([{
      target: 'main', jobId: expect.any(String), ticketIds: ['002'], phase: 'merge-in', targetTip: TARGET_TIP, branchTip: BRANCH_TIP,
    }]);
    expect(report.queue.map((queued) => [queued.ticketId, queued.priority])).toEqual([['001', 'normal'], ['003', 'low']]);
    expect((await run(['merges'])).outputText()).toContain('main: job ');
    expect(readFileSync(progressFilePath, 'utf8')).toBe(before);
  });
});
