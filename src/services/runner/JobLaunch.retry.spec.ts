/**
 * V3 on a build retry, verified through the hold. What matters: a second attempt whose branch already holds the failed first attempt's
 * commit is measured from that attempt's start, the ticket's fork point, so it passes to the gates; a branch with no commit since its fork
 * point still fails V3 `no-commit-since-start` (sent back with a red handoff), so a retry never passes on nothing.
 */
import { readFileSync } from 'node:fs';
import { join }         from 'node:path';
import {
  afterEach,
  describe,
  expect,
  test
} from 'bun:test';

import type { Job }                    from '../../lib/tracker-model/@types/Job.ts';
import type { Board }                  from '../../lib/tracker-model/Board.ts';
import { PRODUCT_NAMES }               from '../../shared/constants/ProductNames.ts';
import { boardFixture, ticketFixture } from '../../testing/BoardFixtures.ts';
import {
  commitFile,
  createScratchDirectory,
  createScratchGitRepository,
  gitOutputIn,
  removeScratchDirectory
} from '../../testing/ScratchWorkspace.ts';
import type { TrackerChange }               from '../tracker/TrackerPipeline.ts';
import { HostFleet }                        from './HostFleet.ts';
import { JobLaunch, type JobLaunchContext } from './JobLaunch.ts';
import { RedHandoff }                       from './RedHandoff.ts';

const AT = '2026-10-30T10:00:00+01:00';

const folders: string[] = [];

afterEach(() => {
  for (const folder of folders.splice(0)) removeScratchDirectory(folder);
});

interface RetryScene {
  board:         Board;
  context:       JobLaunchContext;
  worktree:      string;
  /** Launches a build attempt on ticket 001 and records its start as the runner does when its host is first spawned. */
  launchAttempt: (attempt: number) => Readonly<Job>;
  /** Hands the attempt's built report to the hold, which verifies it. */
  reportBuilt:   (job: Readonly<Job>) => void;
}

function retryScene(): RetryScene {
  const rootDirectory = createScratchGitRepository('retry-root');
  const trackerParent = createScratchDirectory('retry-tracker');
  const trackerDirectory = join(trackerParent, PRODUCT_NAMES.DATA_FOLDER);
  folders.push(rootDirectory, trackerParent);
  const worktree = join(rootDirectory, PRODUCT_NAMES.WORKTREES_FOLDER, 'ticket-001');
  gitOutputIn(rootDirectory, ['worktree', 'add', '-q', '-b', 'ticket-001', worktree]);
  const { board } = boardFixture({ tickets: [ticketFixture({ id: '001', status: 'in-progress', task: 1 })] });
  const context = {
    workspace: { rootDirectory, trackerDirectory }, mainLine: 'main', groupTargetPrefix: 'group-', log: () => undefined
  } as unknown as JobLaunchContext;
  const change = { board, at: AT } as unknown as TrackerChange;
  const launchAttempt = (attempt: number): Readonly<Job> => {
    const { job } = board.launchJob({
      kind: 'build', role: 'builder', ticketIds: ['001'], parentJobId: null, attempt, target: 'main'
    }, AT);
    JobLaunch.recordJobStart(context, board, job);
    return job;
  };
  const reportBuilt = (job: Readonly<Job>): void => {
    for (const state of ['preparing', 'running', 'verifying'] as const) board.moveJob(job.id, state, AT);
    const report = {
      role:              'builder',
      outcome:           'built',
      headCommit:        gitOutputIn(worktree, ['rev-parse', 'HEAD']),
      acceptance:        [{ item: 'A1', state: 'met', evidence: 'ExamplePage.spec.ts' }],
      alsoFixed:         [],
      gates:             [],
      handoff:           'Example handoff.',
      blockedReason:     null,
      cannotBuildReason: null,
    };
    JobLaunch.applyBuildJobObservations(change, context, [{
      jobId: job.id, setup: 'installed', calls: 1, report, agentEnd: null, gate: { verdict: 'pending' }
    }]);
  };
  return {
    board, context, worktree, launchAttempt, reportBuilt
  };
}

function jobById(board: Board, jobId: string): Readonly<Job> | undefined {
  return board.jobs().find((job) => job.id === jobId);
}

/** A refused V3 sends the session back with a red handoff naming the check, its reason in the handover; `null` when nothing went red. */
function customsRefusalOf(scene: RetryScene, job: Readonly<Job>): string | null {
  const facts = RedHandoff.redHandoffFactsOf(HostFleet.jobFolderOf(scene.context.workspace.trackerDirectory, job.id));
  if (facts === null) return null;
  const handover = readFileSync(facts.handoverPath, 'utf8');
  return `${facts.name}: ${handover.includes('no-commit-since-start') ? 'no-commit-since-start' : 'another reason'}`;
}

describe('a build retry under V3', () => {
  test('passes to the gates when its branch already holds the failed first attempt\'s commit and it adds none', () => {
    const scene = retryScene();
    const firstAttempt = scene.launchAttempt(1);
    commitFile(scene.worktree, 'example-page.txt', 'Example page\n');
    scene.board.endJob(firstAttempt.id, { outcome: 'failed', cause: 'foreign-ref-moved' }, AT);

    const secondAttempt = scene.launchAttempt(2);
    scene.reportBuilt(secondAttempt);

    expect(customsRefusalOf(scene, secondAttempt)).toBeNull();
    expect(jobById(scene.board, secondAttempt.id)?.state).toBe('gating');
  });

  test('still fails V3 no-commit-since-start when the branch holds no commit since its fork point', () => {
    const scene = retryScene();
    const firstAttempt = scene.launchAttempt(1);
    scene.board.endJob(firstAttempt.id, { outcome: 'failed', cause: 'foreign-ref-moved' }, AT);

    const secondAttempt = scene.launchAttempt(2);
    scene.reportBuilt(secondAttempt);

    expect(customsRefusalOf(scene, secondAttempt)).toBe('V3: no-commit-since-start');
    expect(jobById(scene.board, secondAttempt.id)).toMatchObject({ state: 'interrupted', interruption: 'handoff-red' });
  });
});
