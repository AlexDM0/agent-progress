/**
 * A holder killed between progress.json and the ticket files, across real processes: a child holding the lock is SIGKILLed right after its
 * progress file lands, and the next holder, a CLI verb in another child, finishes that write from the journal before making its own. A
 * malformed journal stops every write at exit 2 and leaves the files alone.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join }                                    from 'node:path';

import {
  afterEach,
  beforeEach,
  expect,
  test,
} from 'bun:test';

import type { HoldJournalReading }                 from '../src/adapters/hold-journal/HoldJournalIngestion.ts';
import { holdJournalFilePathOf, readHoldJournal }  from '../src/services/tracker/HoldJournal.ts';
import { workspacePathsFor, type Workspace }       from '../src/services/tracker/Workspace.ts';
import { CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS } from '../src/testing/ChildProcessCaseTimeout.ts';
import { removeScratchDirectory }                  from '../src/testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent }                from '../src/testing/ToolGuard.ts';
import { runCommandLine }                          from './Main.ts';
import { createCapturedCommandContext }            from './testing/CapturedCommandContext.ts';
import { runAgentProgress }                        from './testing/CliProcess.ts';
import { createInitializedScratchRepository }      from './testing/InitializedScratchRepository.ts';

const FROZEN_NOW = new Date('2026-09-18T20:11:03Z');

const SOURCE_FOLDER = join(import.meta.dir, '..', 'src');

let repositoryDirectory = '';
let workspace: Workspace;

/** A holder that commits its journal, writes progress.json and is SIGKILLed before the ticket file, as a crash or a closed laptop would. */
function killedHolderSource(): string {
  return `
    const { writeTracker } = await import(${JSON.stringify(join(SOURCE_FOLDER, 'services', 'tracker', 'TrackerPipeline.ts'))});
    const { createRenderState } = await import(${JSON.stringify(join(SOURCE_FOLDER, 'services', 'render', 'RenderState.ts'))});
    const { workspacePathsFor } = await import(${JSON.stringify(join(SOURCE_FOLDER, 'services', 'tracker', 'Workspace.ts'))});
    const workspace = workspacePathsFor(${JSON.stringify(repositoryDirectory)});
    const at = '2026-09-18T22:12:00+02:00';
    await writeTracker({
      workspace, at, now: () => new Date(), renderState: createRenderState(),
      mutate: (change) => {
        change.board.addTask({ name: 'Example row of the killed holder', startsNow: false, movesTheLink: false }, at);
        change.board.setTicketPriority('001', 'high', at);
      },
      afterFileWritten: (filePath) => { if (filePath === workspace.progressFilePath) process.kill(process.pid, 'SIGKILL'); },
    });
  `;
}

function ticketFilePath(): string {
  return join(workspace.ticketsDirectory, '001-example-checkout-page.md');
}

function journaledContentsOf(journal: HoldJournalReading, filePath: string): string {
  const file = journal.verdict === 'readable' ? journal.files.find((candidate) => candidate.filePath === filePath) : undefined;
  if (file?.kind !== 'written') throw new Error(`the journal holds no contents for ${filePath}`);
  return file.contents;
}

beforeEach(async () => {
  repositoryDirectory = await createInitializedScratchRepository('hold-journal-crash', ['--project', 'Example Agency'], () => FROZEN_NOW);
  workspace = workspacePathsFor(repositoryDirectory);
  const context = createCapturedCommandContext({ currentDirectory: repositoryDirectory, now: () => FROZEN_NOW });
  const exitCode = await runCommandLine(['ticket', 'add', '--type', 'ticket', 'Example checkout page'], context);
  expect(exitCode, context.errorText()).toBe(0);
});

afterEach(() => {
  removeScratchDirectory(repositoryDirectory);
});

describeWhenGitIsPresent('a holder killed between progress.json and the ticket files', () => {
  test('the next holder, a CLI verb in another child, finishes the write before its own', async () => {
    const ticketBefore = readFileSync(ticketFilePath(), 'utf8');

    const holder = Bun.spawn([process.execPath, '-e', killedHolderSource()], { cwd: repositoryDirectory, stdout: 'ignore', stderr: 'pipe' });
    await holder.exited;
    expect(holder.signalCode, await new Response(holder.stderr).text()).toBe('SIGKILL');

    const journal = readHoldJournal(workspace);
    expect(readFileSync(workspace.progressFilePath, 'utf8')).toContain('Example row of the killed holder');
    expect(readFileSync(ticketFilePath(), 'utf8'), 'the board is torn: the ticket was not written').toBe(ticketBefore);

    const result = await runAgentProgress(['log', 'Example note after the crash'], { currentDirectory: repositoryDirectory });

    expect(result.exitCode, result.standardError).toBe(0);
    expect(readFileSync(ticketFilePath(), 'utf8')).toBe(journaledContentsOf(journal, ticketFilePath()));
    const logText = readFileSync(workspace.logFilePath, 'utf8');
    expect(logText.startsWith(journaledContentsOf(journal, workspace.logFilePath)), 'the killed holder\'s log comes first').toBe(true);
    expect(logText.trimEnd().split('\n').at(-1)).toContain('Example note after the crash');
    expect(existsSync(holdJournalFilePathOf(workspace))).toBe(false);
  }, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);

  test('a malformed journal stops the next write at exit 2, and the files stay as they are', async () => {
    writeFileSync(holdJournalFilePathOf(workspace), '{"version":1,"files":[{"path":"/etc/example","contents":""}]}\n');
    const logBefore = readFileSync(workspace.logFilePath, 'utf8');

    const result = await runAgentProgress(['log', 'Example note'], { currentDirectory: repositoryDirectory });

    expect(result.exitCode).toBe(2);
    expect(result.standardError).toContain(holdJournalFilePathOf(workspace));
    expect(readFileSync(workspace.logFilePath, 'utf8')).toBe(logBefore);
  }, CHILD_PROCESS_CASE_TIMEOUT_MILLISECONDS);
});
