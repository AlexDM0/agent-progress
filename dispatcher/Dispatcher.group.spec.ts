/**
 * The dispatcher's group run, checked against the bundle and a mutant like the claims in `dispatcher/Dispatcher.decisions.spec.ts`. A group's
 * bundle reaches the main line only through its release, so these pin what a group run may never do: move the main line other than once, at the
 * release ticket's reviewer's `released` after every other ticket is integrated, run two builders or two reviewers at once, build a ticket before
 * the one it forks off is built, review one before the one before it is integrated, outlive a board stop, or reach a whole-board run's tickets
 * beside it; that the run starts the release review itself and its one release delivers the bundle; that `main-moved` at the release is
 * retried with the version bump dropped and then parked; and that a relaunch picks the pipeline up from the board alone.
 */
import { describe, expect, test } from 'bun:test';

import type { RecordedDispatchRun }                from './testing/@types/RecordedDispatchRun.ts';
import { builtScriptTextOf, bundleDispatchScript } from './testing/DispatchScriptBundle.ts';
import { runDispatchScript }                       from './testing/DispatchScriptHarness.ts';
import { GROUP_CLAIMS }                            from './testing/claims/GroupClaims.ts';

const BUNDLE = await bundleDispatchScript();

function evidenceOf(run: RecordedDispatchRun): string {
  return JSON.stringify({
    events:   run.agentEvents,
    summary:  run.summary,
    racing:   run.racingSummary,
    relaunch: run.relaunchSummary,
    mainLine: run.mainLineMoves,
    logs:     run.logs,
  });
}

describe('the dispatcher script\'s group run', () => {
  for (const claim of GROUP_CLAIMS) {
    test(claim.name, async () => {
      const run = await runDispatchScript(claim.scenarioFor(), builtScriptTextOf(BUNDLE));
      expect(run.runRanAway).toBe(false);
      expect(run.threw).toBeNull();
      expect(claim.holds(run), evidenceOf(run)).toBe(true);
    });

    test(`${claim.name} — and fails against the mutant that breaks it`, async () => {
      const mutated = await bundleDispatchScript(claim.mutant);
      expect(mutated).toMatchObject({ verdict: 'built' });
      const run = await runDispatchScript(claim.scenarioFor(), builtScriptTextOf(mutated));
      expect(run.threw).toBeNull();
      expect(claim.holds(run), evidenceOf(run)).toBe(false);
    });
  }
});
