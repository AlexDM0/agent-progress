/**
 * A session resumed after a red handoff, in the hold. What matters: its calls are bounded by the resume budget and the wind-down grace, and
 * past them it is stopped and, once its session ended, counted red again (interrupted `handoff-red`, the next resume of its cycle) rather
 * than opening `out-of-calls`; within the grace it keeps running, so a report there goes through Customs and the gates as usual.
 */
import {
  afterEach,
  describe,
  expect,
  test
} from 'bun:test';

import type { Board }                                                 from '../../lib/tracker-model/Board.ts';
import { RED_HANDOFF_RESUME_CALL_BUDGET, WIND_DOWN_GRACE_CALLS }      from '../../shared/constants/OverseerLimits.ts';
import { boardFixture, ticketFixture }                                from '../../testing/BoardFixtures.ts';
import { createScratchDirectory, removeScratchDirectory }             from '../../testing/ScratchWorkspace.ts';
import type { TrackerChange }                                         from '../tracker/TrackerPipeline.ts';
import { type BuildJobObservation, JobLaunch, type JobLaunchContext } from './JobLaunch.ts';
import { RedHandoff }                                                 from './RedHandoff.ts';
import { WatcherFleet }                                               from './WatcherFleet.ts';

const AT = '2026-10-30T10:00:00+01:00';

const folders: string[] = [];

afterEach(() => {
  for (const folder of folders.splice(0)) removeScratchDirectory(folder);
});

interface ResumedScene {
  board:   Board;
  context: JobLaunchContext;
  observe: (overrides: Partial<BuildJobObservation>) => void;
}

/** A build job whose first handoff went red and whose session was resumed once, now running in its second Watcher instance. */
function resumedScene(): ResumedScene {
  const rootDirectory = createScratchDirectory('red-resumed');
  folders.push(rootDirectory);
  const trackerDirectory = `${rootDirectory}/.example-tracker`;
  const { board } = boardFixture({ tickets: [ticketFixture({ id: '001', status: 'in-progress', task: 1 })] });
  const { job } = board.launchJob({
    kind: 'build', role: 'builder', ticketIds: ['001'], parentJobId: null, attempt: 1, target: 'main'
  }, AT);
  for (const state of ['preparing', 'running', 'in-customs'] as const) board.moveJob(job.id, state, AT);
  board.interruptJob(job.id, 'handoff-red', AT);
  board.moveJob(job.id, 'running', AT);
  const jobFolder = WatcherFleet.jobFolderOf(trackerDirectory, job.id);
  RedHandoff.writeRedHandoff(jobFolder, {
    kind:                'gate',
    name:                'tests',
    command:             'bun test',
    fixCommand:          null,
    commit:              'example-commit',
    exitCode:            1,
    batonPassPath:       RedHandoff.batonPassPathOf(jobFolder),
    fullLogPath:         null,
    resume:              1,
    resumesAllowed:      2,
    callBudget:          RED_HANDOFF_RESUME_CALL_BUDGET,
    interruptedInstance: 1,
  }, 'expected 2, received 3');
  const context = { workspace: { rootDirectory, trackerDirectory }, log: () => undefined } as unknown as JobLaunchContext;
  const change = { board, at: AT } as unknown as TrackerChange;
  const observe = (overrides: Partial<BuildJobObservation>): void => {
    JobLaunch.applyBuildJobObservations(change, context, [{
      jobId: job.id, setup: 'installed', calls: 0, report: undefined, agentEnd: null, gate: { verdict: 'pending' }, ...overrides,
    }]);
  };
  return { board, context, observe };
}

describe('a session resumed after a red handoff', () => {
  test('keeps running within the resume budget and its wind-down grace', () => {
    const scene = resumedScene();
    scene.observe({ calls: RED_HANDOFF_RESUME_CALL_BUDGET + WIND_DOWN_GRACE_CALLS - 1 });

    expect(scene.board.jobs().find((job) => job.kind === 'build')?.state).toBe('running');
  });

  test('past the grace is stopped, opening no out-of-calls incident, and once it ended counts as red again', () => {
    const scene = resumedScene();
    scene.observe({ calls: RED_HANDOFF_RESUME_CALL_BUDGET + WIND_DOWN_GRACE_CALLS });

    expect(scene.board.jobs().find((job) => job.kind === 'build')?.state).toBe('stopping');
    expect(scene.board.incidents()).toEqual([]);

    scene.observe({ agentEnd: { reason: 'exited', exitCode: 0, signal: null } as unknown as BuildJobObservation['agentEnd'] });

    expect(scene.board.jobs().find((job) => job.kind === 'build')).toMatchObject({ state: 'interrupted', interruption: 'handoff-red' });
    const jobFolder = WatcherFleet.jobFolderOf(scene.context.workspace.trackerDirectory, scene.board.jobs().find((job) => job.kind === 'build')?.id ?? '');
    expect(RedHandoff.redHandoffFactsOf(jobFolder)).toMatchObject({ name: 'tests', resume: 2, interruptedInstance: 2 });
  });
});
