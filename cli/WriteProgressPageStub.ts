import { createProgressPageStubWriter } from '../src/adapters/progress-page/ProgressPageStubWriter.ts';
import { runnerFilesIn }                from '../src/services/runner/RunnerFiles.ts';
import { RunnerLease }                  from '../src/services/runner/RunnerLease.ts';
import type { Workspace }               from '../src/services/tracker/Workspace.ts';

/** For `init` and `update`: the stub names the live lease's URL, or says the Overseer is down. */
export function writeProgressPageStub(workspace: Workspace): void {
  const newest = RunnerLease.newestLeaseOf(runnerFilesIn(workspace.trackerDirectory).runnerDirectory);
  createProgressPageStubWriter(workspace.htmlFilePath).write(newest.verdict === 'live' ? newest.record.url : null);
}
