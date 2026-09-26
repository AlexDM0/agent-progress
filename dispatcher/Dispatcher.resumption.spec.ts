/**
 * The dispatcher's resumption of a paused build, checked against the bundle and a mutant like the claims in `dispatcher/Dispatcher.decisions.spec.ts`.
 * A stopped board relies on these: a relaunch delivers the paused builds, highest priority first, each with one builder past the old claim (never
 * a held or a person's pause) within the limit, survives that builder dying, and neither admits a low build early nor outranks a higher-priority
 * ready ticket.
 */
import { describe, expect, test } from 'bun:test';

import { builtScriptTextOf, bundleDispatchScript }     from './testing/DispatchScriptBundle.ts';
import { runDispatchScript, type RecordedDispatchRun } from './testing/DispatchScriptHarness.ts';
import { RESUMPTION_CLAIMS }                           from './testing/claims/ResumptionClaims.ts';

const BUNDLE = await bundleDispatchScript();

function kindsAndTickets(run: RecordedDispatchRun): string[] {
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
