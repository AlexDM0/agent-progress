/**
 * Seeded interleavings of the lifecycle over one Board, a fake agent and a fake user acting at random between passes. What matters is what no
 * order of events may break: never two live jobs for one ticket, never a launch past the concurrency limit, never a resume of a session or of
 * a job that was not interrupted, and every question answered at most once. A failing seed names itself, so it replays exactly.
 */
import { describe, expect, test } from 'bun:test';

import { mutatedModuleOf } from '../../testing/SourceMutant.ts';
import { LifecycleWorld }  from './testing/LifecycleWorld.ts';

const WORLD_MODULE = 'src/lib/tracker-model/testing/LifecycleWorld.ts';

const SEEDS = 200;

const TURNS_PER_SEED = 60;

describe('the lifecycle under seeded interleavings', () => {
  test(`keeps every invariant across ${SEEDS} seeds`, () => {
    const violationsBySeed = Array.from({ length: SEEDS }, (_unused, seed) => ({ seed, violations: new LifecycleWorld(seed + 1).run(TURNS_PER_SEED) }))
      .filter((outcome) => outcome.violations.length > 0);
    expect(violationsBySeed).toEqual([]);
  });

  test.each([
    ['a launch past the concurrency limit', '    .slice(0, freeSlotsOf(facts))\n', ''],
    ['two live jobs for one ticket', '!ticketIdsSettledThisPass.has(ticket.id) && !ticketHasAJob(ticket.id, facts) && ', ''],
    ['a resume of a session', '    if (SESSION_JOB_KINDS.includes(job.kind)) return [{ kind: \'replace-job\', jobId: job.id }];\n', ''],
  ])('the world sees %s once the policy allows it', async (_broken, find, replace) => {
    const mutated = await mutatedModuleOf(WORLD_MODULE, { modulePath: 'src/lib/tracker-model/LifecyclePolicy.ts', find, replace });
    const World   = mutated['LifecycleWorld'] as typeof LifecycleWorld;
    const violationCount = Array.from({ length: SEEDS }, (_unused, seed) => new World(seed + 1).run(TURNS_PER_SEED).length).reduce((sum, count) => sum + count, 0);
    expect(violationCount).toBeGreaterThan(0);
  });

  test('the world does work: its passes launch, resume and finish jobs', () => {
    const world = new LifecycleWorld(1);
    world.run(TURNS_PER_SEED);
    expect(world.loggedKinds()).toEqual(expect.arrayContaining(['job-launched', 'job-ended', 'job-interrupted', 'job-resumed', 'decision-answered']));
  });
});
