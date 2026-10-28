/**
 * Seeded interleavings of the lifecycle over one Board, a fake agent and a fake user acting at random between passes. What matters is what no
 * order of events may break: never two live jobs for one ticket, never a launch past the concurrency limit, never a resume of a session or of
 * a job that was not interrupted, every question answered at most once, never two host instances live for one job, never a resume of a
 * finished session or a crash resume past the bound, at most one git operation per worktree at a time, at most one merge or refresh per
 * target (so never two refreshes), and never a refresh beside its group's release. A failing seed names itself, so it replays exactly.
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

  test.each([
    [
      'two host instances live for one job',
      'src/lib/tracker-model/Jobs.ts',
      'targetState === \'running\' && isProcessless(job.state)',
      'targetState === \'running\' && job.state !== \'launching\'',
      'live at once',
    ],
    ['a resume of a finished session', 'src/lib/tracker-model/Jobs.ts', '    liveJobs.splice(liveJobs.indexOf(job), 1);\n', '', 'a finished session'],
    [
      'two merges on one target',
      'src/lib/tracker-model/MergeSlotClaims.ts',
      '    if (holder !== undefined) throw new BoardRefusal({ reason: \'merge-slot-held\', target, jobId: holder.id });\n',
      '',
      'merge jobs hold',
    ],
    [
      'a refresh beside its group\'s release',
      'src/lib/tracker-model/MergeSlotClaims.ts',
      '    if (releaseTicketId !== null) throw new BoardRefusal({ reason: \'refresh-beside-a-queued-release\', group: claim.group, releaseTicketId });\n',
      '',
      'a refresh runs beside its group\'s release',
    ],
    [
      'a crash resume past the bound',
      'src/lib/tracker-model/LifecyclePolicy.ts',
      '    if (isCrash(job.interruption) && job.crashResumes >= limits.JOB_RESUMES_BEFORE_FRESH) return [{ kind: \'replace-job\', jobId: job.id }];\n',
      '',
      'crash-resumed',
    ],
    [
      'two git operations on one worktree',
      'src/lib/tracker-model/LifecyclePolicy.ts',
      '!ticketIdsSettledThisPass.has(ticket.id) && !ticketHasAJob(ticket.id, facts) && ',
      '',
      'git operations at once',
    ],
  ])('the world names %s once the model allows it', async (_broken, modulePath, find, replace, violationPhrase) => {
    const mutated = await mutatedModuleOf(WORLD_MODULE, { modulePath, find, replace });
    const World   = mutated['LifecycleWorld'] as typeof LifecycleWorld;
    const violations = Array.from({ length: SEEDS }, (_unused, seed) => new World(seed + 1).run(TURNS_PER_SEED)).flat();
    expect(violations.some((violation) => violation.includes(violationPhrase))).toBe(true);
  });

  test('the world does work: its passes launch, resume and finish jobs', () => {
    const world = new LifecycleWorld(1);
    world.run(TURNS_PER_SEED);
    const workKinds = ['job-launched', 'job-ended', 'job-interrupted', 'job-resumed', 'decision-answered', 'merge-started', 'merge-landed'];
    expect(world.loggedKinds()).toEqual(expect.arrayContaining(workKinds));
  });
});
