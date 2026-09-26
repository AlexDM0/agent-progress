/**
 * The dispatcher's reading of `ticket hold`, checked against the bundle and a mutant like the claims in `dispatcher/Dispatcher.decisions.spec.ts`.
 * A paused ticket relies on these: no builder or reviewer starts before a status block shows the hold lifted, a held row left running frees its
 * slot, other tickets keep flowing within the limit, and a run that ends first names what it left held.
 */
import { describe, expect, test } from 'bun:test';

import { builtScriptTextOf, bundleDispatchScript }     from './testing/DispatchScriptBundle.ts';
import { runDispatchScript, type RecordedDispatchRun } from './testing/DispatchScriptHarness.ts';
import { HOLD_CLAIMS }                                 from './testing/claims/HoldClaims.ts';

const BUNDLE = await bundleDispatchScript();

function kindsAndTickets(run: RecordedDispatchRun): string[] {
  return run.calls.map((call) => (call.ticketId === null ? call.kind : `${call.kind} ${call.ticketId}`));
}

describe('the dispatcher script and a held ticket', () => {
  for (const claim of HOLD_CLAIMS) {
    test(claim.name, async () => {
      const run = await runDispatchScript(claim.scenarioFor(), builtScriptTextOf(BUNDLE));
      expect(run.ranAway).toBe(false);
      expect(run.threw).toBeNull();
      expect(claim.holds(run), JSON.stringify({ calls: kindsAndTickets(run), summary: run.summary, held: run.heldTicketIdsReturned })).toBe(true);
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
