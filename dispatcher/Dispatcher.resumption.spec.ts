/**
 * The dispatcher's resumption of a build an earlier run left paused, pinned like the rest of its decisions: each claim runs against the TypeScript
 * port, bundled, where it must hold, and against a mutant of the TypeScript module that holds the decision, where it must fail. The cases that
 * matter are the ones a stopped board relies on: a whole-board relaunch finds the paused build and delivers it with one builder that carries on
 * past the old claim, never a held ticket's nor a person's pause, all within the limit, and the stopped run names what it left paused and which
 * reviews wait. A takeover must also survive its own builder dying, admit a low build only as a low ticket is, and never outrank a ready ticket of
 * a higher priority.
 * A run that throws never counts as a claim holding, and a mutant that only crashes the script never counts as caught.
 */
import { describe, expect, test } from 'bun:test';

import { builtScriptTextOf, bundleDispatchScript } from './testing/DispatchScriptBundle';
import { runDispatchScript, type DispatchRun }     from './testing/DispatchScriptHarness';
import { RESUMPTION_CLAIMS }                       from './testing/claims/ResumptionClaims';

const BUNDLE = await bundleDispatchScript();

function kindsAndTickets(run: DispatchRun): string[] {
  return run.calls.map((call) => `${call.run} ${call.kind}${call.ticketId === null ? '' : ` ${call.ticketId}`}`);
}

describe('the dispatcher script and a build an earlier run left paused', () => {
  for (const claim of RESUMPTION_CLAIMS) {
    test(claim.name, async () => {
      const run = await runDispatchScript(claim.scenarioFor(), builtScriptTextOf(BUNDLE));
      expect(run.ranAway).toBe(false);
      expect(run.threw).toBeNull();
      expect(claim.holds(run), JSON.stringify({ calls: kindsAndTickets(run), summary: run.summary, relaunch: run.relaunchSummary })).toBe(true);
    });

    test(`${claim.name} — and fails against the mutant that breaks it`, async () => {
      const mutated = await bundleDispatchScript(claim.mutant);
      expect(mutated).toMatchObject({ verdict: 'built' });
      const run = await runDispatchScript(claim.scenarioFor(), builtScriptTextOf(mutated));
      expect(run.threw).toBeNull();
      expect(claim.holds(run)).toBe(false);
    });
  }
});
