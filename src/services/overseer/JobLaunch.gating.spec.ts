/**
 * Which gate step a gating job waits on, read outside the lock. What matters: a review that left the tree it was given (the tree the build's
 * gates passed) runs no gate at all; and a review that changed the tree, and any build, waits on the pipeline's first step.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join }                     from 'node:path';

import { afterEach, expect } from 'bun:test';
import type { Job }          from '../../lib/tracker-model/@types/Job.ts';
import type { Pipeline }     from '../../lib/tracker-model/@types/Pipeline.ts';
import { PRODUCT_NAMES }     from '../../shared/constants/ProductNames.ts';
import {
  commitFile,
  createScratchGitRepository,
  gitOutputIn,
  removeScratchDirectory
} from '../../testing/ScratchWorkspace.ts';
import { testWhenGitIsPresent }             from '../../testing/ToolGuard.ts';
import { JobLaunch, type JobLaunchContext } from './JobLaunch.ts';
import { WatcherFleet }                     from './WatcherFleet.ts';

const PIPELINE: Pipeline = { prepare: [], gates: [{ name: 'tests', run: 'true' }, { name: 'lint', run: 'true' }] };

const repositories: string[] = [];

afterEach(() => {
  for (const repository of repositories.splice(0)) removeScratchDirectory(repository);
});

interface GatingScene {
  context:  JobLaunchContext;
  worktree: string;
  jobOf:    (kind: 'build' | 'review') => Job;
}

/** A ticket worktree whose job started on its current HEAD, as `recordJobStart` writes it. */
function gatingScene(): GatingScene {
  const repository = createScratchGitRepository('job-gating');
  repositories.push(repository);
  const worktree = join(repository, PRODUCT_NAMES.WORKTREES_FOLDER, 'ticket-001');
  gitOutputIn(repository, ['worktree', 'add', '-q', '-b', 'ticket-001', worktree]);
  const trackerDirectory = join(repository, '.example-tracker');
  const jobFolder = WatcherFleet.jobFolderOf(trackerDirectory, 'J2');
  mkdirSync(jobFolder, { recursive: true });
  writeFileSync(join(jobFolder, 'start.json'), JSON.stringify({ startCommit: gitOutputIn(worktree, ['rev-parse', 'HEAD']) }));
  const context = { workspace: { rootDirectory: repository, trackerDirectory }, agentAdapter: { eventsOf: () => [] } } as unknown as JobLaunchContext;
  const jobOf = (kind: 'build' | 'review'): Job => ({
    id: 'J2', kind, state: 'gating', ticketIds: ['001'], watcherInstance: 1
  }) as unknown as Job;
  return { context, worktree, jobOf };
}

function gateOf(scene: GatingScene, kind: 'build' | 'review'): unknown {
  return JobLaunch.observeBuildJobs(scene.context, [scene.jobOf(kind)], PIPELINE)[0]?.gate;
}

testWhenGitIsPresent('a review that left the tree it was given runs no gate and is judged passed', () => {
  const scene = gatingScene();

  expect(gateOf(scene, 'review')).toMatchObject({
    verdict: 'judged', outcome: 'passed', step: null, ran: false
  });
});

testWhenGitIsPresent('a review that changed the tree waits on the first gate', () => {
  const scene = gatingScene();
  commitFile(scene.worktree, 'review-fix.ts', 'export const fixed = true;\n');

  expect(gateOf(scene, 'review')).toMatchObject({ verdict: 'running', stepIndex: 0 });
});

testWhenGitIsPresent('a build always waits on the first gate, even on the tree it started from', () => {
  expect(gateOf(gatingScene(), 'build')).toMatchObject({ verdict: 'running', stepIndex: 0 });
});
