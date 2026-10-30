/**
 * `job attach` following a job to its end. What matters: an entry the Watcher writes after attach's last print, with the job leaving the
 * board before the next poll, is still printed before the command returns, and every entry prints exactly once. The entry is written and
 * the job removed from inside the output callback, so the race against the poll is decided by the code, never by a clock.
 */
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { join }                          from 'node:path';
import { afterEach, beforeEach, expect } from 'bun:test';

import type { Job }                                       from '../../src/lib/tracker-model/@types/Job.ts';
import { WatcherFleet }                                   from '../../src/services/overseer/WatcherFleet.ts';
import { requireWorkspace }                               from '../../src/services/tracker/Workspace.ts';
import { removeScratchDirectory }                         from '../../src/testing/ScratchWorkspace.ts';
import { describeWhenGitIsPresent, testWhenGitIsPresent } from '../../src/testing/ToolGuard.ts';
import { runCommandLine }                                 from '../Main.ts';
import { createCapturedCommandContext }                   from '../testing/CapturedCommandContext.ts';
import { createInitializedScratchRepository }             from '../testing/InitializedScratchRepository.ts';

const SPEC_CLOCK = (): Date => new Date('2026-09-18T20:11:03Z');

const JOB_ID = 'J3';

const FIRST_LINE = '[1.1] > client: Example first message';
const LAST_LINE  = '[1.2] > client: Example message written after the last poll';

function productOwnerJob(): Job {
  return {
    id:                 JOB_ID,
    kind:               'product-owner',
    role:               'product-owner',
    ticketIds:          [],
    parentJobId:        null,
    attempt:            1,
    target:             null,
    state:              'running',
    watcherInstance:    1,
    eventCursor:        { instance: 1, sequence: 0 },
    answeredRequestIds: [],
    crashResumes:       0,
  };
}

function eventLineOf(sequence: number, line: string): string {
  return `${JSON.stringify({ sequence, origin: 'client', line })}\n`;
}

describeWhenGitIsPresent('job attach following a job to its end', () => {
  let repositoryDirectory = '';
  let progressFilePath    = '';
  let eventLogPath        = '';

  function writeBoardJobs(jobs: readonly Job[]): void {
    const progress = JSON.parse(readFileSync(progressFilePath, 'utf8')) as Record<string, unknown>;
    writeFileSync(progressFilePath, `${JSON.stringify({ ...progress, jobs }, null, 2)}\n`);
  }

  beforeEach(async () => {
    repositoryDirectory = await createInitializedScratchRepository('job-attach', ['--project', 'Example Agency', '--no-hooks'], SPEC_CLOCK);
    const { trackerDirectory } = requireWorkspace(repositoryDirectory);
    progressFilePath = join(trackerDirectory, 'progress.json');
    const jobFolder  = WatcherFleet.jobFolderOf(trackerDirectory, JOB_ID);
    mkdirSync(jobFolder, { recursive: true });
    eventLogPath = join(jobFolder, 'events-1.ndjson');
    writeFileSync(eventLogPath, eventLineOf(1, 'Example first message'));
    writeBoardJobs([productOwnerJob()]);
  });

  afterEach(() => {
    removeScratchDirectory(repositoryDirectory);
  });

  testWhenGitIsPresent('prints the entry written after its last print once the job has left the board, each entry exactly once', async () => {
    const captured = createCapturedCommandContext({ currentDirectory: repositoryDirectory, now: SPEC_CLOCK });
    const context = {
      ...captured,
      standardOutput: (text: string) => {
        captured.standardOutput(text);
        if (text !== FIRST_LINE) return;
        appendFileSync(eventLogPath, eventLineOf(2, 'Example message written after the last poll'));
        writeBoardJobs([]);
      },
    };
    const exitCode = await runCommandLine(['job', 'attach', JOB_ID], context);
    expect({ exitCode, error: captured.errorText() }).toEqual({ exitCode: 0, error: '' });
    expect(captured.outputText().split('\n').filter((line) => line !== '')).toEqual([FIRST_LINE, LAST_LINE]);
  });

  testWhenGitIsPresent('--json replays the log without following', async () => {
    appendFileSync(eventLogPath, eventLineOf(2, 'Example message written after the last poll'));
    const captured = createCapturedCommandContext({ currentDirectory: repositoryDirectory, now: SPEC_CLOCK });
    const exitCode = await runCommandLine(['job', 'attach', JOB_ID, '--json'], captured);
    expect(exitCode).toBe(0);
    expect(JSON.parse(captured.outputText())).toEqual({ jobId: JOB_ID, lines: [FIRST_LINE, LAST_LINE] });
  });
});
